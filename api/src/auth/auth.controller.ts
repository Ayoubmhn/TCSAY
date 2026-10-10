import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Ip, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
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
}

class ChangePasswordDto {
  @IsString()
  @MaxLength(200)
  currentPassword: string;

  @IsString()
  @MinLength(10, { message: 'Le mot de passe doit contenir au moins 10 caractères.' })
  @MaxLength(100)
  newPassword: string;
}

/** Empreinte factice (mot de passe aléatoire) pour les identifiants inconnus : même temps de calcul qu'un vrai compte. */
const DUMMY_HASH = 'scrypt$0f1e2d3c4b5a69788796a5b4c3d2e1f0$' + 'ab'.repeat(64);

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly throttle: LoginThrottle,
  ) {}

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
    return { accessToken: signToken(user.id, user.roles.join(','), user.passwordHash), mustChangePassword: user.mustChangePassword };
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
    const key = `pw:${user.id}`;
    this.throttle.check(ip, key);
    if (!(await verifyPassword(dto.currentPassword, user.passwordHash))) {
      this.throttle.fail(ip, key);
      throw new BadRequestException('Mot de passe actuel incorrect.');
    }
    this.throttle.success(ip, key);
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('Le nouveau mot de passe doit être différent de l’actuel.');
    }
    const problem = passwordProblem(dto.newPassword, user);
    if (problem) throw new BadRequestException(problem);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(dto.newPassword), mustChangePassword: false, version: { increment: 1 } },
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
