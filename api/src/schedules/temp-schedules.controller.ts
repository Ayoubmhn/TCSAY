import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailKind, Prisma, SlotKind, TempScheduleMode, TempScheduleStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { addDaysIso, dayFromIso, isoDay, minutesOf, todayIso, weekday } from '../common/dates';
import { assertSeasonOpen, assertVersion, fullName, notFound, rule } from '../common/rules';
import { DAY_LONG, DAY_NAMES, groupPeriod, slotsOverlap } from '../common/sessions';
import { SlotDto, slotInclude, slotView } from '../groups/groups.controller';
import { physicalCourtConflict } from './timetable-rules';
import { PrismaService } from '../prisma/prisma.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Durée maximale d'un emploi temporaire (vacances d'été comprises). */
const MAX_DAYS = 100;

class ListQuery {
  @IsOptional()
  @IsUUID()
  seasonId?: string;
}

class ScheduleFields {
  @IsString()
  @IsNotEmpty({ message: 'Nom obligatoire (ex. « Vacances d’hiver »).' })
  @MaxLength(80)
  name: string;

  @Matches(DAY, { message: 'Date de début au format AAAA-MM-JJ.' })
  startDate: string;

  @Matches(DAY, { message: 'Date de fin au format AAAA-MM-JJ.' })
  endDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Séances habituelles retirées pendant ces dates dues par le club (compteur : « à rattraper ») ; non par défaut. */
  @IsOptional()
  @IsBoolean()
  sessionsOwed?: boolean;
}

/** Point de départ d'un nouvel emploi temporaire. */
const FROM = ['EMPTY', 'PUBLISHED', 'DRAFT', 'TEMP'] as const;
type From = (typeof FROM)[number];

class CreateDto extends ScheduleFields {
  @IsOptional()
  @IsUUID()
  seasonId?: string;

  /** EMPTY (défaut), PUBLISHED (horaire habituel), DRAFT (brouillon `fromId`), TEMP (autres vacances `fromId`). */
  @IsOptional()
  @IsIn(FROM, { message: 'Point de départ inconnu.' })
  from?: From;

  @IsOptional()
  @IsUUID()
  fromId?: string;
}

class UpdateDto extends ScheduleFields {
  @IsInt()
  @Min(1)
  version: number;
}

class GroupDto {
  /** REPLACE : l'horaire habituel est remplacé (aucun créneau = pas de séance) ; ADD : séances en plus (stage). */
  @IsEnum(TempScheduleMode, { message: 'Choisissez : horaire remplacé ou séances en plus.' })
  mode: TempScheduleMode;

  @IsArray()
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => SlotDto)
  slots: SlotDto[];

  @IsInt()
  @Min(1)
  version: number;
}

class VersionDto {
  @IsInt()
  @Min(1)
  version: number;
}

class VersionQuery {
  @IsOptional()
  @Matches(/^\d+$/)
  version?: string;
}

class PublishDto extends VersionDto {
  /** Prévenir les familles et les entraîneurs des groupes concernés (notification). */
  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

class ReasonDto extends VersionDto {
  @IsString()
  @IsNotEmpty({ message: 'Motif obligatoire.' })
  @MaxLength(300)
  reason: string;
}

const scheduleInclude = {
  season: true,
  groups: { include: { group: { select: { id: true, name: true, kind: true, archivedAt: true } } } },
  slots: { include: slotInclude, orderBy: [{ day: 'asc' as const }, { startTime: 'asc' as const }] },
} satisfies Prisma.TempScheduleInclude;

type ScheduleRow = Prisma.TempScheduleGetPayload<{ include: typeof scheduleInclude }>;

const frDate = (iso: string) => iso.split('-').reverse().join('/');
const MODE_LABEL: Record<TempScheduleMode, string> = { REPLACE: 'horaire remplacé', ADD: 'séances en plus' };

/** Jours de la semaine présents entre deux dates (inclus). */
function weekdaysIn(from: string, to: string): Set<number> {
  const out = new Set<number>();
  for (let d = from, i = 0; d <= to && i < 7; d = addDaysIso(d, 1), i++) out.add(weekday(d));
  return out;
}

/** Deux périodes se croisent-elles ? */
const crosses = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from <= b.to && b.from <= a.to;

/**
 * Emplois du temps temporaires (vacances, stage) : pendant leurs dates, les groupes choisis suivent un autre horaire
 * (remplacé, ou des séances en plus). Brouillon sans effet ; une fois publié, planning, séances, présences, salaires et
 * grille de réservation suivent l'emploi temporaire, puis l'horaire habituel revient seul. R1, R5, R8, R13, audit.
 */
@ApiTags('Emplois temporaires')
@ApiBearerAuth()
@Controller('temp-schedules')
export class TempSchedulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Perm('groups.manage', 'planning.view')
  async list(@Query() q: ListQuery) {
    const season = await this.access.seasonOrActive(q.seasonId);
    const rows = await this.prisma.tempSchedule.findMany({
      where: { seasonId: season.id, archivedAt: null, kind: 'HOLIDAY' },
      include: { groups: { select: { mode: true, group: { select: { name: true } } } }, _count: { select: { slots: true } } },
      orderBy: { startDate: 'asc' },
    });
    const today = todayIso();
    return {
      season: { id: season.id, label: season.label, status: season.status, startDate: isoDay(season.startDate), endDate: isoDay(season.endDate) },
      schedules: rows.map((s) => ({
        id: s.id,
        name: s.name,
        startDate: isoDay(s.startDate),
        endDate: isoDay(s.endDate),
        note: s.note,
        sessionsOwed: s.sessionsOwed,
        status: s.status,
        phase: phase(isoDay(s.startDate), isoDay(s.endDate), today),
        version: s.version,
        groups: s.groups.map((g) => ({ name: g.group.name, mode: g.mode })),
        slotsCount: s._count.slots,
      })),
    };
  }

