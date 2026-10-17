import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { Perm } from '../auth/auth-user';
import { addDaysIso, dayFromIso, localInstant, todayIso } from '../common/dates';
import { num } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

/** Statistiques admin (vDash du prototype). */
@ApiTags('Dashboard')
@ApiBearerAuth()
@Perm('stats.view')
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

    const monthStart = `${today.slice(0, 7)}-01`;
    const [activePlayers, groups, coaches, payments, installments, reservationsTomorrow, extra] = await Promise.all([
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
      this.extra(season.id, today, monthStart),
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
          days: Math.floor((dayFromIso(today).getTime() - i.dueDate.getTime()) / 86_400_000),
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
      // Nouveau tableau de bord : joueurs inscrits ce mois, montant attendu, familles en retard, retards de plus de 30 jours, « À traiter ».
      lateFamilies: new Set(late.map((i) => i.player.id)).size,
      late30: late.filter((i) => i.days > 30).length,
      ...extra,
    };
  }

  /** Compteurs du tableau de bord : inscriptions du mois, montant attendu, réservations du jour et éléments à traiter. */
  private async extra(seasonId: string, today: string, monthStart: string) {
    const [newThisMonth, due, reservationsToday, pendingAbsences, newComplaints, tournamentRequests, withoutMembership] = await Promise.all([
      this.prisma.enrollment.count({ where: { seasonId, createdAt: { gte: localInstant(monthStart, 0) }, player: { archivedAt: null } } }),
      this.prisma.membership.aggregate({ where: { enrollment: { seasonId, player: { archivedAt: null } } }, _sum: { totalAmount: true } }),
      this.prisma.reservation.count({ where: { activeKey: { not: null }, startTime: { gte: localInstant(today, 0), lt: localInstant(addDaysIso(today, 1), 0) } } }),
      this.prisma.coachAbsence.count({ where: { status: 'PENDING', date: { gte: dayFromIso(today) } } }),
      this.prisma.complaint.count({ where: { status: 'NEW' } }),
      this.prisma.tournamentEntry.count({ where: { status: 'PENDING', tournament: { status: { notIn: ['CANCELLED', 'FINISHED'] } } } }),
      this.prisma.enrollment.count({ where: { seasonId, membership: null, player: { archivedAt: null } } }),
    ]);
    return {
      newThisMonth,
      due: num(due._sum.totalAmount ?? 0),
      reservationsToday,
      todo: { pendingAbsences, newComplaints, tournamentRequests, withoutMembership },
    };
  }
}
