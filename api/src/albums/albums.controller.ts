import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AlbumAudience, AlbumKind, Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser, can, CurrentUser, Perm, Public } from '../auth/auth-user';
import { dayFromIso, isoDay } from '../common/dates';
import { fullName } from '../common/rules';
import { imageType } from '../photos/photos.service';
import { PrismaService } from '../prisma/prisma.service';
import { AlbumsService } from './albums.service';

const MAX_FULL = 1600 * 1024;
const MAX_THUMB = 250 * 1024;
const MAX_PHOTOS = 300;

const KIND_LABEL: Record<AlbumKind, string> = { TOURNAMENT: 'Tournoi', MATCH: 'Match', GROUP: 'Groupe', EVENT: 'Événement', FREE: 'Album' };
const AUDIENCE_LABEL: Record<AlbumAudience, string> = { CONTEXT: 'Personnes concernées', EVERYONE: 'Tout le club', CUSTOM: 'Personnes choisies' };

class AlbumDto {
  @IsString() @IsNotEmpty({ message: 'Titre obligatoire.' }) @MaxLength(100) title: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsEnum(AlbumKind) kind: AlbumKind;
  @IsEnum(AlbumAudience) audience: AlbumAudience;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date obligatoire.' }) date: string;
  @IsOptional() @IsUUID() contextId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) userIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) playerIds?: string[];
}

class UpdateDto extends AlbumDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}

class TagsDto {
  @IsArray() @ArrayMaxSize(40) @IsUUID('all', { each: true }) playerIds: string[];
  @IsOptional() @IsString() @MaxLength(200) caption?: string;
}

class HideDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

class ConsentDto {
  @IsBoolean() consent: boolean;
}

class ModeDto {
  @IsIn(['OPT_IN', 'OPT_OUT']) mode: 'OPT_IN' | 'OPT_OUT';
}

class SearchQuery {
  @IsOptional() @IsString() @MaxLength(60) q?: string;
}

class ListQuery {
  @IsOptional() @IsUUID() playerId?: string;
}

const include = { members: true } satisfies Prisma.AlbumInclude;

/**
 * Albums photos du club : création (direction ; entraîneur pour ses groupes et ses matchs), envoi des photos réduites
 * dans le navigateur, identification des joueurs, retrait à la demande d'une famille, notification de l'audience.
 */
