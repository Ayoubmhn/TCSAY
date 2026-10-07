import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PayMode, Role, StaffPosition } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { hashPassword, temporaryPassword } from '../auth/password';
import { rule } from '../common/rules';
import { MailService } from '../mail/mail.service';
import { Db, PrismaService } from '../prisma/prisma.service';

export type NewAccount = {
  email?: string | null;
  cin?: string | null;
  role: Role;
  firstName: string;
  lastName: string;
  phone?: string | null;
  position?: StaffPosition | null;
  payMode?: PayMode | null;
  payRate?: number | null;
};

/** Résultat de l'envoi des identifiants : email envoyé, ou mot de passe à remettre en main propre. */
export type Credentials = { sentTo: string | null; login: string; temporaryPassword: string | null };

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

  /** Crée le compte (dans la transaction fournie) ; renvoie le mot de passe temporaire à transmettre après validation. */
  async create(db: Db, data: NewAccount) {
    const email = data.email?.trim().toLowerCase() || null;
    const cin = data.cin?.trim() || null;
    if (!email && !cin) throw new BadRequestException('Email ou CIN obligatoire pour créer un compte.');
    if (email && (await db.user.findUnique({ where: { email } }))) {
      throw new ConflictException(`Un compte existe déjà pour ${email}.`);
    }
    if (cin && (await db.user.findUnique({ where: { cin } }))) {
      throw new ConflictException(`Un compte existe déjà pour la CIN ${cin}.`);
    }
    const password = temporaryPassword();
    const user = await db.user.create({
      data: {
        email,
        cin,
        role: data.role,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        phone: data.phone?.trim() || null,
        position: data.position ?? null,
        payMode: data.payMode ?? null,
        payRate: data.payRate ?? null,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      },
    });
    return { user, password };
  }

  /** Envoi des identifiants (hors transaction : un échec SMTP n'annule pas la création). */
  async sendCredentials(user: { email: string | null; cin: string | null; firstName: string }, password: string): Promise<Credentials> {
    if (user.email) {
      await this.mail.credentials(user.email, user.firstName, user.email, password);
      return { sentTo: user.email, login: user.email, temporaryPassword: null };
    }
    // Pas d'email : l'admin remet le mot de passe temporaire en main propre (affiché une seule fois).
    return { sentTo: null, login: user.cin ?? '', temporaryPassword: password };
  }

  async setActive(actorId: string, userId: string, active: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Compte introuvable.');
    if (user.isActive === active) return user;
    if (!active && user.role === Role.ADMIN) {
      const admins = await this.prisma.user.count({ where: { role: Role.ADMIN, isActive: true } });
      if (admins <= 1) throw rule.conflict('R12', 'Il faut toujours au moins un administrateur actif.');
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