  @Get(':id')
  @Perm('groups.manage', 'planning.view')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const s = await this.find(id);
    const groups = await this.prisma.trainingGroup.findMany({
      where: { seasonId: s.seasonId, archivedAt: null },
      include: {
        category: { select: { name: true } },
        slots: { where: { scheduleId: null }, include: slotInclude, orderBy: [{ day: 'asc' }, { startTime: 'asc' }] },
        _count: { select: { members: true } },
      },
      orderBy: { name: 'asc' },
    });
    return this.view(s, groups);
  }

  @Post()
  @Perm('groups.manage')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateDto) {
    const season = await this.access.seasonOrActive(dto.seasonId);
    assertSeasonOpen(season);
    checkDates(dto, season);
    const from = dto.from ?? 'EMPTY';
    const copy = await this.startingPoint(season.id, from, dto.fromId, weekdaysIn(dto.startDate, dto.endDate));
    const s = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tempSchedule.create({
        data: {
          seasonId: season.id,
          name: dto.name.trim(),
          startDate: dayFromIso(dto.startDate),
          endDate: dayFromIso(dto.endDate),
          note: dto.note?.trim() || null,
          sessionsOwed: dto.sessionsOwed ?? false,
          createdById: user.id,
        },
      });
      for (const g of copy.groups) {
        await tx.tempScheduleGroup.create({ data: { scheduleId: created.id, groupId: g.groupId, mode: g.mode } });
        for (const sl of g.slots) {
          await tx.groupSlot.create({
            data: {
              groupId: g.groupId,
              scheduleId: created.id,
              day: sl.day,
              startTime: sl.startTime,
              endTime: sl.endTime,
              courtId: sl.courtId,
              kind: sl.kind,
              coaches: { create: [...new Set(sl.coachIds)].map((coachId) => ({ coachId })) },
            },
          });
        }
      }
      return created;
    });
    await this.audit.log(user.id, {
      action: 'Emploi temporaire créé',
      entity: 'TempSchedule',
      entityId: s.id,
      target: s.name,
      after: `${frDate(dto.startDate)} → ${frDate(dto.endDate)} · brouillon · ${copy.label}${dto.sessionsOwed ? ' · séances dues' : ''}`,
    });
    return { id: s.id, groups: copy.groups.length };
  }

  /** Nom, dates, remarque. Publié et commencé : la date de début ne change plus et la fin ne recule pas avant aujourd'hui (R10). */
  @Patch(':id')
  @Perm('groups.manage')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDto) {
    const s = await this.find(id);
    assertSeasonOpen(s.season);
    assertVersion(s, dto.version, 'Cet emploi temporaire');
    checkDates(dto, s.season);
    const today = todayIso();
    const was = { from: isoDay(s.startDate), to: isoDay(s.endDate) };
    if (s.status === TempScheduleStatus.PUBLISHED && was.from <= today) {
      if (dto.startDate !== was.from) throw rule.bad('R10', 'Emploi déjà commencé : la date de début ne peut plus changer.');
      if (dto.endDate < today) throw rule.bad('R10', 'La date de fin ne peut pas être avant aujourd’hui (séances déjà passées).');
    }
    const next = { from: dto.startDate, to: dto.endDate };
    for (const sl of s.slots) {
      if (!weekdaysIn(next.from, next.to).has(sl.day)) {
        throw new BadRequestException(`Le ${DAY_LONG[sl.day]} n’est plus dans les dates : retirez d’abord ce créneau.`);
      }
    }
    if (s.status === TempScheduleStatus.PUBLISHED) await this.assertPublishable(s, next);
    await this.prisma.tempSchedule.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        startDate: dayFromIso(dto.startDate),
        endDate: dayFromIso(dto.endDate),
        note: dto.note?.trim() || null,
        ...(dto.sessionsOwed !== undefined ? { sessionsOwed: dto.sessionsOwed } : {}),
        version: { increment: 1 },
      },
    });
    await this.audit.log(user.id, {
      action: 'Emploi temporaire modifié',
      entity: 'TempSchedule',
      entityId: id,
      target: dto.name.trim(),
      before: `${s.name} · ${frDate(was.from)} → ${frDate(was.to)}`,
      after: `${dto.name.trim()} · ${frDate(dto.startDate)} → ${frDate(dto.endDate)}${(dto.sessionsOwed ?? s.sessionsOwed) ? ' · séances dues' : ''}`,
    });
    // Emploi publié : nouvelles dates annoncées aux familles et aux entraîneurs des groupes concernés.
    if (s.status === TempScheduleStatus.PUBLISHED && (was.from !== dto.startDate || was.to !== dto.endDate)) {
      await this.notify(s, `Vacances modifiées : ${dto.name.trim()}`, `Nouvelles dates : du ${frDate(dto.startDate)} au ${frDate(dto.endDate)}. Détail dans « Mes séances ».`, { latest: true });
    }
    return { ok: true };
  }

  /**
   * Place d'un groupe dans l'emploi temporaire et ses créneaux (remplacés ou en plus). Créneau retiré : refusé s'il a
   * déjà des présences (R8). Conflits de terrain et d'entraîneur pendant les dates vérifiés (R5).
   */
  @Put(':id/groups/:groupId')
  @Perm('groups.manage')
  async setGroup(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: GroupDto,
  ) {
    const s = await this.find(id);
    assertSeasonOpen(s.season);
    assertVersion(s, dto.version, 'Cet emploi temporaire');
    const group = await this.prisma.trainingGroup.findUnique({ where: { id: groupId } });
    if (!group || group.archivedAt || group.seasonId !== s.seasonId) throw notFound('Groupe');
    if (dto.mode === TempScheduleMode.ADD && !dto.slots.length) {
      throw new BadRequestException('Séances en plus : ajoutez au moins un créneau.');
    }
    const range = { from: isoDay(s.startDate), to: isoDay(s.endDate) };
    await this.assertNoConflict(s, range, groupId, dto.mode, dto.slots);

    const current = s.slots.filter((x) => x.groupId === groupId);
    const keep = new Set(dto.slots.filter((x) => x.id).map((x) => x.id));
    const removed = current.filter((x) => !keep.has(x.id));
    await this.assertUnused(removed.map((x) => x.id));
    const before = s.groups.find((g) => g.groupId === groupId);

    await this.prisma.$transaction(async (tx) => {
      await tx.tempScheduleGroup.upsert({
        where: { scheduleId_groupId: { scheduleId: id, groupId } },
        create: { scheduleId: id, groupId, mode: dto.mode },
        update: { mode: dto.mode },
      });
      await tx.groupSlot.deleteMany({ where: { id: { in: removed.map((x) => x.id) } } });
      for (const sl of dto.slots) {
        const data = { day: sl.day, startTime: sl.startTime, endTime: sl.endTime, courtId: sl.courtId ?? null, kind: sl.kind ?? SlotKind.TENNIS };
        const coaches = [...new Set(sl.coachIds)].map((coachId) => ({ coachId }));
        if (sl.id && current.some((x) => x.id === sl.id)) {
          await tx.slotCoach.deleteMany({ where: { slotId: sl.id } });
          await tx.groupSlot.update({ where: { id: sl.id }, data: { ...data, coaches: { create: coaches } } });
        } else {
          await tx.groupSlot.create({ data: { ...data, groupId, scheduleId: id, coaches: { create: coaches } } });
        }
      }
      await tx.tempSchedule.update({ where: { id }, data: { version: { increment: 1 } } });
    });
    await this.audit.log(user.id, {
      action: before ? 'Emploi temporaire : groupe modifié' : 'Emploi temporaire : groupe ajouté',
      entity: 'TempSchedule',
      entityId: id,
      target: `${s.name} · ${group.name}`,
      before: before ? `${MODE_LABEL[before.mode]} · ${describe(current)}` : undefined,
      after: `${MODE_LABEL[dto.mode]} · ${describeDto(dto.slots)}`,
    });
    // Emploi publié : le planning du groupe change tout de suite, ses familles et ses entraîneurs sont prévenus.
    if (s.status === TempScheduleStatus.PUBLISHED) {
      const what = dto.slots.length
        ? `${dto.mode === TempScheduleMode.ADD ? 'séances en plus' : 'nouvel horaire'} : ${describeDto(dto.slots)}`
        : 'pas de séance';
      await this.notify(s, `Vacances modifiées : ${s.name}`, `${group.name}, du ${frDate(range.from)} au ${frDate(range.to)} : ${what}. Détail dans « Mes séances ».`, {
        groupIds: [groupId],
        latest: true,
      });
    }
    return { ok: true };
  }

  /** Retire un groupe de l'emploi temporaire (ses créneaux temporaires avec) : il reprend son horaire habituel. */
  @Delete(':id/groups/:groupId')
  @Perm('groups.manage')
  async removeGroup(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query() q: VersionQuery,
  ) {
    const s = await this.find(id);
    assertSeasonOpen(s.season);
    assertVersion(s, q.version ? Number(q.version) : undefined, 'Cet emploi temporaire');
    const entry = s.groups.find((g) => g.groupId === groupId);
    if (!entry) throw notFound('Groupe de cet emploi temporaire');
    const slots = s.slots.filter((x) => x.groupId === groupId);
    await this.assertUnused(slots.map((x) => x.id));
    if (s.status === TempScheduleStatus.PUBLISHED && isoDay(s.startDate) <= todayIso() && entry.mode === TempScheduleMode.REPLACE) {
      // Les séances habituelles passées n'avaient pas lieu : l'historique changerait.
      throw rule.conflict('R10', 'Emploi déjà commencé : ce groupe ne peut plus en être retiré (raccourcissez plutôt la date de fin).');
    }
    await this.prisma.$transaction([
      this.prisma.groupSlot.deleteMany({ where: { id: { in: slots.map((x) => x.id) } } }),
      this.prisma.tempScheduleGroup.delete({ where: { scheduleId_groupId: { scheduleId: id, groupId } } }),
      this.prisma.tempSchedule.update({ where: { id }, data: { version: { increment: 1 } } }),
    ]);
    await this.audit.log(user.id, {
      action: 'Emploi temporaire : groupe retiré',
      entity: 'TempSchedule',
      entityId: id,
      target: `${s.name} · ${entry.group.name}`,
      before: `${MODE_LABEL[entry.mode]} · ${describe(slots)}`,
    });
    if (s.status === TempScheduleStatus.PUBLISHED) {
      await this.notify(
        s,
        `Vacances modifiées : ${s.name}`,
        `${entry.group.name}, du ${frDate(isoDay(s.startDate))} au ${frDate(isoDay(s.endDate))} : retour à l’horaire habituel. Détail dans « Mes séances ».`,
        { groupIds: [groupId], latest: true },
      );
    }
    return { ok: true };
  }

  /** Publication : l'emploi s'applique (planning, séances, présences, réservations) ; familles et entraîneurs prévenus au choix. */
  @Post(':id/publish')
  @HttpCode(200)
  @Perm('groups.manage')
  async publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishDto) {
    const s = await this.find(id);
    assertSeasonOpen(s.season);
    assertVersion(s, dto.version, 'Cet emploi temporaire');
    if (s.status === TempScheduleStatus.PUBLISHED) throw new BadRequestException('Cet emploi temporaire est déjà publié.');
    if (!s.groups.length) throw new BadRequestException('Ajoutez au moins un groupe avant de publier.');
    const range = { from: isoDay(s.startDate), to: isoDay(s.endDate) };
    if (range.to < todayIso()) throw new BadRequestException('Les dates sont passées : modifiez-les avant de publier.');
    await this.assertPublishable(s, range);
    await this.prisma.tempSchedule.update({
      where: { id },
      data: { status: TempScheduleStatus.PUBLISHED, publishedAt: new Date(), version: { increment: 1 } },
    });
    const notified = dto.notify === false ? 0 : await this.notify(s, `Emploi du temps : ${s.name}`, summary(s, range));
    await this.audit.log(user.id, {
      action: 'Emploi temporaire publié',
      entity: 'TempSchedule',
      entityId: id,
      target: s.name,
      before: 'Brouillon',
      after: `Publié · ${frDate(range.from)} → ${frDate(range.to)} · ${s.groups.map((g) => g.group.name).join(', ')}`,
    });
    return { ok: true, notified };
  }

  /** Retour en brouillon (avant le début seulement) : l'horaire habituel s'applique de nouveau ; motif, familles prévenues. */
  @Post(':id/unpublish')
  @HttpCode(200)
  @Perm('groups.manage')
  async unpublish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    const s = await this.find(id);
    assertSeasonOpen(s.season);
    assertVersion(s, dto.version, 'Cet emploi temporaire');
    if (s.status !== TempScheduleStatus.PUBLISHED) throw new BadRequestException('Cet emploi temporaire n’est pas publié.');
    this.assertNotStarted(s);
    await this.prisma.tempSchedule.update({ where: { id }, data: { status: TempScheduleStatus.DRAFT, publishedAt: null, version: { increment: 1 } } });
    const range = { from: isoDay(s.startDate), to: isoDay(s.endDate) };
    const notified = await this.notify(s, `Emploi du temps annulé : ${s.name}`, `Du ${frDate(range.from)} au ${frDate(range.to)}, l’horaire habituel est maintenu. Motif : ${dto.reason.trim()}.`);
    await this.audit.log(user.id, { action: 'Emploi temporaire retiré', entity: 'TempSchedule', entityId: id, target: s.name, before: 'Publié', after: 'Brouillon', reason: dto.reason });
    return { ok: true, notified };
  }

  /** R8 : archivage (brouillon, ou publié pas encore commencé). Un emploi commencé reste : il fait partie de l'historique. */
  @Post(':id/archive')
  @HttpCode(200)
  @Perm('groups.manage')
  async archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    const s = await this.find(id);
    assertSeasonOpen(s.season);
    assertVersion(s, dto.version, 'Cet emploi temporaire');
    if (s.status === TempScheduleStatus.PUBLISHED) this.assertNotStarted(s);
    await this.assertUnused(s.slots.map((x) => x.id));
    await this.prisma.tempSchedule.update({ where: { id }, data: { archivedAt: new Date(), status: TempScheduleStatus.DRAFT, version: { increment: 1 } } });
    const range = { from: isoDay(s.startDate), to: isoDay(s.endDate) };
    const notified =
      s.status === TempScheduleStatus.PUBLISHED
        ? await this.notify(s, `Emploi du temps annulé : ${s.name}`, `Du ${frDate(range.from)} au ${frDate(range.to)}, l’horaire habituel est maintenu.`)
        : 0;
    await this.audit.log(user.id, { action: 'Emploi temporaire archivé', entity: 'TempSchedule', entityId: id, target: s.name, reason: dto.reason });
    return { ok: true, notified };
  }

  // ————————————————————————————————————————————————————————————————————————————————

  private async find(id: string): Promise<ScheduleRow> {
    const s = await this.prisma.tempSchedule.findUnique({ where: { id }, include: scheduleInclude });
    if (!s || s.archivedAt) throw notFound('Emploi temporaire');
    return s;
  }

  private assertNotStarted(s: ScheduleRow) {
    if (isoDay(s.startDate) <= todayIso()) {
      throw rule.conflict('R10', 'Emploi déjà commencé : il ne peut plus être retiré (raccourcissez plutôt la date de fin).');
    }
  }

  /** R8 : un créneau temporaire déjà pointé (présences) ne se supprime pas. */
  private async assertUnused(slotIds: string[]) {
    if (!slotIds.length) return;
    const used = await this.prisma.attendance.count({ where: { slotId: { in: slotIds } } });
    if (used) throw rule.conflict('R8', 'Un créneau retiré a déjà des présences pointées : modifiez-le plutôt que de le retirer.');
  }

  /** Avant publication (ou changement de dates d'un emploi publié) : un seul emploi publié par groupe à la fois, et R5 pour chaque groupe. */
  private async assertPublishable(s: ScheduleRow, range: { from: string; to: string }) {
    const others = await this.prisma.tempSchedule.findMany({
      // Séances ponctuelles (un seul jour, séances en plus) : jamais un « emploi » qui empêcherait les vacances.
      where: { id: { not: s.id }, seasonId: s.seasonId, kind: 'HOLIDAY', status: TempScheduleStatus.PUBLISHED, archivedAt: null, groups: { some: { groupId: { in: s.groups.map((g) => g.groupId) } } } },
      include: { groups: { include: { group: { select: { name: true } } } } },
    });
    for (const o of others) {
      if (!crosses(range, { from: isoDay(o.startDate), to: isoDay(o.endDate) })) continue;
      const g = o.groups.find((x) => s.groups.some((y) => y.groupId === x.groupId));
      throw rule.conflict('R5', `« ${g?.group.name} » suit déjà l’emploi « ${o.name} » du ${frDate(isoDay(o.startDate))} au ${frDate(isoDay(o.endDate))}.`);
    }
    for (const g of s.groups) {
      const slots = s.slots.filter((x) => x.groupId === g.groupId).map((x) => ({ ...x, coachIds: x.coaches.map((c) => c.coachId) }));
      await this.assertNoConflict(s, range, g.groupId, g.mode, slots);
    }
  }

  /**
   * R5 pendant les dates de l'emploi : créneaux du groupe entre eux, avec les autres créneaux de cet emploi, avec ceux des
   * autres emplois publiés aux mêmes dates, et avec l'horaire habituel des groupes qui le gardent (absents de l'emploi,
   * ou en « séances en plus », ce groupe compris).
   */
  private async assertNoConflict(
    s: ScheduleRow,
    range: { from: string; to: string },
    groupId: string,
    mode: TempScheduleMode,
    slots: { id?: string; day: number; startTime: string; endTime: string; courtId?: string | null; coachIds: string[]; kind?: SlotKind | null }[],
  ) {
    const days = weekdaysIn(range.from, range.to);
    const physical = physicalCourtConflict(slots, await this.prisma.court.findMany({ where: { physicalOnly: true }, select: { id: true, name: true, physicalOnly: true } }));
    if (physical) throw rule.conflict('R5', physical);
    for (const sl of slots) {
      if (minutesOf(sl.endTime) <= minutesOf(sl.startTime)) throw new BadRequestException(`${DAY_LONG[sl.day]} : l’heure de fin doit suivre l’heure de début.`);
      if (!days.has(sl.day)) throw new BadRequestException(`Aucun ${DAY_LONG[sl.day]} entre le ${frDate(range.from)} et le ${frDate(range.to)}.`);
    }
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i];
        const b = slots[j];
        if (slotsOverlap(a, b)) {
          throw rule.conflict('R5', `Deux créneaux du ${DAY_LONG[a.day]} se chevauchent : le groupe ne peut pas être à deux séances à la fois.`);
        }
      }
    }
    const replaced = new Set(s.groups.filter((g) => g.mode === TempScheduleMode.REPLACE && g.groupId !== groupId).map((g) => g.groupId));
    if (mode === TempScheduleMode.REPLACE) replaced.add(groupId);
    const publishedOthers = await this.prisma.tempSchedule.findMany({
      where: { id: { not: s.id }, seasonId: s.seasonId, status: TempScheduleStatus.PUBLISHED, archivedAt: null, startDate: { lte: dayFromIso(range.to) }, endDate: { gte: dayFromIso(range.from) } },
      select: { id: true },
    });
    const candidates = await this.prisma.groupSlot.findMany({
      where: {
        id: { notIn: slots.flatMap((x) => (x.id ? [x.id] : [])) },
        day: { in: [...new Set(slots.map((x) => x.day))] },
        group: { seasonId: s.seasonId, archivedAt: null },
        OR: [{ scheduleId: s.id, groupId: { not: groupId } }, { scheduleId: { in: publishedOthers.map((o) => o.id) } }, { scheduleId: null }],
      },
      include: { court: { select: { name: true } }, coaches: { include: { coach: { include: { user: { select: { firstName: true, lastName: true } } } } } }, group: { select: { name: true, kind: true, season: { select: { startDate: true, endDate: true, leisureStartDate: true, leisureEndDate: true } } } } },
    });
    for (const o of candidates) {
      if (o.scheduleId === null) {
        if (replaced.has(o.groupId)) continue;
        // Horaire habituel : seulement si le groupe s'entraîne pendant ces dates (loisirs / compétitif).
        if (!crosses(range, groupPeriod(o.group.kind, o.group.season))) continue;
      }
      for (const sl of slots) {
        if (!slotsOverlap(sl, o)) continue;
        const where = o.scheduleId ? 'pendant les vacances' : 'à l’horaire habituel';
        if (sl.courtId && o.courtId === sl.courtId) {
          throw rule.conflict('R5', `Conflit : ${o.court?.name} est déjà occupé le ${DAY_LONG[sl.day]} de ${o.startTime} à ${o.endTime} par « ${o.group.name} » (${where}).`);
        }
        const coach = o.coaches.find((c) => sl.coachIds.includes(c.coachId));
        if (coach) {
          throw rule.conflict('R5', `Conflit : ${fullName(coach.coach.user).trim()} entraîne déjà « ${o.group.name} » le ${DAY_LONG[sl.day]} à ${o.startTime} (${where}).`);
        }
      }
    }
  }

  /**
   * Familles (joueurs avec compte, parents actifs) et entraîneurs des groupes de l'emploi (ou des groupes donnés).
   * `latest` : une modification remplace l'avis non lu de la dernière demi-heure (pas de série de messages en cours de saisie).
   */
  private async notify(s: ScheduleRow, title: string, body: string, opts: { groupIds?: string[]; latest?: boolean } = {}): Promise<number> {
    const groupIds = opts.groupIds ?? s.groups.map((g) => g.groupId);
    if (!groupIds.length) return 0;
    const [members, coaches] = await Promise.all([
      this.prisma.groupMember.findMany({
        where: { groupId: { in: groupIds }, enrollment: { player: { archivedAt: null } } },
        select: { enrollment: { select: { player: { select: { userId: true, parentLinks: { where: { parent: { isActive: true } }, select: { parentId: true } } } } } } },
      }),
      this.prisma.slotCoach.findMany({
        where: { slot: { groupId: { in: groupIds }, OR: [{ scheduleId: null }, { scheduleId: s.id }] }, coach: { user: { isActive: true } } },
        select: { coach: { select: { userId: true } } },
      }),
    ]);
    const families = new Set<string>();
    for (const m of members) {
      const p = m.enrollment.player;
      if (p.userId) families.add(p.userId);
      for (const l of p.parentLinks) families.add(l.parentId);
    }
    const coachIds = new Set(coaches.map((c) => c.coach.userId));
    for (const id of coachIds) families.delete(id);
    const rows = [
      ...[...families].map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link: '/seances' })),
      ...[...coachIds].map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link: '/coach/seances' })),
    ];
    if (opts.latest && rows.length) {
      await this.prisma.notification.deleteMany({
        where: { userId: { in: rows.map((x) => x.userId) }, title, readAt: null, createdAt: { gte: new Date(Date.now() - 30 * 60_000) } },
      });
    }
    if (rows.length) await this.prisma.notification.createMany({ data: rows });
    return rows.length;
  }

  /**
   * Groupes et créneaux recopiés dans un nouvel emploi temporaire : rien, l'horaire habituel publié, un brouillon de la
   * grille (groupes modifiés + horaire publié des autres) ou d'autres vacances. Seuls les jours compris dans les dates
   * sont gardés ; horaire habituel / brouillon : seulement les groupes qui s'entraînent ces jours-là.
   */
  private async startingPoint(seasonId: string, from: From, fromId: string | undefined, days: Set<number>) {
    type Copy = { groupId: string; mode: TempScheduleMode; slots: { day: number; startTime: string; endTime: string; courtId: string | null; coachIds: string[]; kind: SlotKind }[] };
    if (from === 'EMPTY') return { groups: [] as Copy[], label: 'emploi vide' };
    if ((from === 'DRAFT' || from === 'TEMP') && !fromId) throw new BadRequestException('Choisissez le brouillon ou les vacances à reprendre.');
    if (from === 'TEMP') {
      const src = await this.prisma.tempSchedule.findUnique({ where: { id: fromId }, include: { groups: true, slots: { include: { coaches: true } } } });
      if (!src || src.archivedAt || src.seasonId !== seasonId) throw notFound('Vacances à reprendre');
      const groups = await this.prisma.trainingGroup.findMany({ where: { id: { in: src.groups.map((g) => g.groupId) }, archivedAt: null }, select: { id: true } });
      const alive = new Set(groups.map((g) => g.id));
      return {
        label: `repris de « ${src.name} »`,
        groups: src.groups
          .filter((g) => alive.has(g.groupId))
          .map((g) => ({
            groupId: g.groupId,
            mode: g.mode,
            slots: src.slots
              .filter((x) => x.groupId === g.groupId && days.has(x.day))
              .map((x) => ({ day: x.day, startTime: x.startTime, endTime: x.endTime, courtId: x.courtId, coachIds: x.coaches.map((c) => c.coachId), kind: x.kind })),
          }))
          .filter((g) => g.mode === TempScheduleMode.REPLACE || g.slots.length),
      };
    }
    let draft: Record<string, Copy['slots']> = {};
    let label = 'horaire habituel publié';
    if (from === 'DRAFT') {
      const d = await this.prisma.timetableDraft.findUnique({ where: { id: fromId } });
      if (!d || d.seasonId !== seasonId) throw notFound('Brouillon');
      draft = (d.groups ?? {}) as Record<string, Copy['slots']>;
      label = `brouillon « ${d.name} »`;
    }
    const groups = await this.prisma.trainingGroup.findMany({
      where: { seasonId, archivedAt: null },
      include: { slots: { where: { scheduleId: null }, include: { coaches: true } } },
      orderBy: { name: 'asc' },
    });
    const out: Copy[] = [];
    for (const g of groups) {
      const source = draft[g.id] ?? g.slots.map((x) => ({ day: x.day, startTime: x.startTime, endTime: x.endTime, courtId: x.courtId, coachIds: x.coaches.map((c) => c.coachId), kind: x.kind }));
      const slots = source
        .filter((x) => days.has(x.day))
        .map((x) => ({ day: x.day, startTime: x.startTime, endTime: x.endTime, courtId: x.courtId ?? null, coachIds: x.coachIds ?? [], kind: x.kind ?? SlotKind.TENNIS }));
      // Horaire habituel recopié : seulement les groupes qui ont une séance ces jours-là.
      if (slots.length || (draft[g.id] && g.slots.some((x) => days.has(x.day)))) out.push({ groupId: g.id, mode: TempScheduleMode.REPLACE, slots });
    }
    return { groups: out, label };
  }

  private view(
    s: ScheduleRow,
    groups: Prisma.TrainingGroupGetPayload<{
      include: { category: { select: { name: true } }; slots: { include: typeof slotInclude }; _count: { select: { members: true } } };
    }>[],
  ) {
    const from = isoDay(s.startDate);
    const to = isoDay(s.endDate);
    const days = weekdaysIn(from, to);
    return {
      id: s.id,
      name: s.name,
      startDate: from,
      endDate: to,
      note: s.note,
      sessionsOwed: s.sessionsOwed,
      status: s.status,
      phase: phase(from, to, todayIso()),
      version: s.version,
      publishedAt: s.publishedAt,
      season: { id: s.season.id, label: s.season.label, status: s.season.status, startDate: isoDay(s.season.startDate), endDate: isoDay(s.season.endDate) },
      days: [...days].sort(),
      groups: groups.map((g) => {
        const entry = s.groups.find((x) => x.groupId === g.id);
        const period = groupPeriod(g.kind, s.season);
        return {
          id: g.id,
          name: g.name,
          kind: g.kind,
          category: g.category?.name ?? null,
          members: g._count.members,
          /** L'horaire habituel tombe-t-il pendant ces dates (loisirs : octobre → juin) ? */
          usualRuns: crosses({ from, to }, period),
          usualSlots: g.slots.map(slotView),
          mode: entry?.mode ?? null,
          slots: s.slots.filter((x) => x.groupId === g.id).map(slotView),
        };
      }),
    };
  }
}

