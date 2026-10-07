import { BadRequestException, Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { addDaysIso, dayFromIso, isoDay, localInstant, todayIso, weekday } from '../common/dates';
import { NIL_UUID, notFound } from '../common/rules';
import { sessionsBetween } from '../common/sessions';
import { slotInclude, slotView } from '../groups/groups.controller';
import { PrismaService } from '../prisma/prisma.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

  @IsBoolean()
  present: boolean;

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

/** Séances (calculées depuis les créneaux) et pointage des présences, par créneau. */
@ApiTags('Séances et présences')
@ApiBearerAuth()
@Controller()
export class AttendanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Coach : ses séances ; admin : toutes, ou celles d'un entraîneur. */
  @Get('sessions')
  @Roles(Role.COACH, Role.ADMIN)
  async coachSessions(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    const season = await this.access.activeSeason();
    const coachId = user.role === Role.COACH ? (user.coachId ?? NIL_UUID) : q.coachId;
    const slots = await this.prisma.groupSlot.findMany({
      where: {
        group: { seasonId: season.id, archivedAt: null },
        ...(coachId ? { coaches: { some: { coachId } } } : {}),
      },
      include: {
        ...slotInclude,
        group: {
          select: {
            id: true,
            name: true,
            capacity: true,
            category: { select: { name: true } },
            _count: { select: { members: { where: { enrollment: { player: { archivedAt: null } } } } } },
          },
        },
      },
    });
    const from = q.from ?? addDaysIso(todayIso(), -14);
    const to = q.to ?? addDaysIso(todayIso(), 14);
    const [recorded, absences] = await Promise.all([
      this.prisma.attendance.groupBy({
        by: ['slotId', 'date'],
        where: { slotId: { in: slots.map((s) => s.id) }, date: { gte: dayFromIso(from), lte: dayFromIso(to) } },
      }),
      this.prisma.coachAbsence.findMany({
        where: { status: 'APPROVED', date: { gte: dayFromIso(from), lte: dayFromIso(to) }, ...(coachId ? { coachId } : {}) },
      }),
    ]);
    const done = new Set(recorded.map((r) => `${r.slotId}|${isoDay(r.date)}`));
    const now = new Date();
    return sessionsBetween(slots, from, to).map((s) => ({
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
      coachAbsent: absences.some(
        (a) =>
          isoDay(a.date) === s.date &&
          (a.slotId === s.slot.id || (!a.slotId && s.slot.coaches.some((c) => c.coachId === a.coachId))),
      ),
    }));
  }

  /** Joueur / parent : séances du joueur avec son état de présence. */
  @Get('sessions/player')
  @Roles(Role.PLAYER, Role.PARENT)
  async playerSessions(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    const playerId = await this.access.resolvePlayer(user, q.playerId);
    const season = await this.access.activeSeason();
    const groups = await this.prisma.trainingGroup.findMany({
      where: { seasonId: season.id, archivedAt: null, members: { some: { enrollment: { playerId } } } },
      include: { slots: { include: slotInclude, orderBy: [{ day: 'asc' }, { startTime: 'asc' }] } },
    });
    const slots = groups.flatMap((g) => g.slots.map((s) => ({ ...s, groupName: g.name })));
    const from = q.from ?? addDaysIso(todayIso(), -21);
    const to = q.to ?? addDaysIso(todayIso(), 28);
    const marks = await this.prisma.attendance.findMany({
      where: { playerId, date: { gte: dayFromIso(from), lte: dayFromIso(to) } },
    });
    const now = new Date();
    return {
      groups: groups.map((g) => ({ id: g.id, name: g.name, slots: g.slots.map(slotView) })),
      sessions: sessionsBetween(slots, from, to).map((s) => {
        const mark = marks.find((m) => m.slotId === s.slot.id && isoDay(m.date) === s.date);
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
          attendance: mark ? (mark.present ? 'PRESENT' : 'ABSENT') : null,
        };
      }),
    };
  }

  /** Absences d'un joueur sur la saison active (joueur, parent, admin). */
  @Get('absences')
  @Roles(Role.PLAYER, Role.PARENT, Role.ADMIN)
  async absences(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    const playerId = await this.access.resolvePlayer(user, q.playerId);
    const season = await this.access.activeSeason();
    const rows = await this.prisma.attendance.findMany({
      where: { playerId, present: false, group: { seasonId: season.id } },
      include: { group: { select: { id: true, name: true } }, slot: { select: { startTime: true, endTime: true } } },
      orderBy: { date: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      date: isoDay(r.date),
      group: { ...r.group, startTime: r.slot.startTime, endTime: r.slot.endTime },
      reason: r.reason ?? 'Non justifiée',
    }));
  }

  /** Feuille de présence d'une séance (créneau + date). */
  @Get('attendance')
  @Roles(Role.COACH, Role.ADMIN)
  async sheet(@CurrentUser() user: AuthUser, @Query() q: SheetQuery) {
    await this.access.assertSlotAccess(user, q.slotId);
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
    return {
      group: { id: slot.group.id, name: slot.group.name, startTime: slot.startTime, endTime: slot.endTime },
      slotId: slot.id,
      date: q.date,
      entries: slot.group.members
        .filter((m) => !m.enrollment.player.archivedAt)
        .map((m) => {
          const mark = marks.find((x) => x.playerId === m.enrollment.playerId);
          return {
            playerId: m.enrollment.playerId,
            firstName: m.enrollment.player.firstName,
            lastName: m.enrollment.player.lastName,
            present: mark ? mark.present : null,
            reason: mark?.reason ?? null,
          };
        }),
    };
  }

  /** Pointage : dès le début de la séance, jamais pour une séance future. Tracé dans l'historique. */
  @Put('attendance')
  @Roles(Role.COACH, Role.ADMIN)
  async save(@CurrentUser() user: AuthUser, @Body() dto: SaveSheetDto) {
    await this.access.assertSlotAccess(user, dto.slotId);
    const slot = await this.prisma.groupSlot.findUnique({
      where: { id: dto.slotId },
      include: { group: { include: { members: { include: { enrollment: true } } } } },
    });
    if (!slot) throw notFound('Séance');
    if (slot.day !== weekday(dto.date)) throw new BadRequestException('Pas de séance de ce créneau ce jour-là.');
    if (localInstant(dto.date, slot.startTime) > new Date()) {
      throw new BadRequestException('Pointage disponible le jour de la séance, à partir de son début.');
    }
    const members = new Set(slot.group.members.map((m) => m.enrollment.playerId));
    const date = dayFromIso(dto.date);
    const entries = dto.entries.filter((e) => members.has(e.playerId));
    await this.prisma.$transaction(
      entries.map((e) =>
        this.prisma.attendance.upsert({
          where: { slotId_playerId_date: { slotId: slot.id, playerId: e.playerId, date } },
          create: {
            groupId: slot.groupId,
            slotId: slot.id,
            playerId: e.playerId,
            date,
            present: e.present,
            reason: e.present ? null : e.reason?.trim() || null,
            recordedById: user.id,
          },
          update: { present: e.present, reason: e.present ? null : e.reason?.trim() || null, recordedById: user.id },
        }),
      ),
    );
    const absent = entries.filter((e) => !e.present).length;
    await this.audit.log(user.id, {
      action: 'Présences pointées',
      entity: 'Attendance',
      entityId: slot.id,
      target: `${slot.group.name} · ${dto.date} ${slot.startTime}`,
      after: `${entries.length - absent} présent(s), ${absent} absent(s)`,
    });
    return { ok: true };
  }
}
