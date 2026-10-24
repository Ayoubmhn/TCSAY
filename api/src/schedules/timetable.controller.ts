import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailKind, Prisma, SlotKind, TempScheduleStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { isoDay, minutesOf, todayIso } from '../common/dates';
import { assertSeasonOpen, notFound, rule } from '../common/rules';
import { describe, SlotDto } from '../groups/groups.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { assertVolumes, durationOf, findConflict, type Placed } from './timetable-rules';

/** Créneau du brouillon (et vue brute d'un créneau publié) : identifiant gardé pour un créneau existant. */
type RawSlot = { id?: string; day: number; startTime: string; endTime: string; courtId: string | null; coachIds: string[]; kind: SlotKind };
type DraftMap = Record<string, RawSlot[]>;

class SeasonQuery {
  @IsOptional()
  @IsUUID()
  seasonId?: string;
}

class LoadQuery extends SeasonQuery {
  /** Brouillon affiché (sinon : l'emploi du temps publié). */
  @IsOptional()
  @IsUUID()
  draft?: string;
}

class CreateDraftDto extends SeasonQuery {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

class RenameDraftDto {
  @IsString()
  @IsNotEmpty({ message: 'Nom du brouillon obligatoire.' })
  @MaxLength(60)
  name: string;

  @IsInt()
  @Min(1)
  version: number;
}

class VersionQuery extends SeasonQuery {
  @IsOptional()
  @Matches(/^\d+$/)
  version?: string;
}

class DraftGroupDto {
  @IsArray()
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => SlotDto)
  slots: SlotDto[];

  /** Version du brouillon : R13. */
  @IsInt()
  @Min(1)
  version: number;
}

class PublishDto {
  @IsInt()
  @Min(0)
  version: number;

  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

class AutoDto {
  @IsInt()
  @Min(0)
  version: number;

  @IsOptional()
  @IsEnum(SlotKind)
  kind?: SlotKind;
}

const groupInclude = {
  category: { select: { name: true } },
  _count: { select: { members: true } },
  slots: { where: { scheduleId: null }, include: { coaches: { select: { coachId: true } }, court: { select: { name: true } } }, orderBy: [{ day: 'asc' as const }, { startTime: 'asc' as const }] },
} satisfies Prisma.TrainingGroupInclude;
type GroupRow = Prisma.TrainingGroupGetPayload<{ include: typeof groupInclude }>;

const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0];
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const sig = (s: RawSlot) => `${s.day}|${s.startTime}|${s.endTime}|${s.courtId ?? ''}|${[...s.coachIds].sort().join(',')}|${s.kind}`;
const sameSlots = (a: RawSlot[], b: RawSlot[]) => a.length === b.length && a.map(sig).sort().join('#') === b.map(sig).sort().join('#');

/**
 * Grille de l'emploi du temps habituel : volumes des groupes (tennis et séance physique), brouillon modifié séance par
 * séance (glisser-déposer), contrôles en direct (volume, terrain, entraîneur, groupe, éclairage dès la nuit), placement
 * automatique, puis publication en une fois (présences jamais perdues, R8 ; audit ; familles et entraîneurs prévenus).
 */
