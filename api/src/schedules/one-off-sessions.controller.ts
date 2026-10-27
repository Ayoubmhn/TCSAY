import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailKind, SlotKind, TempScheduleMode, TempScheduleStatus } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { dayFromIso, isoDay, localInstant, minutesOf, todayIso, weekday } from '../common/dates';
import { assertSeasonOpen, fullName, notFound, rule } from '../common/rules';
import { periodSelect, slotRunsOn, withPeriod } from '../common/sessions';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TYPES = ['MAKEUP', 'EXTRA', 'SPECIAL'] as const;
type OneOffType = (typeof TYPES)[number];
const LABEL: Record<OneOffType, string> = { MAKEUP: 'Rattrapage', EXTRA: 'Séance en plus', SPECIAL: 'Séance spéciale' };

class SlotQuery {
  @IsUUID()
  groupId: string;

  @Matches(DAY, { message: 'Date au format AAAA-MM-JJ.' })
  date: string;

  @Matches(TIME, { message: 'Heure de début au format HH:MM.' })
  startTime: string;

  @Matches(TIME, { message: 'Heure de fin au format HH:MM.' })
  endTime: string;
}

class GroupQuery {
  @IsUUID()
  groupId: string;
}

class CreateDto extends SlotQuery {
  @IsIn(TYPES, { message: 'Type : rattrapage, séance en plus ou séance spéciale.' })
  type: OneOffType;

  /** Séance spéciale : titre affiché (ex. « Préparation du tournoi »). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;

  @IsOptional()
  @IsEnum(SlotKind)
  kind?: SlotKind;

  @IsOptional()
  @IsUUID()
  courtId?: string;

  @IsArray()
  @ArrayMaxSize(4)
  @IsUUID('all', { each: true })
  coachIds: string[];

  /** Rattrapage : séance manquée remplacée (créneau et date). */
  @IsOptional()
  @IsUUID()
  makeupSlotId?: string;

  @IsOptional()
  @Matches(DAY, { message: 'Date de la séance rattrapée au format AAAA-MM-JJ.' })
  makeupDate?: string;

  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

class DeleteQuery {
  @IsString()
  @IsNotEmpty({ message: 'Motif obligatoire.' })
  @MaxLength(200)
  reason: string;

  @IsOptional()
  @Matches(/^(true|false)$/)
  notify?: string;
}

const frDate = (iso: string) => iso.split('-').reverse().join('/');
const overlaps = (a1: string, a2: string, b1: string, b2: string) => minutesOf(a1) < minutesOf(b2) && minutesOf(b1) < minutesOf(a2);

/**
 * Séances ponctuelles d'un groupe, un seul jour : rattrapage (d'une séance manquée), séance en plus (avance) ou séance
 * spéciale. Enregistrées comme un emploi temporaire d'un jour publié d'office (`TempSchedule.kind = ONE_OFF`, séances en
 * plus) : planning, Mes séances, présences, salaires, grille de réservation et compteur les suivent. Contrôles précis
 * pour la date (R5 : terrain, entraîneur, groupe, réservations ; horaires du club, éclairage, fermetures), R10 (pas dans
 * le passé), R8 (présences pointées), audit, familles et entraîneurs prévenus au choix.
 */
@ApiTags('Séances ponctuelles')
@ApiBearerAuth()
@Controller('extra-sessions')
export class OneOffSessionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** Terrains et entraîneurs libres pour ce groupe à cette date et ces heures (fenêtre « Programmer une séance »). */
  @Get('options')
  @Perm('groups.manage')
  async options(@Query() q: SlotQuery) {
    const group = await this.findGroup(q.groupId);
    this.checkTimes(q);
    const busy = await this.busy(group.seasonId, q.date, q.startTime, q.endTime);
    const s = await this.settings.all();
    const night = minutesOf(q.endTime) > s.nightStartHour * 60;
    const [courts, coaches, closures] = await Promise.all([
      this.prisma.court.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.coach.findMany({ where: { user: { isActive: true } }, include: { user: { select: { firstName: true, lastName: true } } } }),
      this.prisma.courtClosure.findMany({ where: { fromDate: { lte: dayFromIso(q.date) }, toDate: { gte: dayFromIso(q.date) } } }),
    ]);
    return {
      groupBusy: busy.groups.get(group.id) ?? null,
      hours: { opening: s.openingHour, closing: s.closingHour, nightStart: s.nightStartHour },
      courts: courts.map((c) => {
        const closed = closures.find((x) => x.courtId === c.id);
        const why = c.maintenance ? 'en entretien' : closed ? `fermé (${closed.reason})` : night && !c.lit ? 'pas éclairé la nuit' : (busy.courts.get(c.id) ?? null);
        return { id: c.id, name: c.name, lit: c.lit, physicalOnly: c.physicalOnly, busy: why };
      }),
      coaches: coaches.map((c) => ({ id: c.id, name: fullName(c.user).trim(), color: c.color, busy: busy.coaches.get(c.id) ?? null })),
    };
  }

