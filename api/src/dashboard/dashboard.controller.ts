import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { Roles } from '../auth/auth-user';
import { addDaysIso, dayFromIso, localInstant, todayIso } from '../common/dates';
import { num } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

/** Statistiques admin (vDash du prototype). */
@ApiTags('Dashboard')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async stats() {
    const season = await this.access.activeSeason();
    const today = todayIso();
    const tomorrow = addDaysIso(today, 1);

    const [activePlayers, groups, coaches, payments, installments, reservationsTomorrow] = await Promise.all([
      this.prisma.player.count({ where: { archivedAt: null, enrollments: { some: { seasonId: season.id } } } }),
      this.prisma.trainingGroup.findMany({
        where: { seasonId: season.id, archivedAt: null },
        include: { members: { where: { enrollment: { player: { archivedAt: null } } } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.coach.count({ where: { user: { isActive: true } } }),
      this.prisma.payment.findMany({
        where: { installment: { membership: { enrollment: { seasonId: season.id } } } },
        select: { amount: true },
      }),
      this.prisma.installment.findMany({
        where: {
          dueDate: { lt: dayFromIso(today) },
          membership: { enrollment: { seasonId: season.id, player: { archivedAt: null } } },
        },
        include: {
          payments: { select: { amount: true } },
          membership: { select: { enrollment: { select: { player: { select: { id: true, firstName: true, lastName: true } } } } } },
        },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.reservation.count({
        where: {
          activeKey: { not: null },
          startTime: { gte: localInstant(tomorrow, 0), lt: localInstant(addDaysIso(tomorrow, 1), 0) },
        },
      }),
    ]);

    const late = installments
      .map((i) => {
        const paid = i.payments.reduce((s, p) => s + num(p.amount), 0);
        return {
          id: i.id,
          number: i.number,
          count: i.count,
          dueDate: i.dueDate,
          remaining: Math.round((num(i.amount) - paid) * 1000) / 1000,
          player: i.membership.enrollment.player,
        };
      })
      .filter((i) => i.remaining > 0);

    return {
      season: { id: season.id, label: season.label },
      activePlayers,
      groupsCount: groups.length,
      coachesCount: coaches,
      cashed: payments.reduce((s, p) => s + num(p.amount), 0),
      paymentsCount: payments.length,
      late,
      lateAmount: late.reduce((s, i) => s + i.remaining, 0),
      reservationsTomorrow,
      tomorrow,
      groups: groups.map((g) => ({ id: g.id, name: g.name, members: g.members.length, capacity: g.capacity })),
    };
  }
}