@ApiTags('Emploi du temps')
@ApiBearerAuth()
@Controller('timetable')
export class TimetableController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @Perm('groups.manage', 'planning.view')
  async get(@Query() q: LoadQuery) {
    const season = await this.access.seasonOrActive(q.seasonId);
    return this.load(season.id, q.draft);
  }

  /** Nouveau brouillon (vide : il part de l'emploi du temps publié). */
  @Post('drafts')
  @Perm('groups.manage')
  async createDraft(@CurrentUser() user: AuthUser, @Body() dto: CreateDraftDto) {
    const season = await this.access.seasonOrActive(dto.seasonId);
    assertSeasonOpen(season);
    const count = await this.prisma.timetableDraft.count({ where: { seasonId: season.id } });
    if (count >= 10) throw new BadRequestException('10 brouillons au plus : publiez ou supprimez-en un.');
    const name = dto.name?.trim() || `Brouillon ${count + 1}`;
    const d = await this.prisma.timetableDraft.create({ data: { seasonId: season.id, name, groups: {}, createdById: user.id, updatedById: user.id } });
    await this.audit.log(user.id, { action: 'Brouillon d’emploi du temps créé', entity: 'TimetableDraft', entityId: d.id, target: name });
    return this.load(season.id, d.id);
  }

  @Patch('drafts/:id')
  @Perm('groups.manage')
  async renameDraft(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameDraftDto) {
    const d = await this.findDraft(id);
    this.assertDraftVersion(d.version, dto.version);
    await this.prisma.timetableDraft.update({ where: { id }, data: { name: dto.name.trim(), updatedById: user.id, version: { increment: 1 } } });
    return this.load(d.seasonId, id);
  }

  /** Supprimer un brouillon (rien n'est encore publié : aucune donnée liée). */
  @Delete('drafts/:id')
  @Perm('groups.manage')
  async deleteDraft(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: VersionQuery) {
    const d = await this.findDraft(id);
    this.assertDraftVersion(d.version, q.version === undefined ? undefined : Number(q.version));
    await this.prisma.timetableDraft.delete({ where: { id } });
    await this.audit.log(user.id, { action: 'Brouillon d’emploi du temps supprimé', entity: 'TimetableDraft', entityId: id, target: d.name });
    return this.load(d.seasonId);
  }

  /** Créneaux d'un groupe dans un brouillon, tels qu'ils seront publiés (volume, conflits, éclairage vérifiés). */
  @Put('drafts/:id/groups/:groupId')
  @Perm('groups.manage')
  async setGroup(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: DraftGroupDto,
  ) {
    const ctx = await this.context(id, groupId);
    this.assertDraftVersion(ctx.draftVersion, dto.version);
    // Identifiant gardé seulement pour un créneau publié de ce groupe (une seule fois) : sinon nouvelle séance.
    const seen = new Set<string>();
    const slots = dto.slots.map(normalize).map((x) => {
      const own = x.id && ctx.group.slots.some((p) => p.id === x.id) && !seen.has(x.id);
      if (x.id) seen.add(x.id);
      return own ? x : { ...x, id: undefined };
    });
    await this.validate(ctx, ctx.group, slots);
    await this.saveGroup(user, ctx, ctx.group, slots);
    return this.load(ctx.season.id, id);
  }

  /** Revenir à l'horaire publié pour un groupe, dans ce brouillon. */
  @Delete('drafts/:id/groups/:groupId')
  @Perm('groups.manage')
  async revertGroup(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query() q: VersionQuery,
  ) {
    const ctx = await this.context(id, groupId);
    this.assertDraftVersion(ctx.draftVersion, q.version === undefined ? undefined : Number(q.version));
    if (ctx.draft[groupId]) {
      const next = { ...ctx.draft };
      delete next[groupId];
      await this.write(user, id, next);
    }
    return this.load(ctx.season.id, id);
  }

  /**
   * Placement automatique : séances qui manquent au volume du groupe, sur les jours où il ne s'entraîne pas encore, avec
   * son entraîneur principal (ou l'encadrant de la séance physique) et son terrain de préférence, terrain éclairé la nuit.
   */
  @Post('drafts/:id/auto/:groupId')
  @HttpCode(200)
  @Perm('groups.manage')
  async auto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: AutoDto,
  ) {
    const ctx = await this.context(id, groupId);
    this.assertDraftVersion(ctx.draftVersion, dto.version);
    const g = ctx.group;
    const kind = dto.kind ?? SlotKind.TENNIS;
    const tennis = kind === SlotKind.TENNIS;
    const weekly = tennis ? g.weeklyMinutes : g.physicalMinutes;
    if (!weekly) throw new BadRequestException(tennis ? 'Réglez d’abord les heures par semaine du groupe.' : 'Ce groupe n’a pas de séance physique prévue.');
    const dur = (tennis ? g.sessionMinutes : g.physicalSessionMinutes) ?? 60;
    const mine = ctx.effective(groupId);
    const used = mine.filter((s) => s.kind === kind).reduce((t, s) => t + durationOf(s), 0);
    let missing = Math.floor((weekly - used) / dur);
    if (missing <= 0) throw new ConflictException(`« ${g.name} » : le volume de ${tennis ? 'tennis' : 'physique'} est déjà placé.`);

    const s = await this.settings.all();
    const courts = tennis
      ? [...ctx.courts.filter((c) => c.id === g.preferredCourtId), ...ctx.courts.filter((c) => c.id !== g.preferredCourtId)].filter((c) => c.active && !c.maintenance)
      : [null];
    const coachId = tennis ? g.mainCoachId : (g.physicalCoachId ?? g.mainCoachId);
    const coachIds = coachId ? [coachId] : [];
    const others = ctx.othersThan(groupId);
    const placed: RawSlot[] = [...mine];
    let added = 0;
    while (missing > 0) {
      const count = (d: number) => placed.filter((x) => x.day === d).length;
      const days = [...DAYS_ORDER].sort((a, b) => count(a) - count(b) || DAYS_ORDER.indexOf(a) - DAYS_ORDER.indexOf(b));
      let found: RawSlot | null = null;
      for (const day of days) {
        // En semaine, après l'école (16 h) ; le week-end dès l'ouverture.
        const from = Math.max(s.openingHour * 60, day >= 1 && day <= 5 ? 16 * 60 : 0);
        for (let start = from; start + dur <= s.closingHour * 60 && !found; start += 30) {
          for (const court of courts) {
            if (court && start + dur > s.nightStartHour * 60 && !court.lit) continue;
            const cand: RawSlot = { day, startTime: toTime(start), endTime: toTime(start + dur), courtId: court?.id ?? null, coachIds, kind };
            const asPlaced = (x: RawSlot): Placed => ({ ...x, groupId, groupName: g.name });
            if (!findConflict([asPlaced(cand)], [...others, ...placed.map(asPlaced)])) {
              found = cand;
              break;
            }
          }
        }
        if (found) break;
      }
      if (!found) break;
      placed.push(found);
      added++;
      missing--;
    }
    if (!added) throw rule.conflict('R5', `Aucune place libre pour « ${g.name} » (terrain, entraîneur ou éclairage).`);
    await this.validate(ctx, g, placed);
    await this.saveGroup(user, ctx, g, placed);
    return { ...(await this.load(ctx.season.id, id)), placed: added };
  }

  /**
   * Publication d'un brouillon : il devient l'emploi du temps habituel (contrôles refaits sur l'emploi publié d'aujourd'hui),
   * puis il est supprimé. Les autres brouillons restent pour plus tard.
   */
  @Post('drafts/:id/publish')
  @HttpCode(200)
  @Perm('groups.manage')
  async publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishDto) {
    const d = await this.findDraft(id);
    const ctx = await this.seasonContext(d.seasonId, id);
    assertSeasonOpen(ctx.season);
    this.assertDraftVersion(ctx.draftVersion, dto.version);
    const changed = ctx.groups.filter((g) => ctx.draft[g.id]);
    if (!changed.length) throw new BadRequestException('Aucun changement à publier.');
    for (const g of changed) await this.validate(ctx, g, ctx.draft[g.id]);

    const removedIds = changed.flatMap((g) => g.slots.filter((s) => !ctx.draft[g.id].some((x) => x.id === s.id)).map((s) => s.id));
    if (removedIds.length && (await this.prisma.attendance.count({ where: { slotId: { in: removedIds } } }))) {
      throw rule.conflict('R8', 'Une séance retirée a déjà des présences pointées : déplacez-la plutôt que de la retirer.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.groupSlot.deleteMany({ where: { id: { in: removedIds } } });
      for (const g of changed) {
        for (const s of ctx.draft[g.id]) {
          const data = { day: s.day, startTime: s.startTime, endTime: s.endTime, courtId: s.courtId, kind: s.kind };
          const coaches = { create: s.coachIds.map((coachId) => ({ coachId })) };
          if (s.id && g.slots.some((x) => x.id === s.id)) {
            await tx.slotCoach.deleteMany({ where: { slotId: s.id } });
            await tx.groupSlot.update({ where: { id: s.id }, data: { ...data, coaches } });
          } else {
            await tx.groupSlot.create({ data: { ...data, groupId: g.id, coaches } });
          }
        }
        await tx.trainingGroup.update({ where: { id: g.id }, data: { version: { increment: 1 } } });
      }
      await tx.timetableDraft.delete({ where: { id } });
    });
    let notified = 0;
    for (const g of changed) {
      const after = describe(ctx.draft[g.id].map((s) => ({ ...s, court: s.courtId ? (ctx.courts.find((c) => c.id === s.courtId) ?? null) : null })));
      await this.audit.log(user.id, {
        action: `Emploi du temps publié (${d.name})`,
        entity: 'TrainingGroup',
        entityId: g.id,
        target: g.name,
        before: describe(g.slots),
        after,
      });
      if (dto.notify !== false) notified += await this.notify(g, ctx.draft[g.id], after);
    }
    return { ok: true, groups: changed.length, notified };
  }

  // ————————————————————————————————————————————————————————————————————————————————

  private assertDraftVersion(current: number, sent: number | undefined) {
    if (sent !== undefined && sent !== current) {
      throw rule.conflict('R13', 'L’emploi du temps a été modifié entre-temps (autre administrateur) : rechargez puis recommencez.');
    }
  }

  private async findDraft(id: string) {
    const d = await this.prisma.timetableDraft.findUnique({ where: { id } });
    if (!d) throw notFound('Brouillon');
    return d;
  }

  private async context(draftId: string, groupId: string) {
    const d = await this.findDraft(draftId);
    const ctx = await this.seasonContext(d.seasonId, draftId);
    const g = ctx.groups.find((x) => x.id === groupId);
    if (!g) throw notFound('Groupe');
    return { ...ctx, group: g };
  }

  /** Saison, groupes (créneaux publiés), brouillon choisi, terrains et entraîneurs ; créneaux effectifs = brouillon sinon publiés. */
  private async seasonContext(seasonId: string, draftId?: string) {
    const [season, groups, row, courts, coaches] = await Promise.all([
      this.prisma.season.findUniqueOrThrow({ where: { id: seasonId } }),
      this.prisma.trainingGroup.findMany({ where: { seasonId, archivedAt: null }, include: groupInclude, orderBy: { name: 'asc' } }),
      draftId ? this.prisma.timetableDraft.findFirst({ where: { id: draftId, seasonId } }) : Promise.resolve(null),
      this.prisma.court.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, lit: true, active: true, maintenance: true } }),
      this.prisma.coach.findMany({ where: { user: { isActive: true } }, select: { id: true, color: true, user: { select: { firstName: true, lastName: true } } } }),
    ]);
    if (draftId && !row) throw notFound('Brouillon');
    const ids = new Set(groups.map((g) => g.id));
    const draft = Object.fromEntries(Object.entries((row?.groups ?? {}) as DraftMap).filter(([id]) => ids.has(id))) as DraftMap;
    const published = (g: GroupRow): RawSlot[] =>
      g.slots.map((s) => ({ id: s.id, day: s.day, startTime: s.startTime, endTime: s.endTime, courtId: s.courtId, coachIds: s.coaches.map((c) => c.coachId), kind: s.kind }));
    const effective = (groupId: string): RawSlot[] => draft[groupId] ?? published(groups.find((g) => g.id === groupId)!);
    const othersThan = (groupId: string): Placed[] =>
      groups.filter((g) => g.id !== groupId).flatMap((g) => effective(g.id).map((s) => ({ ...s, groupId: g.id, groupName: g.name })));
    return { season, groups, row, draft, draftVersion: row?.version ?? 0, courts, coaches, published, effective, othersThan };
  }

  /** Volume, terrains (existants, éclairés la nuit), entraîneurs actifs, conflits avec le reste de la grille (R5). */
  private async validate(ctx: Awaited<ReturnType<TimetableController['seasonContext']>>, g: GroupRow, slots: RawSlot[]) {
    assertSeasonOpen(ctx.season);
    assertVolumes(g, slots);
    const s = await this.settings.all();
    for (const x of slots) {
      if (minutesOf(x.startTime) < s.openingHour * 60 || minutesOf(x.endTime) > s.closingHour * 60) {
        throw new BadRequestException(`« ${g.name} » : séance hors des heures d’ouverture (${s.openingHour} h – ${s.closingHour} h).`);
      }
      if (x.courtId) {
        const court = ctx.courts.find((c) => c.id === x.courtId);
        if (!court || !court.active) throw new BadRequestException('Terrain introuvable ou désactivé.');
        if (!court.lit && minutesOf(x.endTime) > s.nightStartHour * 60) {
          throw rule.conflict('R5', `${court.name} n’est pas éclairé : pas de séance après ${s.nightStartHour} h.`);
        }
      } else if (x.kind === SlotKind.TENNIS) {
        throw new BadRequestException(`« ${g.name} » : choisissez le terrain de la séance de tennis.`);
      }
      const unknown = x.coachIds.find((id) => !ctx.coaches.some((c) => c.id === id));
      if (unknown) throw new BadRequestException('Entraîneur introuvable ou désactivé.');
    }
    const conflict = findConflict(
      slots.map((x) => ({ ...x, groupId: g.id, groupName: g.name })),
      ctx.othersThan(g.id),
    );
    if (conflict) throw rule.conflict('R5', conflict);
  }

  private async saveGroup(user: AuthUser, ctx: Awaited<ReturnType<TimetableController['seasonContext']>>, g: GroupRow, slots: RawSlot[]) {
    const next = { ...ctx.draft };
    if (sameSlots(slots, ctx.published(g))) delete next[g.id];
    else next[g.id] = slots;
    await this.write(user, ctx.row!.id, next);
  }

  private async write(user: AuthUser, id: string, groups: DraftMap) {
    await this.prisma.timetableDraft.update({ where: { id }, data: { groups: groups as Prisma.InputJsonValue, updatedById: user.id, version: { increment: 1 } } });
  }

  /** Familles des joueurs du groupe et entraîneurs (anciens et nouveaux) prévenus du nouvel horaire. */
  private async notify(g: GroupRow, slots: RawSlot[], after: string): Promise<number> {
    const members = await this.prisma.groupMember.findMany({
      where: { groupId: g.id, enrollment: { player: { archivedAt: null } } },
      select: { enrollment: { select: { player: { select: { userId: true, parentLinks: { where: { parent: { isActive: true } }, select: { parentId: true } } } } } } },
    });
    const families = new Set<string>();
    for (const m of members) {
      const p = m.enrollment.player;
      if (p.userId) families.add(p.userId);
      for (const l of p.parentLinks) families.add(l.parentId);
    }
    const coachIds = [...new Set([...g.slots.flatMap((s) => s.coaches.map((c) => c.coachId)), ...slots.flatMap((s) => s.coachIds)])];
    const coachUsers = coachIds.length
      ? (await this.prisma.coach.findMany({ where: { id: { in: coachIds }, user: { isActive: true } }, select: { userId: true } })).map((c) => c.userId)
      : [];
    for (const id of coachUsers) families.delete(id);
    const title = `Nouvel horaire : ${g.name}`;
    const body = `${after}. Détail dans « Mes séances ».`;
    const rows = [
      ...[...families].map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link: '/seances' })),
      ...coachUsers.map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link: '/coach/seances' })),
    ];
    if (rows.length) await this.prisma.notification.createMany({ data: rows });
    return rows.length;
  }

  private async load(seasonId: string, draftId?: string) {
    const ctx = await this.seasonContext(seasonId, draftId);
    const s = await this.settings.all();
    const [schedules, drafts] = await Promise.all([
      this.prisma.tempSchedule.findMany({
        where: { seasonId, archivedAt: null },
        orderBy: { startDate: 'asc' },
        select: { id: true, name: true, startDate: true, endDate: true, status: true },
      }),
      this.prisma.timetableDraft.findMany({ where: { seasonId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, groups: true, updatedAt: true } }),
    ]);
    const today = todayIso();
    const courtName = (id: string | null) => (id ? (ctx.courts.find((c) => c.id === id) ?? null) : null);
    return {
      season: { id: ctx.season.id, label: ctx.season.label, status: ctx.season.status },
      hours: { opening: s.openingHour, closing: s.closingHour, nightStart: s.nightStartHour },
      courts: ctx.courts.filter((c) => c.active),
      coaches: ctx.coaches.map((c) => ({ id: c.id, color: c.color, firstName: c.user.firstName, lastName: c.user.lastName })),
      groups: ctx.groups.map((g) => ({
        id: g.id,
        name: g.name,
        kind: g.kind,
        category: g.category?.name ?? null,
        members: g._count.members,
        capacity: g.capacity,
        weeklyMinutes: g.weeklyMinutes,
        sessionMinutes: g.sessionMinutes,
        physicalMinutes: g.physicalMinutes,
        physicalSessionMinutes: g.physicalSessionMinutes,
        mainCoachId: g.mainCoachId,
        physicalCoachId: g.physicalCoachId,
        preferredCourtId: g.preferredCourtId,
        published: ctx.published(g),
        draft: ctx.draft[g.id] ?? null,
      })),
      drafts: drafts.map((x) => ({ id: x.id, name: x.name, groups: Object.keys((x.groups ?? {}) as DraftMap).length, updatedAt: x.updatedAt })),
      draft: ctx.row && {
        id: ctx.row.id,
        name: ctx.row.name,
        version: ctx.row.version,
        updatedAt: ctx.row.updatedAt,
        changes: ctx.groups
          .filter((g) => ctx.draft[g.id])
          .map((g) => ({
            groupId: g.id,
            groupName: g.name,
            before: describe(g.slots),
            after: describe(ctx.draft[g.id].map((x) => ({ ...x, court: courtName(x.courtId) }))),
          })),
      },
      schedules: schedules
        .filter((x) => isoDay(x.endDate) >= today)
        .map((x) => ({ id: x.id, name: x.name, startDate: isoDay(x.startDate), endDate: isoDay(x.endDate), published: x.status === TempScheduleStatus.PUBLISHED })),
    };
  }
}

function normalize(s: SlotDto): RawSlot {
  return {
    id: s.id,
    day: s.day,
    startTime: s.startTime,
    endTime: s.endTime,
    courtId: s.courtId ?? null,
    coachIds: [...new Set(s.coachIds)],
    kind: s.kind ?? SlotKind.TENNIS,
  };
}

