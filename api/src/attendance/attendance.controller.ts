import { BadRequestException, Body, Controller, ForbiddenException, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AttendanceStatus, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, can, CurrentUser, Roles } from '../auth/auth-user';
import { addDaysIso, dayFromIso, isoDay, localInstant, todayIso } from '../common/dates';
import { NIL_UUID, notFound } from '../common/rules';
import { periodSelect, sessionsBetween, slotRunsOn, withPeriod } from '../common/sessions';
import { slotInclude, slotView } from '../groups/groups.controller';
import { PrismaService } from '../prisma/prisma.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Pointage par l'entraîneur : seulement pendant la séance en cours (15 min avant le début → 30 min après la fin). */
export const ATTENDANCE_OPEN_BEFORE_MIN = 15;
export const ATTENDANCE_CLOSE_AFTER_MIN = 30;

class RangeQuery {
  @IsOptional()
  @Matches(DATE)
  from?: string;

  @IsOptional()
  @Matches(DATE)
  to?: string;

  @IsOptional()
  @IsUUID()
  playerId?: string;

  @IsOptional()
  @IsUUID()
  coachId?: string;
}

class SheetQuery {
  @IsUUID()
  slotId: string;

  @Matches(DATE)
  date: string;
}

class EntryDto {
  @IsUUID()
  playerId: string;

  @IsEnum(AttendanceStatus, { message: 'Présent, absent ou en retard.' })
  status: AttendanceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

class SaveSheetDto {
  @IsUUID()
  slotId: string;

  @Matches(DATE)
  date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntryDto)
  entries: EntryDto[];
}

type AbsenceRow = {
  coachId: string;
  slotId: string | null;
  date: Date;
  resolution: 'REPLACED' | 'PHYSICAL' | 'CANCELLED' | null;
  replacementCoachId: string | null;
  replacementCoach: { id: string; color: string; user: { firstName: string; lastName: string } } | null;
};

const absenceInclude = {
  replacementCoach: { select: { id: true, color: true, user: { select: { firstName: true, lastName: true } } } },
} as const;

/** Absence validée qui touche cette séance (créneau précis, ou toute la journée d'un de ses entraîneurs). */
function absenceFor(absences: AbsenceRow[], slot: { id: string; coaches: { coachId: string }[] }, date: string) {
  const own = absences.filter(
    (a) => isoDay(a.date) === date && (a.slotId === slot.id || (!a.slotId && slot.coaches.some((c) => c.coachId === a.coachId))),
  );
  return own.find((a) => a.resolution) ?? own[0] ?? null;
}

function absenceView(a: AbsenceRow | null) {
  if (!a) return { coachAbsent: false, resolution: null, replacement: null };
  const r = a.replacementCoach;
  return {
    coachAbsent: true,
    resolution: a.resolution ?? 'CANCELLED',
    replacement: r ? { id: r.id, firstName: r.user.firstName, lastName: r.user.lastName, color: r.color } : null,
  };
}

/** Fenêtre de pointage de l'entraîneur pour une séance. */
export function attendanceWindow(date: string, startTime: string, endTime: string) {
  const opens = new Date(localInstant(date, startTime).getTime() - ATTENDANCE_OPEN_BEFORE_MIN * 60_000);
  const closes = new Date(localInstant(date, endTime).getTime() + ATTENDANCE_CLOSE_AFTER_MIN * 60_000);
  return { opens, closes, open: opens <= new Date() && new Date() <= closes };
}

