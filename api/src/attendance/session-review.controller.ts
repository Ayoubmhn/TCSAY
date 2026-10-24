import { BadRequestException, Body, Controller, ForbiddenException, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AttendanceStatus, EmailKind, Mood, Role } from '@prisma/client';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, can, CurrentUser, Roles } from '../auth/auth-user';
import { Feature } from '../modules/modules';
import { addDaysIso, dayFromIso, isoDay, localInstant } from '../common/dates';
import { notFound } from '../common/rules';
import { periodSelect, slotRunsOn, tempSchedulesSelect, withPeriod } from '../common/sessions';
import { PrismaService } from '../prisma/prisma.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Les 5 critères notés à chaque séance (guide d'évaluation de la direction technique). */
export const RATING_CRITERIA = ['effort', 'focus', 'behavior', 'objective', 'play'] as const;
type Criterion = (typeof RATING_CRITERIA)[number];

class SessionQuery {
  @IsUUID()
  slotId: string;

  @Matches(DATE)
  date: string;
}

class PlanDto extends SessionQuery {
  @IsString()
  @IsNotEmpty({ message: 'Objectif de la séance obligatoire.' })
  @MaxLength(120)
  objective: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  content?: string;
}

class RatingDto extends SessionQuery {
  @IsUUID()
  playerId: string;

  @IsInt() @Min(1) @Max(5) effort: number;
  @IsInt() @Min(1) @Max(5) focus: number;
  @IsInt() @Min(1) @Max(5) behavior: number;
  @IsInt() @Min(1) @Max(5) objective: number;
  @IsInt() @Min(1) @Max(5) play: number;

  @IsOptional()
  @IsEnum(Mood)
  mood?: Mood;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

/** Moyenne des 5 notes, arrondie au dixième. */
export function ratingAverage(r: Record<Criterion, number>): number {
  return Math.round((RATING_CRITERIA.reduce((t, k) => t + r[k], 0) / RATING_CRITERIA.length) * 10) / 10;
}

/**
 * Évaluation de séance (fenêtre séparée des présences) : l'entraîneur fixe l'objectif de la séance,
 * puis note chaque joueur présent (5 critères de 1 à 5, forme du jour, commentaire pour le parent).
 * Entraîneur : de début de séance jusqu'au lendemain soir ; direction (autorisation « présences ») : correction à tout moment.
 */
@ApiTags('Séances et présences')
@ApiBearerAuth()
@Feature('evaluation-seances')
@Controller('sessions')
export class SessionReviewController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Séance ouverte à l'évaluation : commencée, et (entraîneur) avant la fin du lendemain. */
  private window(date: string, startTime: string) {
    const opens = localInstant(date, startTime);
    const closes = localInstant(addDaysIso(date, 2), 0); // lendemain 23:59
    const now = new Date();
    return { opens, closes, started: opens <= now, open: opens <= now && now < closes };
  }

  private async loadSlot(user: AuthUser, slotId: string, date: string) {
    if (user.role === Role.ADMIN && !can(user, 'attendance.manage', 'groups.manage')) {
      throw new ForbiddenException('Accès refusé : autorisation « présences » manquante.');
    }
    await this.access.assertSlotAccess(user, slotId, date);
    const slot = await this.prisma.groupSlot.findUnique({
      where: { id: slotId },
      include: { group: { include: { season: periodSelect.season, tempSchedules: tempSchedulesSelect } } },
    });
    if (!slot) throw notFound('Séance');
    if (!slotRunsOn(withPeriod({ ...slot, group: { kind: slot.group.kind, season: slot.group.season, tempSchedules: slot.group.tempSchedules } }), date)) {
      throw new BadRequestException('Pas de séance de ce créneau ce jour-là.');
    }
    return slot;
  }

  private assertEditable(user: AuthUser, w: { started: boolean; open: boolean }) {
    if (!w.started) throw new BadRequestException('Cette séance n’a pas encore commencé.');
    if (user.role === Role.COACH && !w.open) {
      throw new BadRequestException('Évaluation possible jusqu’au lendemain soir de la séance ; ensuite, la direction peut corriger.');
    }
  }

  /** Objectif de la séance et évaluations des joueurs (présents ou en retard ; absents listés à part). */
  @Get('review')
  @Roles(Role.COACH, Role.ADMIN)
  async review(@CurrentUser() user: AuthUser, @Query() q: SessionQuery) {
    const slot = await this.loadSlot(user, q.slotId, q.date);
    const date = dayFromIso(q.date);
    const [plan, members, marks, ratings] = await Promise.all([
      this.prisma.sessionPlan.findUnique({ where: { slotId_date: { slotId: slot.id, date } } }),
      this.prisma.groupMember.findMany({
        where: { groupId: slot.groupId, enrollment: { player: { archivedAt: null } } },
        include: { enrollment: { select: { player: { select: { id: true, firstName: true, lastName: true } } } } },
      }),
      this.prisma.attendance.findMany({ where: { slotId: slot.id, date } }),
      this.prisma.sessionRating.findMany({ where: { slotId: slot.id, date } }),
    ]);
    const w = this.window(q.date, slot.startTime);
    const players = members
      .map((m) => m.enrollment.player)
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr'))
      .map((p) => {
        const r = ratings.find((x) => x.playerId === p.id);
        return {
          playerId: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          attendance: marks.find((m) => m.playerId === p.id)?.status ?? null,
          rating: r
            ? {
                effort: r.effort,
                focus: r.focus,
                behavior: r.behavior,
                objective: r.objective,
                play: r.play,
                mood: r.mood,
                comment: r.comment,
                average: ratingAverage(r),
              }
            : null,
        };
      });
    return {
      group: { id: slot.group.id, name: slot.group.name },
      slotId: slot.id,
      date: q.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      plan: plan ? { objective: plan.objective, content: plan.content } : null,
      attendanceRecorded: marks.length > 0,
      editable: user.role === Role.ADMIN ? w.started : w.open,
      closesAt: w.closes,
      players,
    };
  }

