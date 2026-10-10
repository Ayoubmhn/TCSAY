import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AttendanceStatus } from '@prisma/client';
import { Perm } from '../auth/auth-user';
import { isoDay } from '../common/dates';
import { num } from '../common/money';
import { notFound } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Historique et statistiques d'une saison (clic sur une saison passée ou en cours). */
@ApiTags('Dashboard')
@ApiBearerAuth()
@Perm('stats.view', 'seasons.manage')
@Controller('stats')
export class SeasonStatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('seasons/:id')
  async season(@Param('id', ParseUUIDPipe) id: string) {
    const season = await this.prisma.season.findUnique({ where: { id } });
    if (!season) throw notFound('Saison');

    const [enrollments, groups, installments, attendance, salaries, reservations, absences] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { seasonId: id },
        include: { category: { select: { name: true, family: true, sortOrder: true } }, player: { select: { gender: true, archivedAt: true } } },
      }),
      this.prisma.trainingGroup.findMany({
        where: { seasonId: id },
        include: { _count: { select: { members: true, slots: true } }, category: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.installment.findMany({
        where: { membership: { enrollment: { seasonId: id } } },
        include: { payments: { select: { amount: true } } },
      }),
      this.prisma.attendance.groupBy({ by: ['status'], where: { group: { seasonId: id } }, _count: { _all: true } }),
      this.prisma.salary.findMany({ where: { seasonId: id }, select: { amount: true, paidAt: true } }),
      this.prisma.reservation.count({
        where: { startTime: { gte: season.startDate, lte: new Date(season.endDate.getTime() + 86_400_000) }, cancelledAt: null },
      }),
      this.prisma.coachAbsence.groupBy({
        by: ['resolution'],
        where: { status: 'APPROVED', date: { gte: season.startDate, lte: season.endDate } },
        _count: { _all: true },
      }),
    ]);

    const byCategory = new Map<string, { name: string; count: number; order: number }>();
    for (const e of enrollments) {
      const c = byCategory.get(e.category.name) ?? { name: e.category.name, count: 0, order: e.category.sortOrder };
      c.count++;
      byCategory.set(e.category.name, c);
    }
    const due = installments.reduce((t, i) => t + num(i.amount), 0);
    const cashed = installments.reduce((t, i) => t + i.payments.reduce((s, p) => s + num(p.amount), 0), 0);
    const att = Object.fromEntries(attendance.map((a) => [a.status, a._count._all])) as Partial<Record<AttendanceStatus, number>>;
    const marks = (att.PRESENT ?? 0) + (att.LATE ?? 0) + (att.ABSENT ?? 0);

    return {
      season: {
        id: season.id,
        label: season.label,
        status: season.status,
        startDate: isoDay(season.startDate),
        endDate: isoDay(season.endDate),
        leisureStartDate: season.leisureStartDate ? isoDay(season.leisureStartDate) : null,
        leisureEndDate: season.leisureEndDate ? isoDay(season.leisureEndDate) : null,
      },
      players: {
        total: enrollments.length,
        boys: enrollments.filter((e) => e.player.gender === 'M').length,
        girls: enrollments.filter((e) => e.player.gender === 'F').length,
        leisure: enrollments.filter((e) => e.category.family === 'LEISURE').length,
        byCategory: [...byCategory.values()].sort((a, b) => a.order - b.order).map(({ name, count }) => ({ name, count })),
      },
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        kind: g.kind,
        category: g.category?.name ?? null,
        members: g._count.members,
        capacity: g.capacity,
        slots: g._count.slots,
        archived: Boolean(g.archivedAt),
      })),
      finances: {
        due: round(due),
        cashed: round(cashed),
        remaining: round(Math.max(0, due - cashed)),
        rate: due > 0 ? Math.round((cashed / due) * 100) : null,
        salariesPaid: round(salaries.filter((s) => s.paidAt).reduce((t, s) => t + num(s.amount), 0)),
        salariesDue: round(salaries.filter((s) => !s.paidAt).reduce((t, s) => t + num(s.amount), 0)),
      },
      attendance: {
        present: att.PRESENT ?? 0,
        late: att.LATE ?? 0,
        absent: att.ABSENT ?? 0,
        rate: marks ? Math.round((((att.PRESENT ?? 0) + (att.LATE ?? 0)) / marks) * 100) : null,
      },
      reservations,
      coachAbsences: Object.fromEntries(absences.map((a) => [a.resolution ?? 'CANCELLED', a._count._all])),
    };
  }
}
