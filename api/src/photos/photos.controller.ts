import { Controller, Delete, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AllowPendingPassword, AuthUser, can, CurrentUser, Perm, Public } from '../auth/auth-user';
import { fullName } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_PHOTO, PhotosService } from './photos.service';

type Upload = { buffer: Buffer };
const upload = () => UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO } }));

/**
 * Photos de profil : chacun change la sienne ; le parent celle de ses enfants (le joueur la sienne) ;
 * l'administration celle de tout compte ou joueur (photo inadaptée retirée). Visibles des seuls membres connectés.
 */
@ApiTags('Photos')
@ApiBearerAuth()
@Controller('photos')
export class PhotosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Image (adresse signée et datée, donnée par l'API dans les listes et les fiches). */
  @Get(':id')
  @Public()
  async image(@Param('id', ParseUUIDPipe) id: string, @Query('v') v: string, @Query('e') e: string, @Query('s') s: string, @Res() res: Response) {
    if (!this.photos.verify(id, v, e, s)) throw new NotFoundException('Photo introuvable ou lien expiré.');
    const p = await this.prisma.profilePhoto.findUnique({ where: { id }, select: { mime: true, data: true, updatedAt: true } });
    if (!p || p.updatedAt.getTime().toString(36) !== v) throw new NotFoundException('Photo introuvable.');
    res.setHeader('Content-Type', p.mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Disposition', 'inline');
    res.send(Buffer.from(p.data));
  }

  @Put('me')
  @AllowPendingPassword()
  @ApiConsumes('multipart/form-data')
  @upload()
  async setMine(@CurrentUser() user: AuthUser, @UploadedFile() file?: Upload) {
    const { data, mime } = this.photos.check(file);
    const p = await this.prisma.profilePhoto.upsert({ where: { userId: user.id }, create: { userId: user.id, data, mime, updatedById: user.id }, update: { data, mime, updatedById: user.id } });
    await this.audit.log(user.id, { action: 'Photo de profil changée', entity: 'User', entityId: user.id, target: fullName(user).trim() });
    return { photoUrl: this.photos.url(p) };
  }

  @Delete('me')
  @AllowPendingPassword()
  async removeMine(@CurrentUser() user: AuthUser) {
    await this.prisma.profilePhoto.deleteMany({ where: { userId: user.id } });
    await this.audit.log(user.id, { action: 'Photo de profil retirée', entity: 'User', entityId: user.id, target: fullName(user).trim() });
    return { photoUrl: null };
  }

  /** Joueur : administration (joueurs), parent du joueur, ou le joueur lui-même. */
  private async assertPlayer(user: AuthUser, playerId: string) {
    const p = await this.prisma.player.findUnique({ where: { id: playerId }, select: { id: true, firstName: true, lastName: true } });
    if (!p) throw new NotFoundException('Joueur introuvable.');
    if (user.role === Role.ADMIN) {
      if (!can(user, 'players.manage')) throw new ForbiddenException('Autorisation « joueurs » nécessaire.');
    } else if (user.role === Role.PARENT || user.role === Role.PLAYER) {
      await this.access.resolvePlayer(user, playerId);
    } else throw new ForbiddenException('Seuls le parent, le joueur ou l’administration changent cette photo.');
    return p;
  }

  @Put('players/:playerId')
  @ApiConsumes('multipart/form-data')
  @upload()
  async setPlayer(@CurrentUser() user: AuthUser, @Param('playerId', ParseUUIDPipe) playerId: string, @UploadedFile() file?: Upload) {
    const pl = await this.assertPlayer(user, playerId);
    const { data, mime } = this.photos.check(file);
    const p = await this.prisma.profilePhoto.upsert({ where: { playerId }, create: { playerId, data, mime, updatedById: user.id }, update: { data, mime, updatedById: user.id } });
    await this.audit.log(user.id, { action: 'Photo du joueur changée', entity: 'Player', entityId: playerId, target: fullName(pl).trim() });
    return { photoUrl: this.photos.url(p) };
  }

  @Delete('players/:playerId')
  async removePlayer(@CurrentUser() user: AuthUser, @Param('playerId', ParseUUIDPipe) playerId: string) {
    const pl = await this.assertPlayer(user, playerId);
    await this.prisma.profilePhoto.deleteMany({ where: { playerId } });
    await this.audit.log(user.id, { action: 'Photo du joueur retirée', entity: 'Player', entityId: playerId, target: fullName(pl).trim() });
    return { photoUrl: null };
  }

  /** Compte (parent, entraîneur, personnel, joueur avec compte) : administration. */
  @Put('users/:userId')
  @Perm('players.manage', 'parents.manage', 'coaches.manage', 'staff.manage')
  @ApiConsumes('multipart/form-data')
  @upload()
  async setUser(@CurrentUser() actor: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @UploadedFile() file?: Upload) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    if (!u) throw new NotFoundException('Compte introuvable.');
    const { data, mime } = this.photos.check(file);
    const p = await this.prisma.profilePhoto.upsert({ where: { userId }, create: { userId, data, mime, updatedById: actor.id }, update: { data, mime, updatedById: actor.id } });
    await this.audit.log(actor.id, { action: 'Photo de profil changée', entity: 'User', entityId: userId, target: fullName(u).trim() });
    return { photoUrl: this.photos.url(p) };
  }

  @Delete('users/:userId')
  @Perm('players.manage', 'parents.manage', 'coaches.manage', 'staff.manage')
  async removeUser(@CurrentUser() actor: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    if (!u) throw new NotFoundException('Compte introuvable.');
    await this.prisma.profilePhoto.deleteMany({ where: { userId } });
    await this.audit.log(actor.id, { action: 'Photo de profil retirée', entity: 'User', entityId: userId, target: fullName(u).trim() });
    return { photoUrl: null };
  }
}
