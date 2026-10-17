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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { EventAudience, Prisma, SeasonStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm, Public } from '../auth/auth-user';
import { dayFromIso, isoDay, todayIso } from '../common/dates';
import { fullName } from '../common/rules';
import { imageType } from '../photos/photos.service';
import { PrismaService } from '../prisma/prisma.service';
import { AlbumsService } from '../albums/albums.service';
import { EventsService } from './events.service';

const MAX_POSTER = 1024 * 1024;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const AUDIENCE_LABEL: Record<EventAudience, string> = { EVERYONE: 'Tout le club', GROUPS: 'Groupes', CATEGORIES: 'Catégories', CUSTOM: 'Personnes choisies' };

class EventDto {
  @IsString() @IsNotEmpty({ message: 'Titre obligatoire.' }) @MaxLength(100) title: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date au format AAAA-MM-JJ.' }) date: string;
  @IsOptional() @Transform(({ value }) => value || undefined) @Matches(TIME, { message: 'Heure de début au format HH:MM.' }) startTime?: string;
  @IsOptional() @Transform(({ value }) => value || undefined) @Matches(TIME, { message: 'Heure de fin au format HH:MM.' }) endTime?: string;
  @IsString() @IsNotEmpty({ message: 'Lieu obligatoire.' }) @MaxLength(100) place: string;
  @IsString() @IsNotEmpty({ message: 'Type obligatoire.' }) @MaxLength(30) tag: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsEnum(EventAudience) audience: EventAudience;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @IsUUID('all', { each: true }) groupIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsUUID('all', { each: true }) categoryIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) userIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) playerIds?: string[];
  /** Avec participation (« Je participe ») ou affichage seulement. */
  @IsBoolean() rsvp: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1, { message: 'Places : au moins 1.' }) @Max(5000) capacity?: number | null;
  /** Publier tout de suite (notification) ; sinon brouillon. */
  @IsOptional() @IsBoolean() publish?: boolean;
}

class UpdateDto extends EventDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
  /** Prévenir l'audience de la modification. */
  @IsOptional() @IsBoolean() notifyChange?: boolean;
}

class RespondDto {
  @IsBoolean() going: boolean;
  @IsOptional() @IsUUID() playerId?: string;
}

class ListQuery {
  @IsOptional() @IsString() past?: string;
}

class SearchQuery {
  @IsOptional() @IsString() @MaxLength(60) q?: string;
}

/** Tous les champs sauf l'image de l'affiche (lue seulement par `GET :id/poster`). */
const select = {
  id: true, title: true, date: true, startTime: true, endTime: true, place: true, tag: true, description: true, audience: true,
  groupIds: true, categoryIds: true, rsvp: true, capacity: true, posterMime: true, createdById: true, notifiedAt: true,
  remindedAt: true, archivedAt: true, version: true, published: true, createdAt: true, updatedAt: true, members: true,
} satisfies Prisma.EventSelect;
type Row = Prisma.EventGetPayload<{ select: typeof select }>;

/**
 * Événements du club (fête, stage, réunion, sortie…) : avec participation (places limitées au choix) ou affichage seulement.
 * Audience : tout le club, groupes, catégories ou personnes choisies. Notification à la publication, rappel la veille.
 */
