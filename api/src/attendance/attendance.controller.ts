import { NIL_UUID } from '../common/rules';
import { BadRequestException, Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { addDaysIso, dayFromIso, isoDay, localInstant, todayIso, weekday } from '../common/dates';
import { notFound } from '../common/rules';
import { sessionsBetween } from '../common/sessions';
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
  groupId?: string;
}

class SheetQuery {
  @IsUUID()
  groupId: string;

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
  groupId: string;

  @Matches(DATE)
  date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntryDto)
  entries: EntryDto[];
}

const groupInclude = {
  court: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  coach: { select: { user: { select: { firstName: true, lastName: true } } } },
  members: { select: { enrollment: { select: { playerId: true, player: { select: { archivedAt: true } } } } } },
};

/** Séances (calculées depuis les créneaux des groupes) et pointage des présences. */
@ApiTags('Séances et présences')
@ApiBearerAuth()
@Controller()
export class AttendanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /** Coach : séances de ses groupes ; admin : toutes (ou un groupe). */
  @Get('sessions')
  @Roles(Role.COACH, Role.ADMIN)
  async coachSessions(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    const season = await this.access.activeSeason();
    const groups = await this.prisma.trainingGroup.findMany({
      where: {
        seasonId: season.id,
        archivedAt: null,
        id: q.groupId,
        ...(user.role === Role.COACH ? { coachId: user.coachId ?? NIL_UUID } : {}),
      },
      include: groupInclude,
    });
    const from = q.from ?? addDaysIso(todayIso(), -14);
    const to = q.to ?? addDaysIso(todayIso(), 14);
    const recorded = await this.prisma.attendance.groupBy({
      by: ['groupId', 'date'],
      where: { groupId: { in: groups.map((g) => g.id) }, date: { gte: dayFromIso(from), lte: dayFromIso(to) } },
    });
    const done = new Set(recorded.map((r) => `${r.groupId}|${isoDay(r.date)}`));
    const now = new Date();
    return sessionsBetween(groups, from, to).map((s) => ({
      groupId: s.group.id,
      groupName: s.group.name,
      date: s.date,
      startTime: s.group.startTime,
      endTime: s.group.endTime,
      court: s.group.court,
      category: s.group.category,
      membersCount: s.group.members.filter((m) => !m.enrollment.player.archivedAt).length,
      capacity: s.group.capacity,
      started: s.start <= now,
      recorded: done.has(`${s.group.id}|${s.date}`),
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
      include: groupInclude,
    });
    const from = q.from ?? addDaysIso(todayIso(), -21);
    const to = q.to ?? addDaysIso(todayIso(), 28);
    const marks = await this.prisma.attendance.findMany({
      where: { playerId, date: { gte: dayFromIso(from), lte: dayFromIso(to) } },
    });
    const now = new Date();
    return {
      groups: groups.map((g) => ({ id: g.id, name: g.name, days: g.days, startTime: g.startTime, endTime: g.endTime })),
      sessions: sessionsBetween(groups, from, to).map((s) => {
        const mark = marks.find((m) => m.groupId === s.group.id && isoDay(m.date) === s.date);
        return {
          groupId: s.group.id,
          groupName: s.group.name,
          date: s.date,
          startTime: s.group.startTime,
          endTime: s.group.endTime,
          court: s.group.court,
          coach: s.group.coach ? s.group.coach.user : null,
          past: s.start < now,
          attendance: mark ? (mark.present ? 'PRESENT' : 'ABSENT') : null,
        };
      }),
    };
  }

  /** Joueur / parent : absences de la saison active. */
  @Get('absences')
  @Roles(Role.PLAYER, Role.PARENT, Role.ADMIN)
  async absences(@CurrentUser() user: AuthUser, @Query() q: RangeQuery) {
    const playerId = await this.access.resolvePlayer(user, q.playerId);
    const season = await this.access.activeSeason();
    const rows = await this.prisma.attendance.findMany({
      where: { playerId, present: false, group: { seasonId: season.id } },
      include: { group: { select: { id: true, name: true, startTime: true, endTime: true } } },
      orderBy: { date: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      date: isoDay(r.date),
      group: r.group,
      reason: r.reason ?? 'Non justifiée',
    }));
  }

  /** Feuille de présence d'une séance. */
  @Get('attendance')
  @Roles(Role.COACH, Role.ADMIN)
  async sheet(@CurrentUser() user: AuthUser, @Query() q: SheetQuery) {
    await this.access.assertGroupAccess(user, q.groupId);
    const group = await this.prisma.trainingGroup.findUnique({
      where: { id: q.groupId },
      include: {
        members: {
          include: { enrollment: { include: { player: { select: { id: true, firstName: true, lastName: true, archivedAt: true } } } } },
        },
      },
    });
    if (!group) throw notFound('Groupe');
    const marks = await this.prisma.attendance.findMany({ where: { groupId: group.id, date: dayFromIso(q.date) } });
    return {
      group: { id: group.id, name: group.name, startTime: group.startTime, endTime: group.endTime },
      date: q.date,
      entries: group.members
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

  /** Pointage : disponible dès le début de la séance, jamais pour une séance future. */
  @Put('attendance')
  @Roles(Role.COACH, Role.ADMIN)
  async save(@CurrentUser() user: AuthUser, @Body() dto: SaveSheetDto) {
    await this.access.assertGroupAccess(user, dto.groupId);
    const group = await this.prisma.trainingGroup.findUnique({ where: { id: dto.groupId }, include: { members: { include: { enrollment: true } } } });
    if (!group) throw notFound('Groupe');
    if (!group.days.includes(weekday(dto.date))) throw new BadRequestException('Pas de séance de ce groupe ce jour-là.');
    if (localInstant(dto.date, group.startTime) > new Date()) {
      throw new BadRequestException('Pointage disponible le jour de la séance, à partir de son début.');
    }
    const members = new Set(group.members.map((m) => m.enrollment.playerId));
    const date = dayFromIso(dto.date);
    await this.prisma.$transaction(
      dto.entries
        .filter((e) => members.has(e.playerId))
        .map((e) =>
          this.prisma.attendance.upsert({
            where: { groupId_playerId_date: { groupId: group.id, playerId: e.playerId, date } },
            create: { groupId: group.id, playerId: e.playerId, date, present: e.present, reason: e.present ? null : e.reason?.trim() || null, recordedById: user.id },
            update: { present: e.present, reason: e.present ? null : e.reason?.trim() || null, recordedById: user.id },
          }),
        ),
    );
    return { ok: true };
  }
}
