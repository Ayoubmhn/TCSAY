import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsOptional, Matches } from 'class-validator';
import { Roles } from '../auth/auth-user';
import { addDaysIso, dayFromIso, isoDay, localInstant, pad, todayIso, weekday } from '../common/dates';
import { fullName } from '../common/rules';
import { slotInclude, slotView } from '../groups/groups.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

class DayQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date au format AAAA-MM-JJ.' })
  date?: string;
}

/**
 * Planning des terrains d'un jour (comme le tableau papier du club) : lignes = terrains,
 * colonnes = demi-heures ; séances colorées par entraîneur, absences validées, réservations.
 */
@ApiTags('Dashboard')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.STAFF)
@Controller('planning')
export class PlanningController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async day(@Query() q: DayQuery) {
    const date = q.date ?? todayIso();
    const s = await this.settings.all();
    const [courts, slots, absences, reservations, coaches] = await Promise.all([
      this.prisma.court.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.groupSlot.findMany({
        where: { day: weekday(date), group: { archivedAt: null, season: { status: 'ACTIVE' } } },
        include: { ...slotInclude, group: { select: { id: true, name: true } } },
      }),
      this.prisma.coachAbsence.findMany({ where: { date: dayFromIso(date), status: 'APPROVED' } }),
      this.prisma.reservation.findMany({
        where: { activeKey: { not: null }, startTime: { gte: localInstant(date, 0), lt: localInstant(addDaysIso(date, 1), 0) } },
        include: {
          player: { select: { firstName: true, lastName: true } },
          coach: { select: { color: true, user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.coach.findMany({ where: { user: { isActive: true } }, include: { user: { select: { firstName: true, lastName: true } } } }),
    ]);

    return {
      date,
      weekday: weekday(date),
      openingHour: s.openingHour,
      closingHour: s.closingHour,
      nightStartHour: s.nightStartHour,
      courts: courts.map((c) => ({ id: c.id, name: c.name, lit: c.lit, maintenance: c.maintenance, active: c.active })),
      sessions: slots.map((slot) => {
        const v = slotView(slot);
        return {
          ...v,
          group: slot.group,
          absentCoachIds: v.coaches
            .filter((c) => absences.some((a) => a.coachId === c.id && (!a.slotId || a.slotId === slot.id)))
            .map((c) => c.id),
        };
      }),
      reservations: reservations.map((r) => ({
        id: r.id,
        courtId: r.courtId,
        startTime: `${pad(r.startTime.getHours())}:${pad(r.startTime.getMinutes())}`,
        endTime: `${pad(r.endTime.getHours())}:${pad(r.endTime.getMinutes())}`,
        type: r.type,
        player: r.player ? fullName(r.player) : null,
        coach: r.coach ? { name: fullName(r.coach.user).trim(), color: r.coach.color } : null,
      })),
      legend: coaches.map((c) => ({ id: c.id, name: fullName(c.user).trim(), color: c.color })),
      absences: absences.map((a) => ({ coachId: a.coachId, slotId: a.slotId, date: isoDay(a.date) })),
    };
  }
}