@ApiTags('Événements')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly albums: AlbumsService,
    private readonly audit: AuditService,
  ) {}

  private async find(id: string) {
    const e = await this.prisma.event.findUnique({ where: { id }, select });
    if (!e) throw new NotFoundException('Événement introuvable.');
    return e;
  }

  private assertManager(user: AuthUser) {
    if (!this.events.manager(user)) throw new ForbiddenException('Réservé aux responsables des événements.');
  }

  private async counts(ids: string[]) {
    const rows = ids.length ? await this.prisma.eventResponse.groupBy({ by: ['eventId', 'going'], where: { eventId: { in: ids } }, _count: true }) : [];
    const out = new Map<string, { going: number; notGoing: number }>();
    ids.forEach((id) => out.set(id, { going: 0, notGoing: 0 }));
    rows.forEach((r) => {
      const c = out.get(r.eventId)!;
      if (r.going) c.going = r._count;
      else c.notGoing = r._count;
    });
    return out;
  }

  /** Personnes pour qui ce compte répond : ses enfants concernés, sinon lui-même. */
  private async respondents(user: AuthUser, e: Row, a: Awaited<ReturnType<EventsService['audience']>>) {
    const family = await this.events.familyPlayers(user.id);
    const kids = family.filter((p) => a.everyone || a.players.has(p.id));
    const out = kids.map((p) => ({ key: p.id, playerId: p.id as string | null, name: p.userId === user.id ? 'Moi' : fullName(p).trim() }));
    if (!out.length && (a.everyone || a.users.has(user.id))) out.push({ key: user.id, playerId: null, name: 'Moi' });
    const answers = await this.prisma.eventResponse.findMany({ where: { eventId: e.id, key: { in: out.map((o) => o.key) } } });
    return out.map((o) => ({ ...o, going: answers.find((x) => x.key === o.key)?.going ?? null }));
  }

  private summary(e: Row, count: { going: number; notGoing: number }, manager: boolean) {
    return {
      id: e.id,
      title: e.title,
      date: isoDay(e.date),
      startTime: e.startTime,
      endTime: e.endTime,
      place: e.place,
      tag: e.tag,
      description: e.description,
      audience: e.audience,
      audienceLabel: AUDIENCE_LABEL[e.audience],
      rsvp: e.rsvp,
      capacity: e.capacity,
      going: count.going,
      full: Boolean(e.rsvp && e.capacity && count.going >= e.capacity),
      posterUrl: this.events.posterUrl(e),
      published: e.published,
      archived: Boolean(e.archivedAt),
      canManage: manager,
    };
  }

  /** Image de l'affiche (adresse signée). */
  @Get(':id/poster')
  @Public()
  async poster(@Param('id', ParseUUIDPipe) id: string, @Query('v') v: string, @Query('e') e: string, @Query('s') s: string, @Res() res: Response) {
    if (!this.events.verify(id, v, e, s)) throw new NotFoundException('Affiche introuvable ou lien expiré.');
    const ev = await this.prisma.event.findUnique({ where: { id }, select: { poster: true, posterMime: true, updatedAt: true } });
    if (!ev?.poster || !ev.posterMime || ev.updatedAt.getTime().toString(36) !== v) throw new NotFoundException('Affiche introuvable.');
    res.setHeader('Content-Type', ev.posterMime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(ev.poster as Uint8Array));
  }

  /** Événements qui me concernent : à venir (par défaut) ou passés (`past=1`). Direction : tous, brouillons et archivés compris. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    const past = q.past === '1' || q.past === 'true';
    const today = dayFromIso(todayIso());
    const manager = this.events.manager(user);
    const rows = await this.prisma.event.findMany({
      where: { date: past ? { lt: today } : { gte: today }, ...(manager ? {} : { archivedAt: null, published: true }) },
      select,
      orderBy: { date: past ? 'desc' : 'asc' },
      take: past ? 60 : 200,
    });
    const visible: Row[] = [];
    for (const e of rows) if (await this.events.canSee(user, e)) visible.push(e);
    const counts = await this.counts(visible.map((e) => e.id));
    const mine = await this.prisma.eventResponse.findMany({ where: { eventId: { in: visible.map((e) => e.id) }, userId: user.id }, select: { eventId: true, going: true } });
    return visible.map((e) => ({ ...this.summary(e, counts.get(e.id)!, manager), myGoing: mine.filter((m) => m.eventId === e.id).some((m) => m.going) }));
  }

  /** Groupes et catégories de la saison active (formulaire). */
  @Get('options')
  @Perm('events.manage')
  async options() {
    const [groups, categories] = await Promise.all([
      this.prisma.trainingGroup.findMany({ where: { archivedAt: null, season: { status: SeasonStatus.ACTIVE } }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.category.findMany({ where: { archivedAt: null }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } }),
    ]);
    return { groups: groups.map((g) => ({ id: g.id, label: g.name })), categories: categories.map((c) => ({ id: c.id, label: c.name })) };
  }

  /** Personnes à inviter : comptes actifs et joueurs (leur famille). */
  @Get('people')
  @Perm('events.manage')
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

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.find(id);
    const a = await this.events.audience(e);
    if (!(await this.events.canSee(user, e, a))) throw new NotFoundException('Événement introuvable.');
    const manager = this.events.manager(user);
    const count = (await this.counts([id])).get(id)!;
    const [respondents, albums, responses, members, groups, categories] = await Promise.all([
      this.respondents(user, e, a),
      this.prisma.album.findMany({ where: { eventId: id }, include: { members: true }, orderBy: { date: 'desc' } }),
      manager
        ? this.prisma.eventResponse.findMany({
            where: { eventId: id },
            include: { user: { select: { firstName: true, lastName: true } }, player: { select: { firstName: true, lastName: true } } },
            orderBy: { updatedAt: 'desc' },
          })
        : Promise.resolve([]),
      manager
        ? this.prisma.eventMember.findMany({ where: { eventId: id }, include: { user: { select: { id: true, firstName: true, lastName: true } }, player: { select: { id: true, firstName: true, lastName: true } } } })
        : Promise.resolve([]),
      e.groupIds.length ? this.prisma.trainingGroup.findMany({ where: { id: { in: e.groupIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      e.categoryIds.length ? this.prisma.category.findMany({ where: { id: { in: e.categoryIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const seen = [];
    for (const al of albums) if (await this.albums.canSee(user, al)) seen.push(al);
    const photos = seen.length ? await this.prisma.albumPhoto.groupBy({ by: ['albumId'], where: { albumId: { in: seen.map((x) => x.id) }, hiddenAt: null }, _count: true }) : [];
    const past = isoDay(e.date) < todayIso();
    return {
      ...this.summary(e, count, manager),
      notGoing: manager ? count.notGoing : undefined,
      past,
      version: e.version,
      notifiedAt: e.notifiedAt,
      groups: groups.map((g) => ({ id: g.id, label: g.name })),
      categories: categories.map((c) => ({ id: c.id, label: c.name })),
      members: members.map((m) => (m.user ? { kind: 'user' as const, id: m.user.id, name: fullName(m.user).trim() } : { kind: 'player' as const, id: m.player!.id, name: fullName(m.player!).trim() })),
      respondents: e.rsvp && !e.archivedAt ? respondents : [],
      responses: responses.map((r) => ({
        name: fullName(r.player ?? r.user).trim(),
        by: r.player && fullName(r.player) !== fullName(r.user) ? fullName(r.user).trim() : null,
        going: r.going,
        at: r.updatedAt,
      })),
      albums: seen.map((al) => ({ id: al.id, title: al.title, photos: photos.find((p) => p.albumId === al.id)?._count ?? 0, archived: Boolean(al.archivedAt) })),
      canCreateAlbum: this.albums.manager(user),
    };
  }

  private async check(dto: EventDto, going = 0) {
    if (dto.startTime && dto.endTime && dto.endTime <= dto.startTime) throw new BadRequestException('L’heure de fin doit suivre l’heure de début.');
    if (dto.audience === EventAudience.GROUPS && !dto.groupIds?.length) throw new BadRequestException('Choisissez au moins un groupe.');
    if (dto.audience === EventAudience.CATEGORIES && !dto.categoryIds?.length) throw new BadRequestException('Choisissez au moins une catégorie.');
    if (dto.audience === EventAudience.CUSTOM && !dto.userIds?.length && !dto.playerIds?.length) throw new BadRequestException('Choisissez au moins une personne.');
    if (dto.rsvp && dto.capacity && dto.capacity < going) throw new BadRequestException(`Places : déjà ${going} participant${going > 1 ? 's' : ''}.`);
  }

  private data(dto: EventDto) {
    return {
      title: dto.title.trim(),
      date: dayFromIso(dto.date),
      startTime: dto.startTime || null,
      endTime: dto.endTime || null,
      place: dto.place.trim(),
      tag: dto.tag.trim(),
      description: dto.description?.trim() || null,
      audience: dto.audience,
      groupIds: dto.audience === EventAudience.GROUPS ? [...new Set(dto.groupIds ?? [])] : [],
      categoryIds: dto.audience === EventAudience.CATEGORIES ? [...new Set(dto.categoryIds ?? [])] : [],
      rsvp: dto.rsvp,
      capacity: dto.rsvp ? (dto.capacity ?? null) : null,
    };
  }

  private members(dto: EventDto) {
    if (dto.audience !== EventAudience.CUSTOM) return [];
    return [...[...new Set(dto.userIds ?? [])].map((userId) => ({ userId, playerId: null })), ...[...new Set(dto.playerIds ?? [])].map((playerId) => ({ userId: null, playerId }))];
  }

  private when(e: { date: Date; startTime: string | null; place: string }) {
    const d = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(e.date);
    return [d, e.startTime ? `à ${e.startTime}` : null, e.place].filter(Boolean).join(' · ');
  }

  /** Publication : l'audience est prévenue (une fois). */
  private async announce(user: AuthUser, id: string) {
    const e = await this.find(id);
    const users = (await this.events.audienceUsers(e)).filter((u) => u !== user.id);
    await this.events.notify(users, `📅 ${e.title}`, `${this.when(e)}${e.rsvp ? ' · Répondez « Je participe »' : ''}`, `/evenements/${id}`);
    await this.prisma.event.update({ where: { id }, data: { notifiedAt: new Date() } });
    return users.length;
  }

  @Post()
  @Perm('events.manage')
  async create(@CurrentUser() user: AuthUser, @Body() dto: EventDto) {
    this.assertManager(user);
    await this.check(dto);
    const e = await this.prisma.event.create({ data: { ...this.data(dto), published: Boolean(dto.publish), createdById: user.id, members: { create: this.members(dto) } } });
    await this.audit.log(user.id, {
      action: 'Événement créé',
      entity: 'Event',
      entityId: e.id,
      target: e.title,
      after: `${isoDay(e.date)} · ${AUDIENCE_LABEL[e.audience]} · ${e.rsvp ? `participation${e.capacity ? ` (${e.capacity} places)` : ''}` : 'affichage seulement'}${e.published ? '' : ' · brouillon'}`,
    });
    const notified = dto.publish ? await this.announce(user, e.id) : 0;
    return { id: e.id, notified };
  }

  @Patch(':id')
  @Perm('events.manage')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDto) {
    this.assertManager(user);
    const e = await this.find(id);
    if (e.version !== dto.version) throw new BadRequestException('R13 · Événement modifié entre-temps : rechargez la page.');
    const going = (await this.counts([id])).get(id)!.going;
    await this.check(dto, going);
    const data = this.data(dto);
    await this.prisma.$transaction([
      this.prisma.eventMember.deleteMany({ where: { eventId: id } }),
      this.prisma.event.update({
        where: { id },
        data: { ...data, version: { increment: 1 }, members: { create: this.members(dto) }, ...(isoDay(e.date) !== dto.date ? { remindedAt: null } : {}) },
      }),
      // Sans participation : les réponses n'ont plus d'objet.
      ...(dto.rsvp ? [] : [this.prisma.eventResponse.deleteMany({ where: { eventId: id } })]),
    ]);
    await this.audit.log(user.id, {
      action: 'Événement modifié',
      entity: 'Event',
      entityId: id,
      target: dto.title,
      before: `${isoDay(e.date)} ${e.startTime ?? ''} · ${e.place}`,
      after: `${dto.date} ${dto.startTime ?? ''} · ${dto.place}`,
    });
    let notified = 0;
    if (e.published && e.notifiedAt && dto.notifyChange) {
      const fresh = await this.find(id);
      const users = (await this.events.audienceUsers(fresh)).filter((u) => u !== user.id);
      await this.events.notify(users, `✏️ Événement modifié : ${fresh.title}`, this.when(fresh), `/evenements/${id}`);
      notified = users.length;
    }
    return { ok: true, notified };
  }

  /** Publier un brouillon (notification de l'audience). */
  @Post(':id/publish')
  @HttpCode(200)
  @Perm('events.manage')
  async publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    this.assertManager(user);
    const e = await this.find(id);
    if (e.archivedAt) throw new BadRequestException('Événement archivé.');
    if (e.published && e.notifiedAt) throw new BadRequestException('Événement déjà publié.');
    await this.prisma.event.update({ where: { id }, data: { published: true } });
    const notified = await this.announce(user, id);
    await this.audit.log(user.id, { action: 'Événement publié', entity: 'Event', entityId: id, target: e.title, after: `${notified} personne${notified > 1 ? 's' : ''} prévenue${notified > 1 ? 's' : ''}` });
    return { notified };
  }

  /** Affiche : image préparée dans le navigateur (réduite, sans GPS). */
  @Put(':id/poster')
  @Perm('events.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_POSTER } }))
  async setPoster(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: { buffer: Buffer }) {
    this.assertManager(user);
    const e = await this.find(id);
    if (!file?.buffer?.length) throw new BadRequestException('Image manquante.');
    const mime = imageType(file.buffer);
    if (!mime) throw new BadRequestException('Affiche : JPG, PNG ou WEBP.');
    await this.prisma.event.update({ where: { id }, data: { poster: file.buffer, posterMime: mime } });
    await this.audit.log(user.id, { action: 'Affiche d’événement ajoutée', entity: 'Event', entityId: id, target: e.title });
    return { ok: true };
  }

  @Delete(':id/poster')
  @Perm('events.manage')
  async removePoster(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    this.assertManager(user);
    const e = await this.find(id);
    await this.prisma.event.update({ where: { id }, data: { poster: null, posterMime: null } });
    await this.audit.log(user.id, { action: 'Affiche d’événement retirée', entity: 'Event', entityId: id, target: e.title });
    return { ok: true };
  }

  /** « Je participe / Je ne participe pas » : pour soi ou pour un enfant ; places limitées. */
  @Post(':id/respond')
  @HttpCode(200)
  async respond(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondDto) {
    const e = await this.find(id);
    const a = await this.events.audience(e);
    if (!(await this.events.canSee(user, e, a)) || e.archivedAt || !e.published) throw new NotFoundException('Événement introuvable.');
    if (!e.rsvp) throw new BadRequestException('Cet événement est affiché seulement : pas d’inscription.');
    if (isoDay(e.date) < todayIso()) throw new BadRequestException('Événement passé : réponse fermée.');
    const allowed = await this.respondents(user, e, a);
    const who = allowed.find((r) => (dto.playerId ? r.playerId === dto.playerId : r.playerId === null));
    if (!who) throw new ForbiddenException(dto.playerId ? 'Vous ne répondez que pour vos enfants concernés.' : 'Vous n’êtes pas invité à cet événement.');
    await this.prisma.$transaction(
      async (tx) => {
        // Verrou : deux réponses en même temps ne dépassent pas le nombre de places.
        await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${id}::uuid FOR UPDATE`;
        if (dto.going && e.capacity) {
          const taken = await tx.eventResponse.count({ where: { eventId: id, going: true, key: { not: who.key } } });
          if (taken >= e.capacity) throw new BadRequestException('Complet : plus de place disponible.');
        }
        await tx.eventResponse.upsert({
          where: { eventId_key: { eventId: id, key: who.key } },
          create: { eventId: id, key: who.key, userId: user.id, playerId: who.playerId, going: dto.going },
          update: { userId: user.id, going: dto.going },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    await this.audit.log(user.id, { action: dto.going ? 'Participation à un événement' : 'Absence à un événement', entity: 'Event', entityId: id, target: `${e.title} · ${who.name}` });
    return { ok: true };
  }

  /** Archiver (R8) : l'événement disparaît pour tous ; restaurable. */
  @Post(':id/archive')
  @HttpCode(200)
  @Perm('events.manage')
  async archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body('restore') restore?: boolean) {
    this.assertManager(user);
    const e = await this.find(id);
    await this.prisma.event.update({ where: { id }, data: { archivedAt: restore ? null : new Date(), version: { increment: 1 } } });
    await this.audit.log(user.id, { action: restore ? 'Événement restauré' : 'Événement archivé', entity: 'Event', entityId: id, target: e.title });
    return { ok: true };
  }
}