/** Séances (calculées depuis les créneaux) et pointage des présences : présent, absent ou en retard. */
@ApiTags('Séances et présences')
@ApiBearerAuth()
@Controller()
export class AttendanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Coach : ses séances, plus celles où il remplace un collègue absent ; administration : toutes, ou celles d'un entraîneur.
   * Chaque séance indique si le pointage est ouvert (séance en cours) et la décision prise en cas d'absence de l'entraîneur.
   */
  @Get('sessions')
  @Roles(Role.COACH, Role.ADMIN)
  async coachSessions(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    const season = await this.access.activeSeason();
    const coachId = user.role === Role.COACH ? (user.coachId ?? NIL_UUID) : q.coachId;
    const from = q.from ?? addDaysIso(todayIso(), -14);
    const to = q.to ?? addDaysIso(todayIso(), 14);
    const groupSelect = {
      select: {
        id: true,
        name: true,
        capacity: true,
        category: { select: { name: true } },
        _count: { select: { members: { where: { enrollment: { player: { archivedAt: null } } } } } },
        ...periodSelect,
      },
    } as const;

    const range = { gte: dayFromIso(from), lte: dayFromIso(to) };
    const [ownSlots, absences, replacing] = await Promise.all([
      this.prisma.groupSlot.findMany({
        where: { group: { seasonId: season.id, archivedAt: null }, ...(coachId ? { coaches: { some: { coachId } } } : {}) },
        include: { ...slotInclude, group: groupSelect },
      }),
      this.prisma.coachAbsence.findMany({ where: { status: 'APPROVED', date: range }, include: absenceInclude }),
      coachId
        ? this.prisma.coachAbsence.findMany({
            where: { replacementCoachId: coachId, status: 'APPROVED', resolution: 'REPLACED', date: range },
            include: { coach: { select: { slots: { select: { slotId: true } } } } },
          })
        : Promise.resolve([]),
    ]);

    // Séances où l'entraîneur remplace un collègue (créneau précis ou toute la journée du collègue).
    const replacedSlotIds = [...new Set(replacing.flatMap((a) => (a.slotId ? [a.slotId] : a.coach.slots.map((s) => s.slotId))))];
    const extraSlots = replacedSlotIds.length
      ? await this.prisma.groupSlot.findMany({
          where: { id: { in: replacedSlotIds }, group: { seasonId: season.id, archivedAt: null } },
          include: { ...slotInclude, group: groupSelect },
        })
      : [];
    const replacingKeys = new Set(
      replacing.flatMap((a) => (a.slotId ? [a.slotId] : a.coach.slots.map((s) => s.slotId)).map((id) => `${id}|${isoDay(a.date)}`)),
    );

    const slots = ownSlots.map(withPeriod);
    const own = sessionsBetween(slots, from, to).map((s) => ({ s, replacing: false }));
    const extra = sessionsBetween(extraSlots.map(withPeriod), from, to)
      .filter((s) => replacingKeys.has(`${s.slot.id}|${s.date}`))
      .map((s) => ({ s, replacing: true }));

    const allSlotIds = [...slots, ...extraSlots].map((s) => s.id);
    const recorded = await this.prisma.attendance.groupBy({ by: ['slotId', 'date'], where: { slotId: { in: allSlotIds }, date: range } });
    const done = new Set(recorded.map((r) => `${r.slotId}|${isoDay(r.date)}`));
    const now = new Date();

    return [...own, ...extra]
      .sort((a, b) => a.s.start.getTime() - b.s.start.getTime())
      .map(({ s, replacing: isReplacing }) => {
        const absence = absenceFor(absences, s.slot, s.date);
        // L'entraîneur absent ne voit plus la séance comme la sienne à pointer, sauf si elle est maintenue en physique.
        return {
          slotId: s.slot.id,
          groupId: s.slot.group.id,
          groupName: s.slot.group.name,
          date: s.date,
          startTime: s.slot.startTime,
          endTime: s.slot.endTime,
          court: s.slot.court,
          coaches: slotView(s.slot).coaches,
          category: s.slot.group.category?.name ?? null,
          membersCount: s.slot.group._count.members,
          capacity: s.slot.group.capacity,
          started: s.start <= now,
          recorded: done.has(`${s.slot.id}|${s.date}`),
          open: attendanceWindow(s.date, s.slot.startTime, s.slot.endTime).open,
          replacing: isReplacing,
          ...absenceView(absence),
        };
      });
  }

  /** Joueur / parent : séances du joueur avec son état de présence et les changements (annulation, remplacement, physique). */
  @Get('sessions/player')
  @Roles(Role.PLAYER, Role.PARENT)
  async playerSessions(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    const playerId = await this.access.resolvePlayer(user, q.playerId);
    const season = await this.access.activeSeason();
    const groups = await this.prisma.trainingGroup.findMany({
      where: { seasonId: season.id, archivedAt: null, members: { some: { enrollment: { playerId } } } },
      include: { slots: { include: slotInclude, orderBy: [{ day: 'asc' }, { startTime: 'asc' }] }, season: periodSelect.season },
    });
    const slots = groups.flatMap((g) =>
      g.slots.map((s) => withPeriod({ ...s, groupName: g.name, group: { kind: g.kind, season: g.season } })),
    );
    const from = q.from ?? addDaysIso(todayIso(), -21);
    const to = q.to ?? addDaysIso(todayIso(), 28);
    const [marks, absences] = await Promise.all([
      this.prisma.attendance.findMany({ where: { playerId, date: { gte: dayFromIso(from), lte: dayFromIso(to) } } }),
      this.prisma.coachAbsence.findMany({
        where: { status: 'APPROVED', date: { gte: dayFromIso(from), lte: dayFromIso(to) } },
        include: absenceInclude,
      }),
    ]);
    const now = new Date();
    return {
      groups: groups.map((g) => ({ id: g.id, name: g.name, kind: g.kind, slots: g.slots.map(slotView) })),
      sessions: sessionsBetween(slots, from, to).map((s) => {
        const mark = marks.find((m) => m.slotId === s.slot.id && isoDay(m.date) === s.date);
        const absence = absenceView(absenceFor(absences, s.slot, s.date));
        return {
          slotId: s.slot.id,
          groupId: s.slot.groupId,
          groupName: s.slot.groupName,
          date: s.date,
          startTime: s.slot.startTime,
          endTime: s.slot.endTime,
          court: s.slot.court,
          coaches: slotView(s.slot).coaches,
          past: s.start < now,
          attendance: mark?.status ?? null,
          resolution: absence.resolution,
          replacement: absence.replacement,
        };
      }),
    };
  }

  /** Absences et retards d'un joueur sur la saison active (joueur, parent, administration). */
  @Get('absences')
  @Roles(Role.PLAYER, Role.PARENT, Role.ADMIN)
  async absences(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    const playerId = await this.access.resolvePlayer(user, q.playerId);
    const season = await this.access.activeSeason();
    const rows = await this.prisma.attendance.findMany({
      where: { playerId, status: { in: [AttendanceStatus.ABSENT, AttendanceStatus.LATE] }, group: { seasonId: season.id } },
      include: { group: { select: { id: true, name: true } }, slot: { select: { startTime: true, endTime: true } } },
      orderBy: { date: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      date: isoDay(r.date),
      status: r.status,
      group: { ...r.group, startTime: r.slot.startTime, endTime: r.slot.endTime },
      reason: r.reason ?? (r.status === AttendanceStatus.LATE ? 'Retard' : 'Non justifiée'),
    }));
  }

  /** Feuille de présence d'une séance (créneau + date). */
  @Get('attendance')
  @Roles(Role.COACH, Role.ADMIN)
  async sheet(@CurrentUser() user: AuthUser, @Query() q: SheetQuery) {
    await this.access.assertSlotAccess(user, q.slotId, q.date);
    const slot = await this.prisma.groupSlot.findUnique({
      where: { id: q.slotId },
      include: {
        group: {
          include: {
            members: {
              include: {
                enrollment: { include: { player: { select: { id: true, firstName: true, lastName: true, archivedAt: true } } } },
              },
            },
          },
        },
      },
    });
    if (!slot) throw notFound('Séance');
    const marks = await this.prisma.attendance.findMany({ where: { slotId: slot.id, date: dayFromIso(q.date) } });
    const window = attendanceWindow(q.date, slot.startTime, slot.endTime);
    return {
      group: { id: slot.group.id, name: slot.group.name, startTime: slot.startTime, endTime: slot.endTime },
      slotId: slot.id,
      date: q.date,
      open: window.open,
      opensAt: window.opens,
      closesAt: window.closes,
      editable: user.role === Role.ADMIN ? can(user, 'attendance.manage') && window.opens <= new Date() : window.open,
      entries: slot.group.members
        .filter((m) => !m.enrollment.player.archivedAt)
        .map((m) => {
          const mark = marks.find((x) => x.playerId === m.enrollment.playerId);
          return {
            playerId: m.enrollment.playerId,
            firstName: m.enrollment.player.firstName,
            lastName: m.enrollment.player.lastName,
            status: mark?.status ?? null,
            reason: mark?.reason ?? null,
          };
        }),
    };
  }

  /**
   * Pointage : l'entraîneur ne pointe que la séance en cours (15 min avant → 30 min après) ; la direction
   * (autorisation « présences ») peut corriger une séance passée. Séance annulée : pas de pointage. Tracé dans l'historique.
   */
  @Put('attendance')
  @Roles(Role.COACH, Role.ADMIN)
  async save(@CurrentUser() user: AuthUser, @Body() dto: SaveSheetDto) {
    if (user.role === Role.ADMIN && !can(user, 'attendance.manage')) {
      throw new ForbiddenException('Accès refusé : autorisation « présences » manquante.');
    }
    await this.access.assertSlotAccess(user, dto.slotId, dto.date);
    const slot = await this.prisma.groupSlot.findUnique({
      where: { id: dto.slotId },
      include: { coaches: true, group: { include: { members: { include: { enrollment: true } }, season: periodSelect.season } } },
    });
    if (!slot) throw notFound('Séance');
    if (!slotRunsOn(withPeriod({ ...slot, group: { kind: slot.group.kind, season: slot.group.season } }), dto.date)) {
      throw new BadRequestException('Pas de séance de ce créneau ce jour-là.');
    }
    const window = attendanceWindow(dto.date, slot.startTime, slot.endTime);
    if (user.role === Role.COACH && !window.open) {
      throw new BadRequestException(
        `Pointage possible seulement pendant la séance en cours (${ATTENDANCE_OPEN_BEFORE_MIN} min avant le début jusqu’à ${ATTENDANCE_CLOSE_AFTER_MIN} min après la fin).`,
      );
    }
    if (window.opens > new Date()) throw new BadRequestException('Cette séance n’a pas encore commencé.');
    const cancelled = await this.prisma.coachAbsence.count({
      where: {
        status: 'APPROVED',
        resolution: 'CANCELLED',
        date: dayFromIso(dto.date),
        OR: [{ slotId: slot.id }, { slotId: null, coachId: { in: slot.coaches.map((c) => c.coachId) } }],
      },
    });
    if (cancelled) throw new BadRequestException('Séance annulée par la direction : pas de pointage.');

    const members = new Set(slot.group.members.map((m) => m.enrollment.playerId));
    const date = dayFromIso(dto.date);
    const entries = dto.entries.filter((e) => members.has(e.playerId));
    const reasonOf = (e: EntryDto) => (e.status === AttendanceStatus.PRESENT ? null : e.reason?.trim() || null);
    await this.prisma.$transaction(
      entries.map((e) =>
        this.prisma.attendance.upsert({
          where: { slotId_playerId_date: { slotId: slot.id, playerId: e.playerId, date } },
          create: { groupId: slot.groupId, slotId: slot.id, playerId: e.playerId, date, status: e.status, reason: reasonOf(e), recordedById: user.id },
          update: { status: e.status, reason: reasonOf(e), recordedById: user.id },
        }),
      ),
    );
    const count = (st: AttendanceStatus) => entries.filter((e) => e.status === st).length;
    await this.audit.log(user.id, {
      action: user.role === Role.ADMIN ? 'Présences corrigées' : 'Présences pointées',
      entity: 'Attendance',
      entityId: slot.id,
      target: `${slot.group.name} · ${dto.date} ${slot.startTime}`,
      after: `${count('PRESENT')} présent(s), ${count('LATE')} en retard, ${count('ABSENT')} absent(s)`,
    });
    return { ok: true };
  }
}

