import { BadRequestException, Body, Controller, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AllowPendingPassword, AuthUser, CurrentUser, Public } from './auth-user';
import { signToken } from './jwt';
import { hashPassword, verifyPassword } from './password';

class LoginDto {
  /** Email ou numéro de CIN. */
  @IsString()
  @IsNotEmpty({ message: 'Identifiant obligatoire.' })
  @MaxLength(120)
  email: string;

  @IsString()
  @MinLength(1, { message: 'Mot de passe obligatoire.' })
  password: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères.' })
  @MaxLength(100)
  newPassword: string;
}

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto) {
    const login = dto.email.trim();
    const user = login.includes('@')
      ? await this.prisma.user.findUnique({ where: { email: login.toLowerCase() } })
      : await this.prisma.user.findUnique({ where: { cin: login } });
    const ok = user && user.isActive && (await verifyPassword(dto.password, user.passwordHash));
    if (!ok) throw new UnauthorizedException('Identifiant ou mot de passe incorrect.');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { accessToken: signToken(user.id, user.roles.join(',')), mustChangePassword: user.mustChangePassword };
  }

  @ApiBearerAuth()
  @AllowPendingPassword()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() current: AuthUser, @Body() dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: current.id } });
    if (!(await verifyPassword(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Mot de passe actuel incorrect.');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('Le nouveau mot de passe doit être différent de l’actuel.');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(dto.newPassword), mustChangePassword: false, version: { increment: 1 } },
    });
    await this.audit.log(user.id, {
      action: 'Mot de passe changé',
      entity: 'User',
      entityId: user.id,
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
