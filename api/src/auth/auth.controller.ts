import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Ip, Post, UnauthorizedException } from '@nestjs/common';
import { EmailKind } from '@prisma/client';
import { createHash, randomInt } from 'node:crypto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AllowPendingPassword, AuthUser, CurrentUser, Public } from './auth-user';
import { signToken } from './jwt';
import { LoginThrottle } from '../security/login-throttle';
import { hashPassword, passwordProblem, verifyPassword } from './password';

class LoginDto {
  /** Email ou numéro de CIN. */
  @IsString()
  @IsNotEmpty({ message: 'Identifiant obligatoire.' })
  @MaxLength(120)
  email: string;

  @IsString()
  @MinLength(1, { message: 'Mot de passe obligatoire.' })
  @MaxLength(200)
  password: string;

  /** « Rester connecté » (téléphone personnel, application installée) : session de 30 jours au lieu de 12 heures. */
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

/** Durée de session : 12 h par défaut, 30 jours avec « Rester connecté ». Un changement de mot de passe coupe toutes les sessions. */
const SESSION_SHORT = 12 * 3600;
const SESSION_LONG = 30 * 24 * 3600;

class ChangePasswordDto {
  /** Facultatif avec un mot de passe temporaire (session déjà ouverte avec lui). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentPassword?: string;

  @IsString()
  @MinLength(10, { message: 'Le mot de passe doit contenir au moins 10 caractères.' })
  @MaxLength(100)
  newPassword: string;
}

class ForgotDto {
  /** Email du compte. */
  @IsString()
  @IsNotEmpty({ message: 'Email obligatoire.' })
  @MaxLength(120)
  email: string;
}

class ResetDto {
  @IsString()
  @IsNotEmpty({ message: 'Email obligatoire.' })
  @MaxLength(120)
  email: string;

  @Matches(/^\d{6}$/, { message: 'Le code reçu par email contient 6 chiffres.' })
  code: string;

