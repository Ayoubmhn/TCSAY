import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AttendanceStatus, EmailKind, Mood, Prisma, Role } from '@prisma/client';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, can, CurrentUser, Roles } from '../auth/auth-user';
import { addDaysIso, dayFromIso, isoDay, todayIso } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { ratingAverage } from '../attendance/session-review.controller';

/** Critères du bilan (guide d'évaluation de la direction technique), notés de 1 à 5. */
export const EVALUATION_CRITERIA = [
  { key: 'forehand', label: 'Coup droit', family: 'Technique' },
  { key: 'backhand', label: 'Revers', family: 'Technique' },
  { key: 'serve', label: 'Service', family: 'Technique' },
  { key: 'return', label: 'Retour de service', family: 'Technique' },
  { key: 'volley', label: 'Volée et smash', family: 'Technique' },
  { key: 'dropLob', label: 'Amorti et lob', family: 'Technique' },
  { key: 'footwork', label: 'Jeu de jambes et placement', family: 'Technique' },
  { key: 'pointBuilding', label: 'Construction du point', family: 'Tactique' },
  { key: 'shotChoice', label: 'Choix des coups', family: 'Tactique' },
  { key: 'speed', label: 'Vitesse', family: 'Physique' },
  { key: 'agility', label: 'Agilité', family: 'Physique' },
  { key: 'endurance', label: 'Endurance', family: 'Physique' },
  { key: 'coordination', label: 'Coordination', family: 'Physique' },
  { key: 'confidence', label: 'Confiance et combativité', family: 'Mental' },
  { key: 'stress', label: 'Gestion du stress', family: 'Mental' },
] as const;
const CRITERIA_KEYS: string[] = EVALUATION_CRITERIA.map((c) => c.key);

/** Périodes de bilan dans la saison (trimestres, été). */
export const PERIODS = [
  { key: 'T1', label: 'Trimestre 1 (sept. → déc.)', from: [0, 9, 1], to: [0, 12, 31] },
  { key: 'T2', label: 'Trimestre 2 (janv. → mars)', from: [1, 1, 1], to: [1, 3, 31] },
  { key: 'T3', label: 'Trimestre 3 (avr. → juin)', from: [1, 4, 1], to: [1, 6, 30] },
  { key: 'ETE', label: 'Été (juil. → août)', from: [1, 7, 1], to: [1, 8, 31] },
] as const;
type PeriodKey = (typeof PERIODS)[number]['key'];
const PERIOD_KEYS = PERIODS.map((p) => p.key);