  /** Objectif et contenu de la séance (créés ou modifiés). */
  @Put('plan')
  @Roles(Role.COACH, Role.ADMIN)
  async savePlan(@CurrentUser() user: AuthUser, @Body() dto: PlanDto) {
    const slot = await this.loadSlot(user, dto.slotId, dto.date);
    // L'objectif se prépare avant la séance : seul le passé verrouillé (entraîneur) est refusé.
    const w = this.window(dto.date, slot.startTime);
    if (user.role === Role.COACH && w.started && !w.open) {
      throw new BadRequestException('Séance terminée depuis plus d’un jour : la direction peut corriger.');
    }
    const date = dayFromIso(dto.date);
    const data = { objective: dto.objective.trim(), content: dto.content?.trim() || null, updatedById: user.id };
    await this.prisma.sessionPlan.upsert({
      where: { slotId_date: { slotId: slot.id, date } },
      create: { groupId: slot.groupId, slotId: slot.id, date, ...data },
      update: data,
    });
    await this.audit.log(user.id, {
      action: 'Objectif de séance',
      entity: 'SessionPlan',
      entityId: slot.id,
      target: `${slot.group.name} · ${dto.date} ${slot.startTime}`,
      after: data.objective,
    });
    return { ok: true };
  }

  /** Évaluation d'un joueur (un joueur à la fois : la fenêtre passe au suivant). */
  @Put('ratings')
  @Roles(Role.COACH, Role.ADMIN)
  async saveRating(@CurrentUser() user: AuthUser, @Body() dto: RatingDto) {
    const slot = await this.loadSlot(user, dto.slotId, dto.date);
    this.assertEditable(user, this.window(dto.date, slot.startTime));
    const date = dayFromIso(dto.date);
    const member = await this.prisma.groupMember.findFirst({
      where: { groupId: slot.groupId, enrollment: { playerId: dto.playerId } },
      include: { enrollment: { select: { player: { select: { firstName: true, lastName: true } } } } },
    });
    if (!member) throw new BadRequestException('Ce joueur n’est pas dans ce groupe.');
    const mark = await this.prisma.attendance.findUnique({
      where: { slotId_playerId_date: { slotId: slot.id, playerId: dto.playerId, date } },
    });
    if (!mark) throw new BadRequestException('Pointez d’abord les présences de la séance.');
    if (mark.status === AttendanceStatus.ABSENT) throw new BadRequestException('Joueur absent : pas d’évaluation.');

    const notes = { effort: dto.effort, focus: dto.focus, behavior: dto.behavior, objective: dto.objective, play: dto.play };
    const data = { ...notes, mood: dto.mood ?? Mood.GOOD, comment: dto.comment?.trim() || null, ratedById: user.id };
    const before = await this.prisma.sessionRating.findUnique({
      where: { slotId_playerId_date: { slotId: slot.id, playerId: dto.playerId, date } },
    });
    await this.prisma.sessionRating.upsert({
      where: { slotId_playerId_date: { slotId: slot.id, playerId: dto.playerId, date } },
      create: { groupId: slot.groupId, slotId: slot.id, playerId: dto.playerId, date, ...data },
      update: data,
    });
    const p = member.enrollment.player;
    if (data.mood === Mood.PAIN && before?.mood !== Mood.PAIN) await this.notifyPain(dto.playerId, `${p.firstName} ${p.lastName}`.trim(), slot.group.name, dto.date, data.comment);
    await this.audit.log(user.id, {
      action: before ? 'Évaluation de séance modifiée' : 'Évaluation de séance',
      entity: 'SessionRating',
      entityId: dto.playerId,
      target: `${p.firstName} ${p.lastName} · ${slot.group.name} · ${isoDay(date)}`,
      before: before ? `${ratingAverage(before)}/5` : undefined,
      after: `${ratingAverage(notes)}/5${data.mood !== Mood.GOOD ? ` · forme ${data.mood === Mood.PAIN ? 'douleur' : 'fatigué'}` : ''}`,
    });
    return { average: ratingAverage(notes) };
  }

  /** Douleur signalée : notification aux parents (ou au joueur majeur) et aux directeurs techniques. */
  private async notifyPain(playerId: string, name: string, group: string, date: string, comment: string | null) {
    const [parents, player, directors] = await Promise.all([
      this.prisma.parentLink.findMany({ where: { playerId, parent: { isActive: true } }, select: { parentId: true } }),
      this.prisma.player.findUnique({ where: { id: playerId }, select: { userId: true } }),
      this.prisma.user.findMany({ where: { isActive: true, roles: { has: Role.TECH_DIRECTOR } }, select: { id: true } }),
    ]);
    const family = [...new Set([...parents.map((l) => l.parentId), ...(player?.userId ? [player.userId] : [])])];
    const body = `Douleur signalée par l’entraîneur pendant la séance du ${date} (${group})${comment ? ` : ${comment}` : '.'}`;
    await this.prisma.notification.createMany({
      data: [
        ...family.map((userId) => ({ userId, kind: EmailKind.OTHER, title: `${name} : douleur signalée`, body, link: '/seances' })),
        ...directors
          .filter((d) => !family.includes(d.id))
          .map((d) => ({ userId: d.id, kind: EmailKind.OTHER, title: `Alerte : ${name}, douleur signalée`, body, link: `/admin/joueurs/${playerId}` })),
      ],
    });
  }
}