  @IsString()
  @MinLength(10, { message: 'Le mot de passe doit contenir au moins 10 caractères.' })
  @MaxLength(100)
  newPassword: string;
}

/** Code de réinitialisation : valable 15 minutes, 5 essais au plus. */
const RESET_MINUTES = 15;
const RESET_ATTEMPTS = 5;
const codeHash = (userId: string, code: string) => createHash('sha256').update(`${userId}:${code}`).digest('hex');

/** Empreinte factice (mot de passe aléatoire) pour les identifiants inconnus : même temps de calcul qu'un vrai compte. */
const DUMMY_HASH = 'scrypt$0f1e2d3c4b5a69788796a5b4c3d2e1f0$' + 'ab'.repeat(64);

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly throttle: LoginThrottle,
    private readonly mail: MailService,
  ) {}

  /**
   * Mot de passe oublié : envoie un code à 6 chiffres à l'email du compte. Réponse identique que le compte existe ou non
   * (impossible de deviner les adresses inscrites). Un compte sans email réel (CIN seule, adresse provisoire) passe par l'admin.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotDto, @Ip() ip: string) {
    const email = dto.email.trim().toLowerCase();
    const key = `reset:${email}`;
    this.throttle.check(ip, key);
    this.throttle.fail(ip, key); // chaque demande compte : 5 demandes par adresse / 15 min au plus
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.isActive && !/@a-completer\.invalid$/i.test(email)) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await this.prisma.$transaction([
        this.prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
        this.prisma.passwordReset.create({
          data: { userId: user.id, codeHash: codeHash(user.id, code), expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) },
        }),
      ]);
      await this.mail.send(
        email,
        'TCSAY · code pour changer votre mot de passe',
        `Bonjour ${user.firstName},\n\nVotre code : ${code}\n\nSaisissez-le dans l’écran « Mot de passe oublié » avec votre nouveau mot de passe. Il est valable ${RESET_MINUTES} minutes.\nSi vous n’avez rien demandé, ignorez cet email : votre mot de passe ne change pas.\n\nLe bureau du TCSAY`,
        EmailKind.CREDENTIALS,
      );
      await this.audit.log(user.id, { action: 'Code de réinitialisation envoyé', entity: 'User', entityId: user.id, target: email });
    }
    return { ok: true, message: `Si un compte correspond à cette adresse, un code vient d’y être envoyé (valable ${RESET_MINUTES} minutes).` };
  }

  /** Nouveau mot de passe avec le code reçu par email ; les autres sessions sont déconnectées. */
  @Public()
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetDto, @Ip() ip: string) {
    const email = dto.email.trim().toLowerCase();
    const key = `resetcode:${email}`;
    this.throttle.check(ip, key);
    const invalid = () => {
      this.throttle.fail(ip, key);
      return new BadRequestException('Code incorrect ou expiré : demandez un nouveau code.');
    };
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.isActive) throw invalid();
    const reset = await this.prisma.passwordReset.findFirst({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!reset || reset.attempts >= RESET_ATTEMPTS) throw invalid();
    if (reset.codeHash !== codeHash(user.id, dto.code)) {
      await this.prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
      throw invalid();
    }
    const problem = passwordProblem(dto.newPassword, user);
    if (problem) throw new BadRequestException(problem);
    await this.prisma.$transaction([
      this.prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(dto.newPassword), mustChangePassword: false, temporaryPassword: false, version: { increment: 1 } },
      }),
    ]);
    this.throttle.success(ip, key);
    this.throttle.success(ip, email);
    await this.audit.log(user.id, { action: 'Mot de passe réinitialisé (code email)', entity: 'User', entityId: user.id, target: `${user.firstName} ${user.lastName}` });
    return { ok: true };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Ip() ip: string) {
    const login = dto.email.trim();
    // Trop d'échecs récents pour cet identifiant ou cette adresse : refus (429) avant toute vérification.
    this.throttle.check(ip, login);
    const user = login.includes('@')
      ? await this.prisma.user.findUnique({ where: { email: login.toLowerCase() } })
      : await this.prisma.user.findUnique({ where: { cin: login } });
    // Compte inconnu : on vérifie quand même un mot de passe factice, pour un temps de réponse identique
    // (impossible de deviner quels identifiants existent).
    const ok = (await verifyPassword(dto.password, user?.passwordHash ?? DUMMY_HASH)) && Boolean(user?.isActive);
    if (!ok || !user) {
      this.throttle.fail(ip, login);
      throw new UnauthorizedException('Identifiant ou mot de passe incorrect.');
    }
    this.throttle.success(ip, login);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const ttl = dto.remember ? SESSION_LONG : SESSION_SHORT;
    return { accessToken: signToken(user.id, user.roles.join(','), user.passwordHash, ttl), mustChangePassword: user.mustChangePassword, expiresIn: ttl };
  }

  @ApiBearerAuth()
  @AllowPendingPassword()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() current: AuthUser, @Body() dto: ChangePasswordDto, @Ip() ip: string) {
    // Démo en ligne partagée : les comptes de démonstration gardent leur mot de passe pour tous les testeurs.
    if (process.env.DEMO_MODE === 'true' && /@(exemple|tcsay)\.tn$/i.test(current.email ?? '')) {
      throw new ForbiddenException('Mode démonstration : le mot de passe des comptes de démo ne se change pas.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: current.id } });
    // Mot de passe temporaire (première connexion ou « Modifier plus tard ») : la session ouverte avec lui suffit.
    const temporary = user.mustChangePassword || user.temporaryPassword;
    if (!temporary || dto.currentPassword) {
      const key = `pw:${user.id}`;
      this.throttle.check(ip, key);
      if (!(await verifyPassword(dto.currentPassword ?? '', user.passwordHash))) {
        this.throttle.fail(ip, key);
        throw new BadRequestException('Mot de passe actuel incorrect.');
      }
      this.throttle.success(ip, key);
    }
    if (await verifyPassword(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException('Le nouveau mot de passe doit être différent de l’actuel.');
    }
    const problem = passwordProblem(dto.newPassword, user);
    if (problem) throw new BadRequestException(problem);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(dto.newPassword), mustChangePassword: false, temporaryPassword: false, version: { increment: 1 } },
    });
    await this.audit.log(user.id, {
      action: 'Mot de passe changé',
      entity: 'User',
      entityId: user.id,
      target: `${user.firstName} ${user.lastName}`,
    });
    // Nouveau jeton pour cette session ; les autres sessions (autres appareils) sont déconnectées.
    return { ok: true, accessToken: signToken(user.id, user.roles.join(','), updated.passwordHash) };
  }

  /** Première connexion : garder le mot de passe temporaire reçu par email (« Modifier plus tard »), rappel dans Paramètres. */
  @ApiBearerAuth()
  @AllowPendingPassword()
  @Post('change-password/later')
  @HttpCode(200)
  async changePasswordLater(@CurrentUser() current: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: current.id }, select: { mustChangePassword: true, firstName: true, lastName: true } });
    if (!user.mustChangePassword) return { ok: true };
    await this.prisma.user.update({ where: { id: current.id }, data: { mustChangePassword: false, temporaryPassword: true, version: { increment: 1 } } });
    await this.audit.log(current.id, {
      action: 'Changement du mot de passe temporaire reporté',
      entity: 'User',
      entityId: current.id,
      target: `${user.firstName} ${user.lastName}`,
    });
    return { ok: true };
  }

  /** Profil connecté : rôle, joueur/coach associé, enfants (parent). */
  @ApiBearerAuth()
  @AllowPendingPassword()
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const kids =
      user.role === 'PARENT'
        ? await this.prisma.parentLink.findMany({
            where: { parentId: user.id, player: { archivedAt: null } },
            include: { player: { select: { id: true, firstName: true, lastName: true } } },
            orderBy: { player: { birthDate: 'asc' } },
          })
        : [];
    const self = user.playerId
      ? await this.prisma.player.findUnique({
          where: { id: user.playerId },
          select: { id: true, firstName: true, lastName: true },
        })
      : null;
    // Informations du compte : lecture seule pour l'utilisateur, modifiables par le club.
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { phone: true, cin: true, createdAt: true, lastLoginAt: true },
    });
    return {
      ...user,
      ...account,
      players: user.role === 'PARENT' ? kids.map((k) => k.player) : self ? [self] : [],
    };
  }
}
