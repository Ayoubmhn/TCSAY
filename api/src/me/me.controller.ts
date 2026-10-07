import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsOptional, IsUUID } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { addDaysIso, todayIso } from '../common/dates';
import { num } from '../common/money';
import { sessionsBetween } from '../common/sessions';
import { slotInclude, slotView } from '../groups/groups.controller';
import { PrismaService } from '../prisma/prisma.service';

class PlayerQuery {
  @IsOptional()
  @IsUUID()
  playerId?: string;
}

/** Accueil joueur / parent (vHome du prototype). */
@ApiTags('Espace joueur')
@ApiBearerAuth()
@Roles(Role.PLAYER, Role.PARENT)
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  @Get('overview')
  async overview(@CurrentUser() user: AuthUser, @Query() q: PlayerQuery) {
    const playerId = await this.access.resolvePlayer(user, q.playerId);
    const season = await this.access.activeSeason();
    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        enrollments: { where: { seasonId: season.id }, select: { category: { select: { name: true } } } },
      },
    });
    const groups = await this.prisma.trainingGroup.findMany({
      where: { seasonId: season.id, archivedAt: null, members: { some: { enrollment: { playerId } } } },
      include: { slots: { include: slotInclude } },
    });
    const slots = groups.flatMap((g) => g.slots.map((s) => ({ ...s, groupName: g.name })));
    const now = new Date();
    const next = sessionsBetween(slots, todayIso(), addDaysIso(todayIso(), 14)).find((s) => s.start > now);

    const installments = await this.prisma.installment.findMany({
      where: { membership: { enrollment: { playerId, seasonId: season.id } } },
      include: { payments: { select: { amount: true } } },
    });
    const due = installments
      .map((i) => num(i.amount) - i.payments.reduce((s, p) => s + num(p.amount), 0))
      .filter((rest) => rest > 0);

    const [reservations, absences] = await Promise.all([
      this.prisma.reservation.count({ where: { playerId, activeKey: { not: null }, startTime: { gte: now } } }),
      this.prisma.attendance.count({ where: { playerId, present: false, group: { seasonId: season.id } } }),
    ]);

    return {
      season: { id: season.id, label: season.label },
      player: { id: player.id, firstName: player.firstName, lastName: player.lastName },
      category: player.enrollments[0]?.category.name ?? null,
      nextSession: next
        ? {
            groupName: next.slot.groupName,
            date: next.date,
            startTime: next.slot.startTime,
            endTime: next.slot.endTime,
            court: next.slot.court?.name ?? null,
            coaches: slotView(next.slot).coaches,
          }
        : null,
      hasGroup: groups.length > 0,
      dueCount: due.length,
      dueAmount: Math.round(due.reduce((s, x) => s + x, 0) * 1000) / 1000,
      upcomingReservations: reservations,
      absences,
    };
  }
}
