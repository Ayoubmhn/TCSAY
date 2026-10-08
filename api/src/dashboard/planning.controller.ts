import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { Perm } from '../auth/auth-user';
import { addDaysIso, dayFromIso, isoDay, localInstant, pad, todayIso, weekday } from '../common/dates';
import { fullName } from '../common/rules';
import { periodSelect, slotRunsOn, withPeriod } from '../common/sessions';
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
@Perm('planning.view', 'groups.manage')
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
        include: { ...slotInclude, group: { select: { id: true, name: true, ...periodSelect } } },
      }),
      this.prisma.coachAbsence.findMany({
        where: { date: dayFromIso(date), status: 'APPROVED' },
        include: { replacementCoach: { select: { id: true, color: true, user: { select: { firstName: true, lastName: true } } } } },
      }),
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
      // Seules les séances dont le groupe s'entraîne à cette date (loisirs : octobre → juin ; compétitif : jusqu'en août).
      sessions: slots
        .map(withPeriod)
        .filter((slot) => slotRunsOn(slot, date))
        .map((slot) => {
          const v = slotView(slot);
          const own = absences.filter((a) => v.coaches.some((c) => c.id === a.coachId) && (!a.slotId || a.slotId === slot.id));
          // Décision de la direction : remplacement, séance physique ou annulation.
          const decided = own.find((a) => a.resolution) ?? own[0];
          const replacement = decided?.replacementCoach;
          return {
            ...v,
            group: { id: slot.group.id, name: slot.group.name },
            absentCoachIds: own.map((a) => a.coachId),
            resolution: decided ? (decided.resolution ?? 'CANCELLED') : null,
            replacement: replacement
              ? { id: replacement.id, firstName: replacement.user.firstName, lastName: replacement.user.lastName, color: replacement.color }
              : null,
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