@ApiTags('Albums photos')
@ApiBearerAuth()
@Controller('albums')
export class AlbumsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly albums: AlbumsService,
    private readonly audit: AuditService,
  ) {}

  private async find(id: string) {
    const a = await this.prisma.album.findUnique({ where: { id }, include });
    if (!a) throw new NotFoundException('Album introuvable.');
    return a;
  }

  private async assertManage(user: AuthUser, id: string) {
    const a = await this.find(id);
    if (!this.albums.canManage(user, a)) throw new ForbiddenException('Réservé à la direction ou à l’auteur de l’album.');
    return a;
  }

  /** Libellé du contexte (nom du tournoi, du groupe…). */
  private async contextLabel(a: { kind: AlbumKind; tournamentId: string | null; matchId: string | null; groupId: string | null; eventId: string | null }) {
    if (a.tournamentId) return (await this.prisma.tournament.findUnique({ where: { id: a.tournamentId }, select: { name: true } }))?.name ?? null;
    if (a.matchId) {
      const m = await this.prisma.match.findUnique({ where: { id: a.matchId }, select: { playerAName: true, playerBName: true } });
      return m ? `${m.playerAName} – ${m.playerBName}` : null;
    }
    if (a.groupId) return (await this.prisma.trainingGroup.findUnique({ where: { id: a.groupId }, select: { name: true } }))?.name ?? null;
    if (a.eventId) return (await this.prisma.event.findUnique({ where: { id: a.eventId }, select: { title: true } }))?.title ?? null;
    return null;
  }

  /** Photos visibles par ce compte (autorisation photo, retraits). */
  private async visiblePhotos(user: AuthUser, albumIds: string[], manage: (albumId: string) => boolean) {
    const [mode, mine, photos] = await Promise.all([
      this.albums.mode(),
      this.albums.familyPlayers(user.id),
      this.prisma.albumPhoto.findMany({
        where: { albumId: { in: albumIds } },
        select: {
          id: true,
          albumId: true,
          createdAt: true,
          width: true,
          height: true,
          caption: true,
          hiddenAt: true,
          hiddenReason: true,
          tags: { select: { player: { select: { id: true, firstName: true, lastName: true, photoConsent: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return photos
      .map((p) => {
        const blocked = p.tags.filter((t) => this.albums.blocked(mode, t.player.photoConsent));
        const restricted = blocked.some((t) => !mine.includes(t.player.id));
        return { p, blocked, restricted, manage: manage(p.albumId) };
      })
      .filter(({ p, restricted, manage }) => manage || (!p.hiddenAt && !restricted))
      .map(({ p, blocked, restricted, manage }) => ({
        id: p.id,
        albumId: p.albumId,
        thumbUrl: this.albums.url(p, 'thumb'),
        fullUrl: this.albums.url(p, 'full'),
        width: p.width,
        height: p.height,
        caption: p.caption,
        tags: p.tags.map((t) => ({ id: t.player.id, name: fullName(t.player).trim() })),
        mine: p.tags.some((t) => mine.includes(t.player.id)),
        // Direction : photo retirée, ou visible de la seule famille d'un joueur sans autorisation.
        hidden: manage && p.hiddenAt ? (p.hiddenReason ?? 'Retirée') : null,
        withoutConsent: manage && restricted ? blocked.map((t) => fullName(t.player).trim()) : [],
        createdAt: p.createdAt,
      }));
  }

  /** Image signée (vignette ou grande). */
  @Get('photos/:id')
  @Public()
  async image(@Param('id', ParseUUIDPipe) id: string, @Query('k') k: string, @Query('v') v: string, @Query('e') e: string, @Query('s') s: string, @Res() res: Response) {
    if (!this.albums.verify(id, v, e, s)) throw new NotFoundException('Photo introuvable ou lien expiré.');
    const p = await this.prisma.albumPhoto.findUnique({ where: { id }, select: { mime: true, data: k === 'full', thumb: k !== 'full', createdAt: true } });
    if (!p || `${k === 'full' ? 'full' : 'thumb'}.${p.createdAt.getTime().toString(36)}` !== v) throw new NotFoundException('Photo introuvable.');
    res.setHeader('Content-Type', k === 'full' ? p.mime : 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from((k === 'full' ? p.data : p.thumb) as Uint8Array));
  }

  /** Albums que je peux voir (couverture, nombre de photos) ; `playerId` : seulement les photos de cet enfant. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    const rows = await this.prisma.album.findMany({ where: this.albums.manager(user) ? {} : { archivedAt: null }, include, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 });
    const visible: typeof rows = [];
    for (const a of rows) if (await this.albums.canSee(user, a)) visible.push(a);
    const photos = await this.visiblePhotos(user, visible.map((a) => a.id), (albumId) => this.albums.canManage(user, visible.find((a) => a.id === albumId)!));
    const out = [];
    for (const a of visible) {
      const own = photos.filter((p) => p.albumId === a.id && (!q.playerId || p.tags.some((t) => t.id === q.playerId)));
      if (q.playerId && !own.length) continue;
      out.push({
        id: a.id,
        title: a.title,
        kind: a.kind,
        kindLabel: KIND_LABEL[a.kind],
        audience: a.audience,
        audienceLabel: AUDIENCE_LABEL[a.audience],
        context: await this.contextLabel(a),
        date: isoDay(a.date),
        photos: own.length,
        cover: own[0]?.thumbUrl ?? null,
        archived: Boolean(a.archivedAt),
        canManage: this.albums.canManage(user, a),
      });
    }
    return { canCreate: this.albums.manager(user) || user.role === Role.COACH, albums: out };
  }

  /** Contextes possibles à la création : tournois, matchs, groupes (entraîneur : les siens), événements. */
  @Get('contexts')
  async contexts(@CurrentUser() user: AuthUser) {
    const since = new Date(Date.now() - 365 * 86_400_000);
    const coachGroups = user.role === Role.COACH ? { slots: { some: { coaches: { some: { coachId: user.coachId ?? '00000000-0000-0000-0000-000000000000' } } } } } : {};
    const [tournaments, matches, groups, events] = await Promise.all([
      this.albums.manager(user) ? this.prisma.tournament.findMany({ where: { startDate: { gte: since }, status: { not: 'CANCELLED' } }, orderBy: { startDate: 'desc' }, select: { id: true, name: true, startDate: true } }) : [],
      this.prisma.match.findMany({ where: { date: { gte: new Date(Date.now() - 90 * 86_400_000) } }, orderBy: { date: 'desc' }, take: 60, select: { id: true, playerAName: true, playerBName: true, date: true, title: true } }),
      this.prisma.trainingGroup.findMany({ where: { archivedAt: null, season: { status: 'ACTIVE' }, ...coachGroups }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.albums.manager(user) ? this.prisma.event.findMany({ where: { date: { gte: since } }, orderBy: { date: 'desc' }, select: { id: true, title: true, date: true } }) : [],
    ]);
    return {
      tournaments: tournaments.map((t) => ({ id: t.id, label: t.name, date: isoDay(t.startDate) })),
      matches: matches.map((m) => ({ id: m.id, label: `${m.playerAName} – ${m.playerBName}${m.title ? ` · ${m.title}` : ''}`, date: isoDay(m.date) })),
      groups: groups.map((g) => ({ id: g.id, label: g.name, date: null })),
      events: events.map((e) => ({ id: e.id, label: e.title, date: isoDay(e.date) })),
    };
  }

  /** Personnes à ajouter : tout compte actif (parent, joueur, entraîneur, arbitre…) et joueurs sans compte (leur famille). */
  @Get('people')
  async people(@Query() q: SearchQuery) {
    const s = q.q?.trim();
    if (!s || s.length < 2) return { users: [], players: [] };
    const name = { OR: [{ firstName: { contains: s, mode: 'insensitive' as const } }, { lastName: { contains: s, mode: 'insensitive' as const } }] };
    const [users, players] = await Promise.all([
      this.prisma.user.findMany({ where: { isActive: true, ...name }, take: 12, select: { id: true, firstName: true, lastName: true, roles: true } }),
      this.prisma.player.findMany({ where: { archivedAt: null, ...name }, take: 12, select: { id: true, firstName: true, lastName: true, memberCode: true } }),
    ]);
    return {
      users: users.map((u) => ({ id: u.id, name: fullName(u).trim(), roles: u.roles })),
      players: players.map((p) => ({ id: p.id, name: fullName(p).trim(), code: p.memberCode })),
    };
  }

  /** Règle d'autorisation photo du club et réponses de ma famille. */
  @Get('consent')
  async consent(@CurrentUser() user: AuthUser) {
    const ids = await this.albums.familyPlayers(user.id);
    const players = await this.prisma.player.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true, firstName: true, lastName: true, photoConsent: true, photoConsentAt: true } });
    return { mode: await this.albums.mode(), players: players.map((p) => ({ id: p.id, name: fullName(p).trim(), consent: p.photoConsent, at: p.photoConsentAt })) };
  }

  /** Autorisation photo : famille du joueur (parent, joueur), ou administration (joueurs). */
  @Put('consent/:playerId')
  async setConsent(@CurrentUser() user: AuthUser, @Param('playerId', ParseUUIDPipe) playerId: string, @Body() dto: ConsentDto) {
    const own = await this.albums.familyPlayers(user.id);
    if (!own.includes(playerId) && !(user.role === Role.ADMIN && can(user, 'players.manage'))) throw new ForbiddenException('Seule la famille du joueur répond.');
    const p = await this.prisma.player.update({ where: { id: playerId }, data: { photoConsent: dto.consent, photoConsentAt: new Date() }, select: { firstName: true, lastName: true } });
    await this.audit.log(user.id, { action: dto.consent ? 'Autorisation photo accordée' : 'Autorisation photo refusée', entity: 'Player', entityId: playerId, target: fullName(p).trim() });
    return { ok: true };
  }

  @Put('settings')
  @Perm('permissions.manage')
  async setMode(@CurrentUser() user: AuthUser, @Body() dto: ModeDto) {
    await this.albums.setMode(dto.mode);
    await this.audit.log(user.id, { action: 'Règle des photos modifiée', entity: 'Setting', entityId: 'photos.consent', target: 'Règle des photos', after: dto.mode === 'OPT_IN' ? 'Pas d’autorisation = pas de photo' : 'Autorisé sauf refus' });
    return { mode: dto.mode };
  }

  /** Contexte de l'album : contrôlé (l'entraîneur ne crée que pour ses groupes et les matchs). */
  private async context(user: AuthUser, dto: AlbumDto) {
    const none = { tournamentId: null, matchId: null, groupId: null, eventId: null };
    const manager = this.albums.manager(user);
    if (!manager && user.role !== Role.COACH) throw new ForbiddenException('Réservé à la direction et aux entraîneurs.');
    if (!manager && (dto.kind === AlbumKind.TOURNAMENT || dto.kind === AlbumKind.EVENT || dto.audience === AlbumAudience.EVERYONE)) {
      throw new ForbiddenException('Tournois, événements et albums pour tout le club : direction seulement.');
    }
    if (dto.kind === AlbumKind.FREE) return none;
    if (!dto.contextId) throw new BadRequestException('Choisissez le tournoi, le match, le groupe ou l’événement.');
    if (dto.kind === AlbumKind.TOURNAMENT) {
      if (!(await this.prisma.tournament.findUnique({ where: { id: dto.contextId } }))) throw new NotFoundException('Tournoi introuvable.');
      return { ...none, tournamentId: dto.contextId };
    }
    if (dto.kind === AlbumKind.MATCH) {
      if (!(await this.prisma.match.findUnique({ where: { id: dto.contextId } }))) throw new NotFoundException('Match introuvable.');
      return { ...none, matchId: dto.contextId };
    }
    if (dto.kind === AlbumKind.GROUP) {
      const g = await this.prisma.trainingGroup.findUnique({ where: { id: dto.contextId }, include: { slots: { include: { coaches: true } } } });
      if (!g) throw new NotFoundException('Groupe introuvable.');
      if (!manager && !g.slots.some((s) => s.coaches.some((c) => c.coachId === user.coachId))) throw new ForbiddenException('Ce groupe n’est pas le vôtre.');
      return { ...none, groupId: dto.contextId };
    }
    if (!(await this.prisma.event.findUnique({ where: { id: dto.contextId } }))) throw new NotFoundException('Événement introuvable.');
    return { ...none, eventId: dto.contextId };
  }

  private members(dto: AlbumDto) {
    return [...new Set(dto.userIds ?? [])].map((userId) => ({ userId })).concat([...new Set(dto.playerIds ?? [])].map((playerId) => ({ playerId }) as never));
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: AlbumDto) {
    const ctx = await this.context(user, dto);
    if (dto.audience === AlbumAudience.CUSTOM && !dto.userIds?.length && !dto.playerIds?.length) throw new BadRequestException('Choisissez au moins une personne.');
    const a = await this.prisma.album.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        kind: dto.kind,
        audience: dto.audience,
        date: dayFromIso(dto.date),
        ...ctx,
        createdById: user.id,
        members: { create: this.members(dto) },
      },
    });
    await this.audit.log(user.id, { action: 'Album photos créé', entity: 'Album', entityId: a.id, target: a.title, after: `${KIND_LABEL[a.kind]} · ${AUDIENCE_LABEL[a.audience]}` });
    return { id: a.id };
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDto) {
    const a = await this.assertManage(user, id);
    if (a.version !== dto.version) throw new BadRequestException('R13 · Album modifié entre-temps : rechargez la page.');
    const ctx = await this.context(user, dto);
    await this.prisma.$transaction([
      this.prisma.albumMember.deleteMany({ where: { albumId: id } }),
      this.prisma.album.update({
        where: { id },
        data: { title: dto.title.trim(), description: dto.description?.trim() || null, kind: dto.kind, audience: dto.audience, date: dayFromIso(dto.date), ...ctx, version: { increment: 1 }, members: { create: this.members(dto) } },
      }),
    ]);
    await this.audit.log(user.id, { action: 'Album photos modifié', entity: 'Album', entityId: id, target: dto.title });
    return { ok: true };
  }

  /** Archiver (R8) : l'album disparaît pour les familles ; restaurable par la direction. */
  @Post(':id/archive')
  @HttpCode(200)
  async archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body('restore') restore?: boolean) {
    const a = await this.assertManage(user, id);
    await this.prisma.album.update({ where: { id }, data: { archivedAt: restore ? null : new Date(), version: { increment: 1 } } });
    await this.audit.log(user.id, { action: restore ? 'Album photos restauré' : 'Album photos archivé', entity: 'Album', entityId: id, target: a.title });
    return { ok: true };
  }

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.find(id);
    if (!(await this.albums.canSee(user, a))) throw new NotFoundException('Album introuvable.');
    const manage = this.albums.canManage(user, a);
    const [photos, ctxPlayers, members] = await Promise.all([
      this.visiblePhotos(user, [id], () => manage),
      manage ? this.albums.contextPlayers(a) : Promise.resolve([] as string[]),
      manage
        ? this.prisma.albumMember.findMany({ where: { albumId: id }, include: { user: { select: { id: true, firstName: true, lastName: true } }, player: { select: { id: true, firstName: true, lastName: true } } } })
        : Promise.resolve([]),
    ]);
    const candidates = manage
      ? await this.prisma.player.findMany({ where: { id: { in: ctxPlayers }, archivedAt: null }, select: { id: true, firstName: true, lastName: true, photoConsent: true }, orderBy: { lastName: 'asc' } })
      : [];
    const mode = await this.albums.mode();
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      kind: a.kind,
      kindLabel: KIND_LABEL[a.kind],
      audience: a.audience,
      audienceLabel: AUDIENCE_LABEL[a.audience],
      context: await this.contextLabel(a),
      contextId: a.tournamentId ?? a.matchId ?? a.groupId ?? a.eventId,
      date: isoDay(a.date),
      archived: Boolean(a.archivedAt),
      notifiedAt: a.notifiedAt,
      version: a.version,
      canManage: manage,
      mode,
      members: members.map((m) => (m.user ? { kind: 'user' as const, id: m.user.id, name: fullName(m.user).trim() } : { kind: 'player' as const, id: m.player!.id, name: fullName(m.player!).trim() })),
      candidates: candidates.map((p) => ({ id: p.id, name: fullName(p).trim(), allowed: !this.albums.blocked(mode, p.photoConsent) })),
      photos,
    };
  }

  /** Envoi d'une photo (grande + vignette préparées dans le navigateur). */
  @Post(':id/photos')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }], { limits: { fileSize: MAX_FULL } }))
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: { file?: { buffer: Buffer }[]; thumb?: { buffer: Buffer }[] },
    @Body('width') width?: string,
    @Body('height') height?: string,
  ) {
    await this.assertManage(user, id);
    const full = files?.file?.[0]?.buffer;
    const thumb = files?.thumb?.[0]?.buffer;
    if (!full?.length || !thumb?.length) throw new BadRequestException('Photo manquante.');
    if (thumb.length > MAX_THUMB) throw new BadRequestException('Vignette trop lourde.');
    const mime = imageType(full);
    if (!mime || imageType(thumb) !== 'image/jpeg') throw new BadRequestException('Photo : JPG, PNG ou WEBP.');
    if ((await this.prisma.albumPhoto.count({ where: { albumId: id } })) >= MAX_PHOTOS) throw new BadRequestException(`Album complet (${MAX_PHOTOS} photos) : créez un 2e album.`);
    const p = await this.prisma.albumPhoto.create({
      data: { albumId: id, mime, data: full, thumb, width: Number(width) || 0, height: Number(height) || 0, uploadedById: user.id },
      select: { id: true },
    });
    return { id: p.id };
  }

  /** Prévenir l'audience des nouvelles photos (notification, une par envoi groupé). */
  @Post(':id/notify')
  @HttpCode(200)
  async notifyAudience(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.assertManage(user, id);
    if (a.archivedAt) throw new BadRequestException('Album archivé.');
    const count = await this.prisma.albumPhoto.count({ where: { albumId: id, hiddenAt: null, ...(a.notifiedAt ? { createdAt: { gt: a.notifiedAt } } : {}) } });
    if (!count) throw new BadRequestException('Aucune nouvelle photo depuis la dernière notification.');
    const users = (await this.albums.audienceUsers(a)).filter((u) => u !== user.id);
    await this.albums.notify(users, `📷 ${count} nouvelle${count > 1 ? 's' : ''} photo${count > 1 ? 's' : ''} : ${a.title}`, (await this.contextLabel(a)) ?? KIND_LABEL[a.kind], `/photos/${id}`);
    await this.prisma.album.update({ where: { id }, data: { notifiedAt: new Date() } });
    await this.audit.log(user.id, { action: 'Album photos publié', entity: 'Album', entityId: id, target: a.title, after: `${count} photo(s), ${users.length} personne(s) prévenue(s)` });
    return { notified: users.length, photos: count };
  }

  /** Identification des joueurs et légende ; les familles des joueurs identifiés sont prévenues. */
  @Put(':id/photos/:photoId/tags')
  async tags(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Body() dto: TagsDto) {
    const a = await this.assertManage(user, id);
    const before = await this.prisma.photoTag.findMany({ where: { photoId }, select: { playerId: true } });
    const ids = [...new Set(dto.playerIds)];
    await this.prisma.$transaction([
      this.prisma.photoTag.deleteMany({ where: { photoId, photo: { albumId: id } } }),
      this.prisma.photoTag.createMany({ data: ids.map((playerId) => ({ photoId, playerId })), skipDuplicates: true }),
      this.prisma.albumPhoto.updateMany({ where: { id: photoId, albumId: id }, data: { caption: dto.caption?.trim() || null } }),
    ]);
    const added = ids.filter((p) => !before.some((b) => b.playerId === p));
    if (added.length && a.notifiedAt) await this.albums.notify((await this.albums.families(added)).filter((u) => u !== user.id), `📷 Nouvelle photo de votre enfant`, a.title, `/photos/${id}`);
    return { ok: true };
  }

  /** Retirer une photo : la famille d'un joueur identifié (tout de suite, direction prévenue), ou la direction. */
  @Post(':id/photos/:photoId/hide')
  @HttpCode(200)
  async hide(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string, @Body() dto: HideDto) {
    const a = await this.find(id);
    const photo = await this.prisma.albumPhoto.findFirst({ where: { id: photoId, albumId: id }, include: { tags: true } });
    if (!photo) throw new NotFoundException('Photo introuvable.');
    const own = await this.albums.familyPlayers(user.id);
    const family = photo.tags.some((t) => own.includes(t.playerId));
    if (!family && !this.albums.canManage(user, a)) throw new ForbiddenException('Seule la famille d’un joueur sur la photo peut la retirer.');
    const reason = dto.reason?.trim() || (family ? 'Retirée à la demande de la famille' : 'Retirée par la direction');
    await this.prisma.albumPhoto.update({ where: { id: photoId }, data: { hiddenAt: new Date(), hiddenById: user.id, hiddenReason: reason } });
    await this.audit.log(user.id, { action: 'Photo retirée', entity: 'Album', entityId: id, target: a.title, reason });
    if (family) {
      const to = [...new Set([...(await this.albums.albumManagers()), a.createdById])].filter((u) => u !== user.id);
      await this.albums.notify(to, `Photo retirée à la demande d’une famille`, `${a.title} · ${fullName(user).trim()}`, `/photos/${id}`);
    }
    return { ok: true };
  }

  @Post(':id/photos/:photoId/restore')
  @HttpCode(200)
  async restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    const a = await this.assertManage(user, id);
    await this.prisma.albumPhoto.updateMany({ where: { id: photoId, albumId: id }, data: { hiddenAt: null, hiddenById: null, hiddenReason: null } });
    await this.audit.log(user.id, { action: 'Photo remise en ligne', entity: 'Album', entityId: id, target: a.title });
    return { ok: true };
  }

  @Delete(':id/photos/:photoId')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    const a = await this.assertManage(user, id);
    await this.prisma.albumPhoto.deleteMany({ where: { id: photoId, albumId: id } });
    await this.audit.log(user.id, { action: 'Photo supprimée', entity: 'Album', entityId: id, target: a.title });
    return { ok: true };
  }
}