/** À venir, en cours ou terminé (pour l'affichage). */
function phase(from: string, to: string, today: string): 'UPCOMING' | 'RUNNING' | 'DONE' {
  return today < from ? 'UPCOMING' : today > to ? 'DONE' : 'RUNNING';
}

function checkDates(dto: { startDate: string; endDate: string }, season: { label: string; startDate: Date; endDate: Date }) {
  dayFromIso(dto.startDate);
  dayFromIso(dto.endDate);
  if (dto.endDate < dto.startDate) throw new BadRequestException('La date de fin doit suivre la date de début.');
  const sFrom = isoDay(season.startDate);
  const sTo = isoDay(season.endDate);
  if (dto.startDate < sFrom || dto.endDate > sTo) {
    throw new BadRequestException(`Dates hors de la saison ${season.label} (du ${frDate(sFrom)} au ${frDate(sTo)}).`);
  }
  const days = (dayFromIso(dto.endDate).getTime() - dayFromIso(dto.startDate).getTime()) / 86_400_000 + 1;
  if (days > MAX_DAYS) throw new BadRequestException(`Emploi temporaire de ${MAX_DAYS} jours au plus.`);
}

function summary(s: ScheduleRow, range: { from: string; to: string }): string {
  const replaced = s.groups.filter((g) => g.mode === TempScheduleMode.REPLACE).map((g) => g.group.name);
  const added = s.groups.filter((g) => g.mode === TempScheduleMode.ADD).map((g) => g.group.name);
  const parts = [
    replaced.length ? `nouvel horaire pour ${replaced.join(', ')}` : '',
    added.length ? `séances en plus pour ${added.join(', ')}` : '',
  ].filter(Boolean);
  return `Du ${frDate(range.from)} au ${frDate(range.to)} : ${parts.join(' ; ')}. Détail dans « Mes séances ».`;
}

function describe(slots: { day: number; startTime: string; endTime: string; court?: { name: string } | null }[]): string {
  return slots.map((x) => `${DAY_NAMES[x.day]} ${x.startTime}–${x.endTime}${x.court ? ' ' + x.court.name : ''}`).join(' · ') || 'aucune séance';
}

function describeDto(slots: { day: number; startTime: string; endTime: string }[]): string {
  return slots.map((x) => `${DAY_NAMES[x.day]} ${x.startTime}–${x.endTime}`).join(' · ') || 'aucune séance';
}