  /** Séances du groupe annulées ou reportées (passées ou à venir) et pas encore rattrapées : choix d'un rattrapage. */
  @Get('missed')
  @Perm('groups.manage')
  async missed(@Query() q: GroupQuery) {
    await this.findGroup(q.groupId);
    return this.cancelledSessions(q.groupId, true);
  }

  @Post()
  @Perm('groups.manage')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateDto) {
    const group = await this.findGroup(dto.groupId);
    assertSeasonOpen(group.season);
    this.checkTimes(dto);
    if (dto.date < todayIso() || localInstant(dto.date, dto.startTime) <= new Date()) {
      throw rule.bad('R10', 'Séance dans le passé : choisissez une date et une heure à venir.');
    }
    if (dto.date < isoDay(group.season.startDate) || dto.date > isoDay(group.season.endDate)) {
      throw new BadRequestException('Date en dehors de la saison.');
    }
    const kind = dto.kind ?? SlotKind.TENNIS;
    if (kind === SlotKind.TENNIS && !dto.courtId) throw new BadRequestException('Choisissez un terrain pour une séance de tennis.');
    if (dto.type === 'SPECIAL' && !dto.title?.trim()) throw new BadRequestException('Séance spéciale : donnez-lui un titre (ex. « Préparation du tournoi »).');

    // Rattrapage : seulement une séance du groupe annulée ou reportée (pluie, fermeture, tournoi, entraîneur absent),
    // passée ou à venir, pas encore rattrapée.
    let makeup: { slotId: string; date: string } | null = null;
    if (dto.type === 'MAKEUP') {
      if (!dto.makeupSlotId || !dto.makeupDate) throw new BadRequestException('Rattrapage : choisissez la séance annulée ou reportée.');
      const missed = await this.prisma.groupSlot.findUnique({ where: { id: dto.makeupSlotId }, select: { groupId: true } });
      if (!missed || missed.groupId !== group.id) throw new BadRequestException('La séance rattrapée n’est pas une séance de ce groupe.');
      const already = await this.prisma.tempSchedule.findFirst({
        where: { kind: 'ONE_OFF', archivedAt: null, makeupSlotId: dto.makeupSlotId, makeupDate: dayFromIso(dto.makeupDate) },
      });
      if (already) throw rule.conflict('R5', `Cette séance a déjà un rattrapage le ${frDate(isoDay(already.startDate))}.`);
      const cancelled = await this.cancelledSessions(group.id);
      if (!cancelled.some((c) => c.slotId === dto.makeupSlotId && c.date === dto.makeupDate)) {
        throw new BadRequestException('Rattrapage : choisissez une séance annulée ou reportée de ce groupe.');
      }
      makeup = { slotId: dto.makeupSlotId, date: dto.makeupDate };
    }

    // Contrôles de la date : horaires du club, terrain (éclairage, entretien, fermeture), groupe, terrain et entraîneurs pris.
    const s = await this.settings.all();
    if (minutesOf(dto.startTime) < s.openingHour * 60 || minutesOf(dto.endTime) > s.closingHour * 60) {
      throw rule.bad('R5', `En dehors des heures d’ouverture du club (${s.openingHour} h – ${s.closingHour} h).`);
    }
    const busy = await this.busy(group.seasonId, dto.date, dto.startTime, dto.endTime);
    const groupBusy = busy.groups.get(group.id);
    if (groupBusy) throw rule.conflict('R5', `« ${group.name} » a déjà une séance ${groupBusy}.`);
    if (dto.courtId) {
      const court = await this.prisma.court.findUnique({ where: { id: dto.courtId } });
      if (!court || !court.active) throw notFound('Terrain');
      if (court.maintenance) throw rule.conflict('R5', `${court.name} est en entretien.`);
      if (court.physicalOnly && kind === SlotKind.TENNIS) throw rule.conflict('R5', `${court.name} est réservé aux séances physiques.`);
      if (!court.lit && minutesOf(dto.endTime) > s.nightStartHour * 60) throw rule.conflict('R5', `${court.name} n’est pas éclairé après ${s.nightStartHour} h.`);
      const closed = await this.prisma.courtClosure.findFirst({ where: { courtId: court.id, fromDate: { lte: dayFromIso(dto.date) }, toDate: { gte: dayFromIso(dto.date) } } });
      if (closed) throw rule.conflict('R5', `${court.name} est fermé ce jour-là (${closed.reason}).`);
      const taken = busy.courts.get(court.id);
      if (taken) throw rule.conflict('R5', `${court.name} est déjà pris : ${taken}.`);
    }
    const coachIds = [...new Set(dto.coachIds)];
    if (coachIds.length) {
      const found = await this.prisma.coach.findMany({ where: { id: { in: coachIds }, user: { isActive: true } }, include: { user: { select: { firstName: true, lastName: true } } } });
      if (found.length !== coachIds.length) throw notFound('Entraîneur');
      for (const c of found) {
        const taken = busy.coaches.get(c.id);
        if (taken) throw rule.conflict('R5', `${fullName(c.user).trim()} n’est pas libre : ${taken}.`);
      }
    }

    const name = dto.type === 'SPECIAL' ? dto.title!.trim() : dto.type === 'MAKEUP' ? `Rattrapage du ${makeup!.date.slice(8, 10)}/${makeup!.date.slice(5, 7)}` : LABEL.EXTRA;
    const created = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tempSchedule.create({
        data: {
          seasonId: group.seasonId,
          name,
          startDate: dayFromIso(dto.date),
          endDate: dayFromIso(dto.date),
          kind: 'ONE_OFF',
          oneOffType: dto.type,
          makeupSlotId: makeup?.slotId ?? null,
          makeupDate: makeup ? dayFromIso(makeup.date) : null,
          status: TempScheduleStatus.PUBLISHED,
          publishedAt: new Date(),
          createdById: user.id,
        },
      });
      await tx.tempScheduleGroup.create({ data: { scheduleId: t.id, groupId: group.id, mode: TempScheduleMode.ADD } });
      await tx.groupSlot.create({
        data: {
          groupId: group.id,
          scheduleId: t.id,
          day: weekday(dto.date),
          startTime: dto.startTime,
          endTime: dto.endTime,
          courtId: dto.courtId ?? null,
          kind,
          coaches: { create: coachIds.map((coachId) => ({ coachId })) },
        },
      });
      return t;
    });
    const when = `le ${frDate(dto.date)} de ${dto.startTime} à ${dto.endTime}`;
    await this.audit.log(user.id, {
      action: `Séance ponctuelle programmée (${LABEL[dto.type].toLowerCase()})`,
      entity: 'TempSchedule',
      entityId: created.id,
      target: `${group.name} · ${name}`,
      after: when,
    });
    let notified = 0;
    if (dto.notify !== false) {
      notified = await this.notify(group.id, `${name} : ${group.name}`, `Séance ${when}. Détail dans « Mes séances ».`);
    }
    return { id: created.id, name, notified };
  }

  /** Supprimer une séance ponctuelle avant son début (motif) : familles et entraîneurs prévenus au choix. */
  @Delete(':id')
  @HttpCode(200)
  @Perm('groups.manage')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: DeleteQuery) {
    const t = await this.prisma.tempSchedule.findUnique({
      where: { id },
      include: { slots: true, groups: { include: { group: { select: { id: true, name: true } } } }, season: true },
    });
    if (!t || t.kind !== 'ONE_OFF' || t.archivedAt) throw notFound('Séance ponctuelle');
    assertSeasonOpen(t.season);
    const slot = t.slots[0];
    const date = isoDay(t.startDate);
    if (slot && localInstant(date, slot.startTime) <= new Date()) throw rule.conflict('R10', 'Séance déjà commencée ou passée : elle ne peut plus être supprimée.');
    if (await this.prisma.attendance.count({ where: { slotId: { in: t.slots.map((x) => x.id) } } })) {
      throw rule.conflict('R8', 'Présences déjà pointées : la séance ne peut plus être supprimée.');
    }
    await this.prisma.tempSchedule.update({ where: { id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
    const group = t.groups[0]?.group;
    await this.audit.log(user.id, {
      action: 'Séance ponctuelle supprimée',
      entity: 'TempSchedule',
      entityId: id,
      target: `${group?.name ?? ''} · ${t.name}`,
      before: slot ? `le ${frDate(date)} de ${slot.startTime} à ${slot.endTime}` : frDate(date),
      reason: q.reason.trim(),
    });
    if (group && q.notify !== 'false') {
      await this.notify(group.id, `Séance supprimée : ${group.name}`, `${t.name} du ${frDate(date)}${slot ? ` à ${slot.startTime}` : ''} n’aura pas lieu (${q.reason.trim()}).`);
    }
    return { ok: true };
  }

  // ————————————————————————————————————————————————————————————————————————————————

  /**
   * Séances d'un groupe annulées par le club (pluie, fermeture…), reportées par un tournoi ou annulées faute
   * d'entraîneur (absence validée, décision « annulée »), dans la saison. `onlyOpen` : sans rattrapage programmé.
   */
  private async cancelledSessions(groupId: string, onlyOpen = false) {
    const group = await this.prisma.trainingGroup.findUnique({
      where: { id: groupId },
      select: { id: true, ...periodSelect, slots: { include: { coaches: true } } },
    });
    if (!group) return [];
    const slots = group.slots.map((s) => withPeriod({ ...s, group }));
    const [changes, absences, madeUp] = await Promise.all([
      this.prisma.sessionChange.findMany({ where: { slotId: { in: slots.map((s) => s.id) }, kind: { in: ['CANCELLED', 'POSTPONED'] } } }),
      this.prisma.coachAbsence.findMany({
        where: { status: 'APPROVED', resolution: 'CANCELLED', date: { gte: group.season.startDate, lte: group.season.endDate } },
      }),
      onlyOpen
        ? this.prisma.tempSchedule.findMany({ where: { kind: 'ONE_OFF', archivedAt: null, makeupSlotId: { not: null } }, select: { makeupSlotId: true, makeupDate: true } })
        : Promise.resolve([]),
    ]);
    const out = new Map<string, { slotId: string; date: string; startTime: string; endTime: string; reason: string }>();
    const add = (s: (typeof slots)[number], date: string, reason: string) => {
      const k = `${s.id}|${date}`;
      if (!out.has(k)) out.set(k, { slotId: s.id, date, startTime: s.startTime, endTime: s.endTime, reason });
    };
    for (const c of changes) {
      const s = slots.find((x) => x.id === c.slotId);
      if (s) add(s, isoDay(c.date), c.kind === 'CANCELLED' ? c.reason : `Reportée (${c.reason})`);
    }
    for (const a of absences) {
      const d = isoDay(a.date);
      for (const s of slots) {
        if (!slotRunsOn(s, d)) continue;
        if (a.slotId === s.id || (!a.slotId && s.coaches.some((c) => c.coachId === a.coachId))) add(s, d, 'Entraîneur absent');
      }
    }
    const taken = new Set(madeUp.map((m) => `${m.makeupSlotId}|${m.makeupDate ? isoDay(m.makeupDate) : ''}`));
    return [...out.values()].filter((m) => !taken.has(`${m.slotId}|${m.date}`)).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  }

  private async findGroup(id: string) {
    const g = await this.prisma.trainingGroup.findUnique({ where: { id }, include: { season: true } });
    if (!g || g.archivedAt) throw notFound('Groupe');
    return g;
  }

  private checkTimes(q: { startTime: string; endTime: string }) {
    const dur = minutesOf(q.endTime) - minutesOf(q.startTime);
    if (dur <= 0) throw new BadRequestException('L’heure de fin doit suivre l’heure de début.');
    if (dur > 240) throw new BadRequestException('Une séance dure au plus 4 h.');
  }

  /**
   * Ce qui occupe ce jour-là entre ces heures : séances (habituelles, vacances, ponctuelles ; annulées ou reportées
   * exclues, déplacées sur leur nouveau terrain), réservations, absences validées des entraîneurs.
   */
  private async busy(seasonId: string, date: string, start: string, end: string) {
    const day = dayFromIso(date);
    const [slots, changes, reservations, absences] = await Promise.all([
      this.prisma.groupSlot.findMany({
        where: { day: weekday(date), group: { seasonId, archivedAt: null } },
        include: { coaches: true, court: { select: { name: true } }, group: { select: { id: true, name: true, ...periodSelect } } },
      }),
      this.prisma.sessionChange.findMany({ where: { date: day } }),
      this.prisma.reservation.findMany({
        where: { activeKey: { not: null }, startTime: { lt: localInstant(date, end) }, endTime: { gt: localInstant(date, start) } },
        include: { court: { select: { name: true } } },
      }),
      this.prisma.coachAbsence.findMany({ where: { date: day, status: { in: ['APPROVED', 'PENDING'] } } }),
    ]);
    const courts = new Map<string, string>();
    const coaches = new Map<string, string>();
    const groups = new Map<string, string>();
    for (const s of slots.map(withPeriod)) {
      if (!slotRunsOn(s, date) || !overlaps(s.startTime, s.endTime, start, end)) continue;
      const c = changes.find((x) => x.slotId === s.id);
      if (c && c.kind !== 'MOVED') continue;
      const what = `« ${s.group.name} » de ${s.startTime} à ${s.endTime}`;
      const courtId = c?.kind === 'MOVED' ? c.courtId : s.courtId;
      if (courtId && !courts.has(courtId)) courts.set(courtId, what);
      for (const x of s.coaches) if (!coaches.has(x.coachId)) coaches.set(x.coachId, `avec ${what}`);
      if (!groups.has(s.group.id)) groups.set(s.group.id, `de ${s.startTime} à ${s.endTime}`);
    }
    const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    for (const r of reservations) {
      if (!courts.has(r.courtId)) courts.set(r.courtId, `réservation de ${hm(r.startTime)} à ${hm(r.endTime)}`);
      if (r.coachId && !coaches.has(r.coachId)) coaches.set(r.coachId, `réservation de ${hm(r.startTime)} à ${hm(r.endTime)}`);
    }
    for (const a of absences) {
      if (a.slotId) continue;
      if (!coaches.has(a.coachId)) coaches.set(a.coachId, a.status === 'APPROVED' ? 'absent ce jour-là' : 'absence demandée ce jour-là');
    }
    return { courts, coaches, groups };
  }

  /** Familles (joueurs avec compte, parents actifs) et entraîneurs du groupe. */
  private async notify(groupId: string, title: string, body: string): Promise<number> {
    const [members, coaches] = await Promise.all([
      this.prisma.groupMember.findMany({
        where: { groupId, enrollment: { player: { archivedAt: null } } },
        select: { enrollment: { select: { player: { select: { userId: true, parentLinks: { where: { parent: { isActive: true } }, select: { parentId: true } } } } } } },
      }),
      this.prisma.slotCoach.findMany({ where: { slot: { groupId }, coach: { user: { isActive: true } } }, select: { coach: { select: { userId: true } } } }),
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
    if (rows.length) await this.prisma.notification.createMany({ data: rows });
    return rows.length;
  }
}