/** Dates de la période pour une saison commençant l'année `year`. */
function periodRange(period: PeriodKey, year: number) {
  const p = PERIODS.find((x) => x.key === period)!;
  const day = ([dy, m, d]: readonly number[]) => dayFromIso(`${year + dy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  return { gte: day(p.from), lte: day(p.to) };
}

class PlayerQuery {
  @IsOptional()
  @IsUUID()
  playerId?: string;
}

class GroupQuery {
  @IsUUID()
  groupId: string;

  @IsIn(PERIOD_KEYS)
  period: PeriodKey;
}

class EvaluationDto {
  @IsUUID()
  playerId: string;

  @IsIn(PERIOD_KEYS, { message: 'Période inconnue.' })
  period: PeriodKey;

  @IsObject()
  scores: Record<string, number>;

  @IsOptional() @IsString() @MaxLength(500) strengths?: string;
  @IsOptional() @IsString() @MaxLength(500) toWork?: string;
  @IsOptional() @IsString() @MaxLength(500) goals?: string;
  @IsOptional() @IsString() @MaxLength(40) proposedLevel?: string;

  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

type EvaluationRow = Prisma.EvaluationGetPayload<{
  include: { author: { select: { firstName: true; lastName: true } }; levelValidatedBy: { select: { firstName: true; lastName: true } } };
}>;

/** Moyenne des critères notés. */
function scoresAverage(scores: Record<string, number>) {
  const v = Object.values(scores).filter((n) => typeof n === 'number');
  return v.length ? Math.round((v.reduce((t, n) => t + n, 0) / v.length) * 10) / 10 : null;
}

/**
 * Bilans de période : l'entraîneur (de ses groupes) ou la direction technique (« evaluations.manage ») rédige le bilan
 * trimestriel ; le niveau proposé est validé par la direction technique ; le parent et le joueur voient les bilans partagés.
 */
@ApiTags('Suivi des joueurs')
@ApiBearerAuth()
@Controller('evaluations')
export class EvaluationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Critères et périodes (formulaire du bilan). */
  @Get('criteria')
  @Roles(Role.COACH, Role.ADMIN, Role.PARENT, Role.PLAYER)
  criteria() {
    return { criteria: EVALUATION_CRITERIA, periods: PERIODS.map(({ key, label }) => ({ key, label })) };
  }

  private assertManager(user: AuthUser) {
    if (user.role === Role.ADMIN && !can(user, 'evaluations.manage')) {
      throw new ForbiddenException('Accès refusé : autorisation « suivi technique » manquante.');
    }
  }

  /** L'entraîneur n'évalue que les joueurs de ses groupes (saison active). */
  private async assertCoachOf(user: AuthUser, playerId: string, seasonId: string) {
    if (user.role === Role.ADMIN) return;
    const ok = await this.prisma.groupMember.count({
      where: {
        enrollment: { playerId, seasonId },
        group: { archivedAt: null, slots: { some: { coaches: { some: { coachId: user.coachId ?? '' } } } } },
      },
    });
    if (!ok) throw new ForbiddenException('Ce joueur n’est pas dans vos groupes.');
  }

  /** Groupes de l'entraîneur (saison active) ; direction : tous les groupes. */
  @Get('groups')
  @Roles(Role.COACH, Role.ADMIN)
  async groups(@CurrentUser() user: AuthUser) {
    this.assertManager(user);
    const season = await this.access.activeSeason();
    const groups = await this.prisma.trainingGroup.findMany({
      where: {
        seasonId: season.id,
        archivedAt: null,
        ...(user.role === Role.COACH ? { slots: { some: { coaches: { some: { coachId: user.coachId ?? '' } } } } } : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, _count: { select: { members: true } } },
    });
    return groups.map((g) => ({ id: g.id, name: g.name, members: g._count.members }));
  }

  /** Joueurs d'un groupe et état de leur bilan pour la période, avec la moyenne des séances de la période. */
  @Get('group')
  @Roles(Role.COACH, Role.ADMIN)
  async group(@CurrentUser() user: AuthUser, @Query() q: GroupQuery) {
    this.assertManager(user);
    const season = await this.access.activeSeason();
    const group = await this.prisma.trainingGroup.findFirst({
      where: {
        id: q.groupId,
        seasonId: season.id,
        ...(user.role === Role.COACH ? { slots: { some: { coaches: { some: { coachId: user.coachId ?? '' } } } } } : {}),
      },
      include: {
        members: {
          where: { enrollment: { player: { archivedAt: null } } },
          include: { enrollment: { select: { player: { select: { id: true, firstName: true, lastName: true, level: true } } } } },
        },
      },
    });
    if (!group) throw new NotFoundException('Groupe introuvable ou pas le vôtre.');
    const ids = group.members.map((m) => m.enrollment.player.id);
    const range = periodRange(q.period, season.startDate.getUTCFullYear());
    const [evaluations, ratings] = await Promise.all([
      this.prisma.evaluation.findMany({
        where: { seasonId: season.id, period: q.period, playerId: { in: ids } },
        include: { author: { select: { firstName: true, lastName: true } }, levelValidatedBy: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.sessionRating.findMany({ where: { playerId: { in: ids }, date: range } }),
    ]);
    return {
      group: { id: group.id, name: group.name },
      period: q.period,
      players: group.members
        .map((m) => m.enrollment.player)
        .sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr'))
        .map((p) => {
          const own = ratings.filter((r) => r.playerId === p.id).map(ratingAverage);
          const e = evaluations.find((x) => x.playerId === p.id);
          return {
            ...p,
            sessions: own.length,
            sessionsAverage: own.length ? Math.round((own.reduce((t, v) => t + v, 0) / own.length) * 10) / 10 : null,
            evaluation: e ? this.view(e) : null,
          };
        }),
    };
  }

  /**
   * Suivi technique : moyenne des séances par groupe (mois en cours et précédent), assiduité sur 30 jours, et alertes
   * — 3 absences de suite, notes en baisse, engagement faible, douleur signalée (14 derniers jours).
   * Direction : tous les groupes ; entraîneur : ses groupes.
   */
  @Get('overview')
  @Roles(Role.COACH, Role.ADMIN)
  async overview(@CurrentUser() user: AuthUser) {
    this.assertManager(user);
    const season = await this.access.activeSeason();
    const today = todayIso();
    const groups = await this.prisma.trainingGroup.findMany({
      where: {
        seasonId: season.id,
        archivedAt: null,
        ...(user.role === Role.COACH ? { slots: { some: { coaches: { some: { coachId: user.coachId ?? '' } } } } } : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        members: {
          where: { enrollment: { player: { archivedAt: null } } },
          select: { enrollment: { select: { player: { select: { id: true, firstName: true, lastName: true } } } } },
        },
      },
    });
    const groupIds = groups.map((g) => g.id);
    const [ratings, marks, plans] = await Promise.all([
      this.prisma.sessionRating.findMany({ where: { groupId: { in: groupIds } }, orderBy: { date: 'asc' } }),
      this.prisma.attendance.findMany({ where: { groupId: { in: groupIds } }, orderBy: { date: 'asc' }, select: { groupId: true, playerId: true, status: true, date: true } }),
      this.prisma.sessionPlan.findMany({
        where: { groupId: { in: groupIds }, date: { gte: dayFromIso(addDaysIso(today, -30)) } },
        select: { groupId: true, objective: true },
      }),
    ]);
    const month = today.slice(0, 7);
    const prevMonth = (() => {
      const [y, m] = month.split('-').map(Number);
      return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    })();
    const mean = (v: number[]) => (v.length ? Math.round((v.reduce((t, x) => t + x, 0) / v.length) * 10) / 10 : null);
    const since30 = dayFromIso(addDaysIso(today, -30)).getTime();
    const since14 = dayFromIso(addDaysIso(today, -14)).getTime();

    const groupViews = groups.map((g) => {
      const own = ratings.filter((r) => r.groupId === g.id);
      const recentMarks = marks.filter((m) => m.groupId === g.id && m.date.getTime() >= since30);
      const attended = recentMarks.filter((m) => m.status !== AttendanceStatus.ABSENT).length;
      const objectives = [...new Set(plans.filter((p) => p.groupId === g.id).map((p) => p.objective))];
      return {
        id: g.id,
        name: g.name,
        players: g.members.length,
        average: mean(own.filter((r) => isoDay(r.date).startsWith(month)).map(ratingAverage)),
        previous: mean(own.filter((r) => isoDay(r.date).startsWith(prevMonth)).map(ratingAverage)),
        attendanceRate: recentMarks.length ? Math.round((attended / recentMarks.length) * 100) : null,
        objectives: objectives.slice(0, 4),
      };
    });

    type Alert = { playerId: string; name: string; group: string; kind: 'ABSENCES' | 'DROP' | 'EFFORT' | 'PAIN'; label: string; date: string };
    const alerts: Alert[] = [];
    for (const g of groups) {
      for (const { enrollment } of g.members) {
        const p = enrollment.player;
        const name = `${p.firstName} ${p.lastName}`.trim();
        const pm = marks.filter((m) => m.playerId === p.id && m.groupId === g.id);
        const lastThree = pm.slice(-3);
        if (lastThree.length === 3 && lastThree.every((m) => m.status === AttendanceStatus.ABSENT)) {
          alerts.push({ playerId: p.id, name, group: g.name, kind: 'ABSENCES', label: '3 absences de suite', date: isoDay(lastThree[2].date) });
        }
        const pr = ratings.filter((r) => r.playerId === p.id && r.groupId === g.id);
        const pain = [...pr].reverse().find((r) => r.mood === Mood.PAIN && r.date.getTime() >= since14);
        if (pain) alerts.push({ playerId: p.id, name, group: g.name, kind: 'PAIN', label: 'Douleur signalée', date: isoDay(pain.date) });
        const recent = pr.slice(-3).map(ratingAverage);
        const before = pr.slice(-8, -3).map(ratingAverage);
        const r = mean(recent);
        const b = mean(before);
        if (recent.length === 3 && b !== null && r !== null && b - r >= 0.7) {
          alerts.push({ playerId: p.id, name, group: g.name, kind: 'DROP', label: `Notes en baisse (${b} → ${r})`, date: isoDay(pr[pr.length - 1].date) });
        }
        const lastTwo = pr.slice(-2);
        if (lastTwo.length === 2 && lastTwo.every((x) => x.effort <= 2)) {
          alerts.push({ playerId: p.id, name, group: g.name, kind: 'EFFORT', label: 'Engagement faible (2 séances)', date: isoDay(lastTwo[1].date) });
        }
      }
    }
    alerts.sort((a, b) => b.date.localeCompare(a.date));
    return { month, groups: groupViews, alerts };
  }

  /** Bilans d'un joueur : tous pour l'entraîneur et la direction ; partagés seulement pour le joueur et le parent. */
  @Get('player')
  @Roles(Role.COACH, Role.ADMIN, Role.PARENT, Role.PLAYER)
  async player(@CurrentUser() user: AuthUser, @Query() q: PlayerQuery) {
    const season = await this.access.activeSeason();
    let playerId: string;
    if (user.role === Role.COACH || user.role === Role.ADMIN) {
      if (!q.playerId) throw new BadRequestException('Précisez le joueur.');
      if (user.role === Role.ADMIN && !can(user, 'evaluations.manage', 'players.manage')) {
        throw new ForbiddenException('Accès refusé : autorisation « suivi technique » manquante.');
      }
      await this.assertCoachOf(user, q.playerId, season.id);
      playerId = q.playerId;
    } else {
      playerId = await this.access.resolvePlayer(user, q.playerId);
    }
    const family = user.role === Role.PARENT || user.role === Role.PLAYER;
    const [player, rows] = await Promise.all([
      this.prisma.player.findUnique({ where: { id: playerId }, select: { level: true, levelUpdatedAt: true } }),
      this.prisma.evaluation.findMany({
        where: { playerId, ...(family ? { shared: true } : {}) },
        orderBy: [{ createdAt: 'desc' }],
        include: { author: { select: { firstName: true, lastName: true } }, levelValidatedBy: { select: { firstName: true, lastName: true } } },
      }),
    ]);
    return { level: player?.level ?? null, levelUpdatedAt: player?.levelUpdatedAt ?? null, evaluations: rows.map((e) => this.view(e)) };
  }

  private view(e: EvaluationRow) {
    const scores = e.scores as Record<string, number>;
    return {
      id: e.id,
      period: e.period,
      periodLabel: PERIODS.find((p) => p.key === e.period)?.label ?? e.period,
      scores,
      average: scoresAverage(scores),
      strengths: e.strengths,
      toWork: e.toWork,
      goals: e.goals,
      proposedLevel: e.proposedLevel,
      levelValidated: Boolean(e.levelValidatedAt),
      levelValidatedBy: e.levelValidatedBy ? `${e.levelValidatedBy.firstName} ${e.levelValidatedBy.lastName}`.trim() : null,
      shared: e.shared,
      author: `${e.author.firstName} ${e.author.lastName}`.trim(),
      updatedAt: e.updatedAt,
    };
  }

  /** Rédiger ou modifier le bilan d'un joueur pour une période de la saison active. */
  @Put()
  @Roles(Role.COACH, Role.ADMIN)
  async save(@CurrentUser() user: AuthUser, @Body() dto: EvaluationDto) {
    this.assertManager(user);
    const season = await this.access.activeSeason();
    await this.assertCoachOf(user, dto.playerId, season.id);
    const scores: Record<string, number> = {};
    for (const [k, v] of Object.entries(dto.scores ?? {})) {
      if (!CRITERIA_KEYS.includes(k)) throw new BadRequestException(`Critère inconnu : ${k}.`);
      if (v === null || v === undefined) continue;
      if (!Number.isInteger(v) || v < 1 || v > 5) throw new BadRequestException('Chaque note va de 1 à 5.');
      scores[k] = v;
    }
    if (!Object.keys(scores).length) throw new BadRequestException('Notez au moins un critère.');
    const key = { playerId_seasonId_period: { playerId: dto.playerId, seasonId: season.id, period: dto.period } };
    const before = await this.prisma.evaluation.findUnique({ where: key });
    const proposedLevel = dto.proposedLevel?.trim() || null;
    const data = {
      scores,
      strengths: dto.strengths?.trim() || null,
      toWork: dto.toWork?.trim() || null,
      goals: dto.goals?.trim() || null,
      proposedLevel,
      shared: Boolean(dto.shared),
      authorId: user.id,
      // Niveau proposé modifié : il doit être validé à nouveau.
      ...(before && before.proposedLevel !== proposedLevel ? { levelValidatedAt: null, levelValidatedById: null } : {}),
    };
    const saved = await this.prisma.evaluation.upsert({
      where: key,
      create: { playerId: dto.playerId, seasonId: season.id, period: dto.period, ...data },
      update: { ...data, version: { increment: 1 } },
      include: { player: { select: { firstName: true, lastName: true } } },
    });
    const name = `${saved.player.firstName} ${saved.player.lastName}`.trim();
    await this.audit.log(user.id, {
      action: before ? 'Bilan modifié' : 'Bilan rédigé',
      entity: 'Evaluation',
      entityId: saved.id,
      target: `${name} · ${dto.period} ${season.label}`,
      before: before ? `${scoresAverage(before.scores as Record<string, number>)}/5` : undefined,
      after: `${scoresAverage(scores)}/5${proposedLevel ? ` · niveau proposé ${proposedLevel}` : ''}${data.shared ? ' · partagé' : ''}`,
    });
    if (data.shared && !before?.shared) await this.notifyFamily(dto.playerId, `Bilan de ${name} disponible`, `Le bilan ${dto.period} de ${name} est disponible dans Suivi et progression.`);
    return { id: saved.id, average: scoresAverage(scores) };
  }

  /** Valider le niveau proposé (direction technique) : il devient le niveau du joueur. */
  @Post(':id/validate-level')
  @Roles(Role.ADMIN)
  async validateLevel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    if (!can(user, 'evaluations.manage')) throw new ForbiddenException('Accès refusé : autorisation « suivi technique » manquante.');
    const e = await this.prisma.evaluation.findUnique({ where: { id }, include: { player: { select: { firstName: true, lastName: true, level: true } } } });
    if (!e) throw new NotFoundException('Bilan introuvable.');
    if (!e.proposedLevel) throw new BadRequestException('Aucun niveau proposé dans ce bilan.');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.evaluation.update({ where: { id }, data: { levelValidatedAt: now, levelValidatedById: user.id } }),
      this.prisma.player.update({ where: { id: e.playerId }, data: { level: e.proposedLevel, levelUpdatedAt: now } }),
    ]);
    const name = `${e.player.firstName} ${e.player.lastName}`.trim();
    await this.audit.log(user.id, {
      action: 'Niveau validé',
      entity: 'Player',
      entityId: e.playerId,
      target: name,
      before: e.player.level ?? '—',
      after: e.proposedLevel,
    });
    if (e.shared) await this.notifyFamily(e.playerId, `${name} : nouveau niveau`, `${name} passe au niveau ${e.proposedLevel}. Bravo !`);
    return { level: e.proposedLevel };
  }

  /** Notification aux parents actifs (et au joueur s'il a un compte). */
  private async notifyFamily(playerId: string, title: string, body: string) {
    const [links, player] = await Promise.all([
      this.prisma.parentLink.findMany({ where: { playerId, parent: { isActive: true } }, select: { parentId: true } }),
      this.prisma.player.findUnique({ where: { id: playerId }, select: { userId: true } }),
    ]);
    const ids = [...new Set([...links.map((l) => l.parentId), ...(player?.userId ? [player.userId] : [])])];
    if (ids.length) await this.prisma.notification.createMany({ data: ids.map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link: '/suivi' })) });
  }
}
