import { BadRequestException, Body, Controller, Get, GoneException, HttpCode, Ip, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailKind, Role } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm, Public, Roles } from '../auth/auth-user';
import { signToken } from '../auth/jwt';
import { hashPassword, passwordProblem } from '../auth/password';
import { isPlaceholderEmail } from '../common/placeholder';
import { fullName } from '../common/rules';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginThrottle } from '../security/login-throttle';

/** Durée de validité d'un lien d'invitation, du code email, nombre d'essais et d'envois de code. */
const INVITE_DAYS = 14;
const CODE_MINUTES = 15;
const CODE_ATTEMPTS = 5;
const CODES_PER_INVITE = 5;

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const tokenHash = (token: string) => sha(`invitation:${token}`);
const codeHash = (invitationId: string, email: string, code: string) => sha(`${invitationId}:${email}:${code}`);

class BulkDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  parentIds?: string[];
}

class EmailDto {
  @IsEmail({}, { message: 'Email invalide.' })
  @MaxLength(160)
  email: string;
}

class CompleteDto {
  @IsEmail({}, { message: 'Email invalide.' })
  @MaxLength(160)
  email: string;

  @Matches(/^\d{6}$/, { message: 'Le code reçu par email contient 6 chiffres.' })
  code: string;

  @IsString()
  @IsNotEmpty({ message: 'Téléphone obligatoire.' })
  @MaxLength(30)
  phone: string;

  @Matches(/^[0-9A-Za-z]{6,12}$/, { message: 'CIN obligatoire (6 à 12 caractères).' })
  cin: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

/**
 * Invitations des parents (administration) : lien personnel à envoyer par WhatsApp ou SMS depuis le téléphone du club.
 * Le lien est rendu une seule fois (seule son empreinte est gardée) ; un nouveau lien remplace les précédents.
 */
@ApiTags('Parents')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('parents')
export class ParentInvitationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async issue(by: AuthUser, parentId: string) {
    const parent = await this.prisma.user.findFirst({
      where: { id: parentId, roles: { has: Role.PARENT }, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        parentLinks: { where: { player: { archivedAt: null } }, select: { player: { select: { firstName: true } } } },
      },
    });
    if (!parent) throw new NotFoundException('Parent introuvable ou désactivé.');
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    await this.prisma.$transaction([
      this.prisma.invitation.updateMany({ where: { userId: parent.id, usedAt: null }, data: { usedAt: new Date(), codeHash: null } }),
      this.prisma.invitation.create({ data: { userId: parent.id, tokenHash: tokenHash(token), createdById: by.id, expiresAt } }),
    ]);
    await this.audit.log(by.id, { action: 'Invitation parent préparée', entity: 'User', entityId: parent.id, target: fullName(parent) });
    return {
      parentId: parent.id,
      name: fullName(parent),
      firstName: parent.firstName,
      phone: parent.phone,
      children: parent.parentLinks.map((l) => l.player.firstName),
      token,
      expiresAt,
    };
  }

  /** Nouveau lien d'invitation pour un parent (les liens précédents ne marchent plus). */
  @Post(':id/invitation')
  @HttpCode(200)
  @Perm('parents.manage', 'players.manage')
  invite(@CurrentUser() by: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.issue(by, id);
  }

