import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { hashPassword, temporaryPassword } from '../auth/password';
import { rule } from '../common/rules';
import { MailService } from '../mail/mail.service';
import { Db, PrismaService } from '../prisma/prisma.service';

export type NewAccount = { email: string; role: Role; firstName: string; lastName: string; phone?: string | null };

/** Comptes : créés par l'admin avec mot de passe temporaire envoyé par email ; désactivés, jamais supprimés. */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /** Crée le compte (dans la transaction fournie) ; renvoie le mot de passe temporaire à envoyer après validation. */
  async create(db: Db, data: NewAccount) {
    const email = data.email.trim().toLowerCase();
    if (await db.user.findUnique({ where: { email } })) {
      throw new ConflictException(`Un compte existe déjà pour ${email}.`);
    }
    const password = temporaryPassword();
    const user = await db.user.create({
      data: {
        email,
        role: data.role,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        phone: data.phone?.trim() || null,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      },
    });
    return { user, password };
  }

  /** Envoi des identifiants (hors transaction : un échec SMTP n'annule pas la création). */
  sendCredentials(user: { email: string; firstName: string }, password: string) {
    return this.mail.credentials(user.email, user.firstName, user.email, password);
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
      target: `${user.firstName} ${user.lastName}`,
      before: user.isActive ? 'Actif' : 'Désactivé',
      after: active ? 'Actif' : 'Désactivé',
    });
    return updated;
  }
}
