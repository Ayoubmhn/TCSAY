import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AllowPendingPassword, AuthUser, CurrentUser } from '../auth/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { open, seal } from './secret-box';

class FederationDto {
  /** Identifiant IJIN ; vide = supprimer le compte fédération. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  login?: string;

  /** Nouveau mot de passe IJIN (facultatif : absent = inchangé, chaîne vide = supprimé). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}

/**
 * Compte fédération (IJIN) de chaque acteur, facultatif. Chacun ne voit et ne modifie que le sien ; le mot de passe est
 * chiffré en base et n'apparaît jamais dans le journal d'audit ni dans les emails.
 * L'accès direct au compte de la fédération (connexion automatique) sera développé plus tard.
 */
@ApiTags('Compte fédération (IJIN)')
@ApiBearerAuth()
@Controller('me/federation')
export class FederationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @AllowPendingPassword()
  async get(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { ijinLogin: true, ijinPasswordEnc: true } });
    return { login: u.ijinLogin, hasPassword: Boolean(u.ijinPasswordEnc) };
  }

  @Put()
  async save(@CurrentUser() user: AuthUser, @Body() dto: FederationDto) {
    const login = dto.login?.trim() || null;
    const data: { ijinLogin: string | null; ijinPasswordEnc?: string | null } = { ijinLogin: login };
    if (!login) data.ijinPasswordEnc = null;
    else if (dto.password !== undefined) data.ijinPasswordEnc = dto.password ? seal(dto.password) : null;
    const u = await this.prisma.user.update({ where: { id: user.id }, data, select: { ijinLogin: true, ijinPasswordEnc: true } });
    return { login: u.ijinLogin, hasPassword: Boolean(u.ijinPasswordEnc) };
  }

  /** Affiche le mot de passe IJIN à son propriétaire seulement. */
  @Post('reveal')
  @HttpCode(200)
  async reveal(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { ijinPasswordEnc: true } });
    if (!u.ijinPasswordEnc) throw new BadRequestException('Aucun mot de passe IJIN enregistré.');
    try {
      return { password: open(u.ijinPasswordEnc) };
    } catch {
      throw new BadRequestException('Mot de passe IJIN illisible (clé de chiffrement changée) : saisissez-le à nouveau.');
    }
  }
}