  /** Invitations groupées : parents choisis, ou par défaut ceux sans email réel ou sans aucune connexion. */
  @Post('invitations')
  @HttpCode(200)
  @Perm('parents.manage', 'players.manage')
  async inviteMany(@CurrentUser() by: AuthUser, @Body() dto: BulkDto) {
    const parents = await this.prisma.user.findMany({
      where: {
        roles: { has: Role.PARENT },
        isActive: true,
        ...(dto.parentIds?.length ? { id: { in: dto.parentIds } } : {}),
      },
      select: { id: true, email: true, lastLoginAt: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const targets = dto.parentIds?.length ? parents : parents.filter((p) => !p.email || isPlaceholderEmail(p.email) || !p.lastLoginAt);
    const out = [];
    for (const p of targets) out.push(await this.issue(by, p.id));
    return out;
  }
}

/** Page publique « Bienvenue » ouverte depuis le lien : le parent complète et vérifie ses coordonnées. */
@ApiTags('Parents')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly throttle: LoginThrottle,
  ) {}

  /** Invitation valable pour ce jeton, sinon 404 (inconnu) ou 410 (déjà utilisé ou expiré). */
  private async valid(token: string) {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            cin: true,
            isActive: true,
            roles: true,
            parentLinks: { where: { player: { archivedAt: null } }, select: { player: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
    });
    if (!inv || !inv.user.isActive) throw new NotFoundException('Lien d’invitation inconnu : demandez un nouveau lien au club.');
    if (inv.usedAt) throw new GoneException('Ce lien a déjà été utilisé : connectez-vous avec votre email ou votre CIN, ou demandez un nouveau lien au club.');
    if (inv.expiresAt < new Date()) throw new GoneException('Ce lien a expiré : demandez un nouveau lien au club.');
    return inv;
  }

  @Public()
  @Get(':token')
  async show(@Param('token') token: string) {
    const inv = await this.valid(token);
    const u = inv.user;
    return {
      firstName: u.firstName,
      lastName: u.lastName,
      // Données déjà connues du club, proposées à confirmer (jamais l'email provisoire).
      email: u.email && !isPlaceholderEmail(u.email) ? u.email : null,
      phone: u.phone,
      cin: u.cin,
      children: u.parentLinks.map((l) => fullName(l.player)),
      expiresAt: inv.expiresAt,
    };
  }

  /** Code à 6 chiffres envoyé à l'email saisi (15 min, 5 envois par lien). */
  @Public()
  @Post(':token/email-code')
  @HttpCode(200)
  async sendCode(@Param('token') token: string, @Body() dto: EmailDto, @Ip() ip: string) {
    const inv = await this.valid(token);
    const key = `invite:${inv.id}`;
    this.throttle.check(ip, key);
    const email = dto.email.trim().toLowerCase();
    if (isPlaceholderEmail(email)) throw new BadRequestException('Saisissez votre vraie adresse email.');
    const other = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (other && other.id !== inv.userId) throw new BadRequestException('Cet email est déjà utilisé par un autre compte : saisissez le vôtre ou contactez le club.');
    if (inv.codesSent >= CODES_PER_INVITE) {
      this.throttle.fail(ip, key);
      throw new BadRequestException('Trop de codes demandés pour ce lien : demandez un nouveau lien au club.');
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.invitation.update({
      where: { id: inv.id },
      data: {
        pendingEmail: email,
        codeHash: codeHash(inv.id, email, code),
        codeExpiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
        codeAttempts: 0,
        codesSent: { increment: 1 },
      },
    });
    await this.mail.send(
      email,
      'TCSAY · code de vérification de votre email',
      `Bonjour ${inv.user.firstName},\n\nVotre code de vérification : ${code}\n\nSaisissez-le sur la page d’invitation du Tennis Club de Sayada pour activer votre compte. Il est valable ${CODE_MINUTES} minutes.\nSi vous n’avez rien demandé, ignorez cet email.\n\nLe bureau du TCSAY`,
      EmailKind.CREDENTIALS,
      { notify: false },
    );
    return { ok: true, sentTo: email, minutes: CODE_MINUTES };
  }

  /** Coordonnées vérifiées et mot de passe choisi : compte activé et session ouverte. */
  @Public()
  @Post(':token/complete')
  @HttpCode(200)
  async complete(@Param('token') token: string, @Body() dto: CompleteDto, @Ip() ip: string) {
    const inv = await this.valid(token);
    const key = `invite:${inv.id}`;
    this.throttle.check(ip, key);
    const email = dto.email.trim().toLowerCase();
    const bad = (message: string) => {
      this.throttle.fail(ip, key);
      return new BadRequestException(message);
    };
    if (!inv.codeHash || inv.pendingEmail !== email) throw bad('Demandez d’abord le code de vérification pour cet email.');
    if (!inv.codeExpiresAt || inv.codeExpiresAt < new Date()) throw bad('Code expiré : demandez un nouveau code.');
    if (inv.codeAttempts >= CODE_ATTEMPTS) throw bad('Trop d’essais : demandez un nouveau code.');
    if (inv.codeHash !== codeHash(inv.id, email, dto.code)) {
      await this.prisma.invitation.update({ where: { id: inv.id }, data: { codeAttempts: { increment: 1 } } });
      throw bad('Code incorrect.');
    }
    const cin = dto.cin.trim().toUpperCase();
    const phone = dto.phone.trim();
    const [emailOwner, cinOwner] = await Promise.all([
      this.prisma.user.findUnique({ where: { email }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { cin }, select: { id: true } }),
    ]);
    if (emailOwner && emailOwner.id !== inv.userId) throw new BadRequestException('Cet email est déjà utilisé par un autre compte.');
    if (cinOwner && cinOwner.id !== inv.userId) throw new BadRequestException('Cette CIN est déjà enregistrée pour un autre compte : contactez le club.');
    const problem = passwordProblem(dto.password, { ...inv.user, email, cin });
    if (problem) throw new BadRequestException(problem);

    const before = `${inv.user.email ?? '—'} · ${inv.user.phone ?? '—'} · ${inv.user.cin ?? '—'}`;
    const [, user] = await this.prisma.$transaction([
      this.prisma.invitation.updateMany({ where: { userId: inv.userId, usedAt: null }, data: { usedAt: new Date(), codeHash: null } }),
      this.prisma.user.update({
        where: { id: inv.userId },
        data: {
          email,
          phone,
          cin,
          passwordHash: await hashPassword(dto.password),
          mustChangePassword: false,
          temporaryPassword: false,
          lastLoginAt: new Date(),
          version: { increment: 1 },
        },
        select: { id: true, roles: true, passwordHash: true, firstName: true, lastName: true },
      }),
    ]);
    this.throttle.success(ip, key);
    await this.audit.log(user.id, {
      action: 'Coordonnées complétées par le parent (invitation)',
      entity: 'User',
      entityId: user.id,
      target: fullName(user),
      before,
      after: `${email} (vérifié) · ${phone} · ${cin}`,
    });
    return { ok: true, accessToken: signToken(user.id, user.roles.join(','), user.passwordHash, 30 * 86_400) };
  }
}
