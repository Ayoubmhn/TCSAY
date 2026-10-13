import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AttendanceStatus, Role } from '@prisma/client';
import { IsOptional, IsUUID } from 'class-validator';
import { AccessService } from '../access/access.service';
import { PaymentAccessService } from '../access/payment-access.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { isoDay } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { RATING_CRITERIA, ratingAverage } from './session-review.controller';

class ProgressQuery {
  @IsOptional()
  @IsUUID()
  playerId?: string;
}

const avg = (values: number[]) => (values.length ? Math.round((values.reduce((t, v) => t + v, 0) / values.length) * 10) / 10 : null);

/**
 * Suivi et progression d'un joueur sur la saison active (joueur, parent ; administration avec playerId) :
 * assiduité, moyenne des évaluations par mois, moyenne par critère, dernières séances avec objectif et commentaire.
 * Jamais de montant : rien sur les cotisations.
 */
@ApiTags('Suivi des joueurs')
@ApiBearerAuth()
@Controller('progress')
export class ProgressController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly gate: PaymentAccessService,
  ) {}

  @Get()
  @Roles(Role.PLAYER, Role.PARENT, Role.ADMIN)
  async progress(@CurrentUser() user: AuthUser, @Query() q: ProgressQuery) {
    const playerId = await this.access.resolvePlayer(user, q.playerId);
    if (user.role !== Role.ADMIN) await this.gate.assert(playerId, 'progress');
    const season = await this.access.activeSeason();
    const inSeason = { group: { seasonId: season.id } };
    const [player, marks, ratings, plans] = await Promise.all([
      this.prisma.player.findUnique({
        where: { id: playerId },
        select: {
          firstName: true,
          lastName: true,
          enrollments: {
            where: { seasonId: season.id },
            select: { category: { select: { name: true } }, groups: { select: { group: { select: { id: true, name: true } } } } },
          },
        },
      }),
      this.prisma.attendance.findMany({ where: { playerId, ...inSeason }, select: { status: true } }),
      this.prisma.sessionRating.findMany({
        where: { playerId, ...inSeason },
        orderBy: { date: 'asc' },
        include: { group: { select: { name: true } }, slot: { select: { startTime: true } } },
      }),
      this.prisma.sessionPlan.findMany({
        where: { group: { seasonId: season.id, members: { some: { enrollment: { playerId } } } } },
        select: { slotId: true, date: true, objective: true },
      }),
    ]);

    const count = (s: AttendanceStatus) => marks.filter((m) => m.status === s).length;
    const present = count(AttendanceStatus.PRESENT);
    const late = count(AttendanceStatus.LATE);
    const absent = count(AttendanceStatus.ABSENT);

    // Moyenne par mois (« 2026-10 »)
    const byMonth = new Map<string, number[]>();
    for (const r of ratings) {
      const m = isoDay(r.date).slice(0, 7);
      byMonth.set(m, [...(byMonth.get(m) ?? []), ratingAverage(r)]);
    }
    const months = [...byMonth.entries()].map(([month, values]) => ({ month, average: avg(values), sessions: values.length }));

    const objectiveOf = (slotId: string, date: Date) => plans.find((p) => p.slotId === slotId && p.date.getTime() === date.getTime())?.objective ?? null;
    const enrollment = player?.enrollments[0];

    return {
      player: {
        id: playerId,
        firstName: player?.firstName ?? '',
        lastName: player?.lastName ?? '',
        category: enrollment?.category.name ?? null,
        groups: enrollment?.groups.map((m) => m.group) ?? [],
      },
      season: { id: season.id, label: season.label },
      attendance: {
        present,
        late,
        absent,
        rate: marks.length ? Math.round(((present + late) / marks.length) * 100) : null,
      },
      average: avg(ratings.map(ratingAverage)),
      months,
      criteria: Object.fromEntries(RATING_CRITERIA.map((k) => [k, avg(ratings.map((r) => r[k]))])),
      lastMood: ratings.at(-1)?.mood ?? null,
      sessions: ratings
        .slice(-12)
        .reverse()
        .map((r) => ({
          date: isoDay(r.date),
          group: r.group.name,
          startTime: r.slot.startTime,
          objective: objectiveOf(r.slotId, r.date),
          average: ratingAverage(r),
          mood: r.mood,
          comment: r.comment,
        })),
    };
  }
}
