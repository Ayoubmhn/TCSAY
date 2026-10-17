import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PayMode, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { hashPassword, temporaryPassword } from '../auth/password';
import { rule } from '../common/rules';
import { MailService } from '../mail/mail.service';
import { Db, PrismaService } from '../prisma/prisma.service';
import { isPlaceholderEmail } from '../common/placeholder';

export type NewAccount = {
  email?: string | null;
  cin?: string | null;
  role: Role;
  firstName: string;
  lastName: string;
  phone?: string | null;
  /** Rôles supplémentaires (ex. personnel : agent administratif et directeur technique). */
  extraRoles?: Role[];
  payMode?: PayMode | null;
  payRate?: number | null;
};

/** Résultat de l'envoi des identifiants : email envoyé, ou mot de passe à remettre en main propre. */
export type Credentials = { sentTo: string | null; login: string; temporaryPassword: string | null; existing?: boolean };

const ROLE_NAME: Partial<Record<Role, string>> = {
  PRESIDENT: 'président',
  ADMIN_AGENT: 'agent administratif',
  SUPERVISOR: 'agent superviseur',
  TECH_DIRECTOR: 'directeur technique',
  COACH: 'entraîneur',
  PARENT: 'parent',
  PLAYER: 'joueur',
};

/**
 * Comptes : créés par l'admin avec mot de passe temporaire ; désactivés, jamais supprimés.
 * Identifiant = email, ou CIN si la personne n'a pas d'email.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Crée le compte (dans la transaction fournie) et renvoie le mot de passe temporaire à transmettre après validation.
   * Une même personne peut cumuler plusieurs rôles : si un compte existe déjà avec cet email ou cette CIN,
   * le rôle lui est ajouté (ex. un entraîneur inscrit comme joueur, un directeur technique qui entraîne).
   */
  async create(db: Db, data: NewAccount): Promise<{ user: Awaited<ReturnType<Db['user']['create']>>; password: string | null }> {
    const email = data.email?.trim().toLowerCase() || null;
    const cin = data.cin?.trim() || null;
    if (!email && !cin) throw new BadRequestException('Email ou CIN obligatoire pour créer un compte.');
    const byEmail = email ? await db.user.findUnique({ where: { email } }) : null;
    const byCin = cin ? await db.user.findUnique({ where: { cin } }) : null;
    if (byEmail && byCin && byEmail.id !== byCin.id) {
      throw new ConflictException('Cet email et cette CIN appartiennent à deux comptes différents.');
    }
    const roles = [data.role, ...(data.extraRoles ?? [])];
    const existing = byEmail ?? byCin;
    if (existing) {
      if (roles.every((r) => existing.roles.includes(r))) {
        throw new ConflictException(`${existing.firstName} ${existing.lastName} a déjà ce rôle (${email ?? cin}).`.replace(/\s+/g, ' '));
      }
      const user = await db.user.update({
        where: { id: existing.id },
        data: {
          roles: [...new Set([...existing.roles, ...roles])],
          cin: existing.cin ?? cin,
          email: existing.email ?? email,
          phone: existing.phone ?? (data.phone?.trim() || null),
          payMode: existing.payMode ?? data.payMode ?? null,
          payRate: existing.payRate ?? data.payRate ?? null,
          version: { increment: 1 },
        },
      });
      return { user, password: null };
    }
    const password = temporaryPassword();
    const user = await db.user.create({
      data: {
        email,
        cin,
        roles,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        phone: data.phone?.trim() || null,
        payMode: data.payMode ?? null,
        payRate: data.payRate ?? null,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      },
    });
    return { user, password };
  }

  /**
   * Envoi des identifiants (hors transaction : un échec SMTP n'annule pas la création).
   * Compte existant (password null) : simple information du nouveau rôle, le mot de passe ne change pas.
   */
  async sendCredentials(
    user: { email: string | null; cin: string | null; firstName: string; roles?: Role[] },
    password: string | null,
    newRole?: Role,
  ): Promise<Credentials> {
    if (password === null) {
      if (user.email && !isPlaceholderEmail(user.email)) {
        const what = newRole && ROLE_NAME[newRole] ? `le rôle ${ROLE_NAME[newRole]}` : 'un nouveau rôle';
        await this.mail.send(
          user.email,
          'Nouveau rôle sur votre compte TCSAY',
          `Bonjour ${user.firstName},\n\nVotre compte a reçu ${what}. Connectez-vous avec vos identifiants habituels, puis choisissez l’espace dans le menu.\n\nLe bureau du TCSAY`,
          'OTHER',
        );
      }
      return { sentTo: user.email, login: user.email ?? user.cin ?? '', temporaryPassword: null, existing: true };
    }
    if (user.email && !isPlaceholderEmail(user.email)) {
      await this.mail.credentials(user.email, user.firstName, user.email, password);
      return { sentTo: user.email, login: user.email, temporaryPassword: null };
    }
    // Pas d'email : l'admin remet le mot de passe temporaire en main propre (affiché une seule fois).
    return { sentTo: null, login: user.cin ?? '', temporaryPassword: password };
  }

  /**
   * Changement d'email par l'admin : le nouvel email devient l'identifiant, un NOUVEAU mot de passe temporaire est créé
   * (changement obligatoire à la connexion) et envoyé au nouvel email. Sert notamment à remplacer l'email provisoire
   * « …@a-completer.invalid » des parents et entraîneurs importés. Aucun envoi vers un email provisoire.
   */
  async changeEmail(actorId: string, userId: string, newEmail: string | null | undefined): Promise<Credentials | null> {
    const email = newEmail?.trim().toLowerCase() || null;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (newEmail === undefined || email === user.email) return null;
    if (!email && !user.cin) throw new BadRequestException('Email obligatoire (ce compte n’a pas de CIN pour se connecter).');
    if (email) {
      const other = await this.prisma.user.findUnique({ where: { email } });
      if (other && other.id !== userId) throw new ConflictException(`L’email ${email} est déjà utilisé par un autre compte.`);
    }
    const password = temporaryPassword();
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: { email, passwordHash: await hashPassword(password), mustChangePassword: true, version: { increment: 1 } },
      });
      await tx.player.updateMany({ where: { userId }, data: { email } });
      await this.audit.log(
        actorId,
        {
          action: 'Email modifié : nouveaux identifiants',
          entity: 'User',
          entityId: userId,
          target: `${u.firstName} ${u.lastName}`.trim(),
          before: user.email ?? '—',
          after: email ?? '—',
        },
        tx,
      );
      return u;
    });
    if (email && !isPlaceholderEmail(email)) {
      await this.mail.credentials(email, updated.firstName, email, password);
      return { sentTo: email, login: email, temporaryPassword: null };
    }
    // Pas d'email réel : mot de passe à remettre en main propre (connexion par CIN).
    return { sentTo: null, login: updated.cin ?? '', temporaryPassword: updated.cin ? password : null };
  }

  /**
   * Active ou désactive un rôle d'un compte (entraîneur, parent…). Si le compte a d'autres rôles,
   * seul ce rôle est retiré ; sinon le compte est désactivé (jamais supprimé). Réactivation : rôle rendu, compte actif.
   */
  async setRoleActive(actorId: string, userId: string, role: Role, active: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    const others = user.roles.filter((r) => r !== role);
    if (!active && others.length && user.roles.includes(role)) {
      const updated = await this.prisma.user.update({ where: { id: userId }, data: { roles: others, version: { increment: 1 } } });
      await this.audit.log(actorId, {
        action: 'Rôle retiré',
        entity: 'User',
        entityId: userId,
        target: `${user.firstName} ${user.lastName}`.trim(),
        before: ROLE_NAME[role] ?? role,
        after: 'Compte conservé pour ses autres rôles',
      });
      return updated;
    }
    if (active && !user.roles.includes(role)) {
      await this.prisma.user.update({ where: { id: userId }, data: { roles: [...user.roles, role], version: { increment: 1 } } });
      await this.audit.log(actorId, { action: 'Rôle rendu', entity: 'User', entityId: userId, target: `${user.firstName} ${user.lastName}`.trim(), after: ROLE_NAME[role] ?? role });
    }
    return this.setActive(actorId, userId, active);
  }

  async setActive(actorId: string, userId: string, active: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (user.isActive === active) return user;
    if (!active && user.roles.includes(Role.PRESIDENT)) {
      const presidents = await this.prisma.user.count({ where: { roles: { has: Role.PRESIDENT }, isActive: true } });
      if (presidents <= 1) throw rule.conflict('R12', 'Il faut toujours au moins un président actif.');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: active, version: { increment: 1 } },
    });
    await this.audit.log(actorId, {
      action: active ? 'Compte réactivé' : 'Compte désactivé',
      entity: 'User',
      entityId: userId,
      target: `${user.firstName} ${user.lastName}`.trim(),
      before: user.isActive ? 'Actif' : 'Désactivé',
      after: active ? 'Actif' : 'Désactivé',
    });
    return updated;
  }
}
