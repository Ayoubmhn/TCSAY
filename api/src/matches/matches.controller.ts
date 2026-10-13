import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailKind, MatchStatus, PointKind, Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, can, CurrentUser, Roles } from '../auth/auth-user';
import { dayFromIso, isoDay } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { computeMatch, matchStats, MatchFormat, PointInput, scoreLine, Side } from './score-engine';

const KINDS = ['INTERNAL', 'FRIENDLY', 'TOURNAMENT'] as const;
export const MATCH_KIND_LABEL: Record<(typeof KINDS)[number], string> = { INTERNAL: 'Match interne', FRIENDLY: 'Match amical', TOURNAMENT: 'Tournoi' };
const SHOTS = ['Coup droit', 'Revers', 'Service', 'Retour', 'Volée', 'Smash', 'Amorti', 'Lob', 'Passing'];

class CreateMatchDto {
  @IsIn(KINDS)
  kind: (typeof KINDS)[number];

  @IsOptional() @IsString() @MaxLength(80) title?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @IsOptional() @IsString() @MaxLength(40) court?: string;

  @IsOptional() @IsUUID() playerAId?: string;
  @ValidateIf((o: CreateMatchDto) => !o.playerAId) @IsString() @IsNotEmpty({ message: 'Joueur A obligatoire.' }) @MaxLength(80) playerAName?: string;
  @IsOptional() @IsUUID() playerBId?: string;
  @ValidateIf((o: CreateMatchDto) => !o.playerBId) @IsString() @IsNotEmpty({ message: 'Joueur B obligatoire.' }) @MaxLength(80) playerBName?: string;

  @Type(() => Number) @IsIn([2, 3]) setsToWin: number;
  @Type(() => Number) @IsIn([4, 6]) games: number;
  @IsBoolean() tiebreak: boolean;
  @IsBoolean() superTB: boolean;
  @IsBoolean() noAd: boolean;
}

class StartDto {
  @Type(() => Number)
  @IsIn([0, 1], { message: 'Choisissez qui sert en premier.' })
  firstServer: Side;
}

class PointDto {
  @Type(() => Number) @IsIn([0, 1]) winner: Side;
  @IsBoolean() firstIn: boolean;
  @IsOptional() @IsEnum(PointKind) kind?: PointKind;
  @IsOptional() @IsIn(SHOTS) shot?: string;
}

class ReasonDto {
  @IsString()
  @IsNotEmpty({ message: 'Motif obligatoire.' })
  @MaxLength(200)
  reason: string;
}

class ListQuery {
  @IsOptional() @IsEnum(MatchStatus) status?: MatchStatus;
  @IsOptional() @IsUUID() playerId?: string;
}

class PlayerQuery {
  @IsOptional() @IsUUID() playerId?: string;
}

type MatchRow = Prisma.MatchGetPayload<{ include: { points: true; createdBy: { select: { firstName: true; lastName: true } } } }>;

const formatOf = (m: { setsToWin: number; games: number; tiebreak: boolean; superTB: boolean; noAd: boolean }): MatchFormat => ({
  setsToWin: m.setsToWin,
  games: m.games,
  tiebreak: m.tiebreak,
  superTB: m.superTB,
  noAd: m.noAd,
});
const inputsOf = (m: MatchRow): PointInput[] =>
  [...m.points].sort((a, b) => a.seq - b.seq).map((p) => ({ winner: p.winner as Side, firstIn: p.firstIn, kind: p.kind, shot: p.shot }));

/** Une partie se rejoue après 30 minutes : au-delà, seule la direction corrige un match terminé. */
const UNDO_AFTER_END_MIN = 30;

/**
 * Matchs suivis point par point : tous les acteurs du club consultent (liste, score en direct, statistiques) ;
 * l'entraîneur (de l'un des joueurs) et la direction (« matches.manage ») créent les matchs et saisissent les points.
 * Le score et les statistiques sont recalculés depuis les points (moteur score-engine).
 */
@ApiTags('Matchs')
@ApiBearerAuth()
@Controller('matches')
export class MatchesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** L'entraîneur gère les matchs de ses joueurs (saison active) ou ceux qu'il a créés ; la direction avec « matches.manage ». */
  private async assertScorer(user: AuthUser, m: { createdById: string; playerAId: string | null; playerBId: string | null }) {
    if (user.role === Role.ADMIN) {
      if (!can(user, 'matches.manage')) throw new ForbiddenException('Accès refusé : autorisation « matchs » manquante.');
      return;
    }
    if (user.role !== Role.COACH) throw new ForbiddenException('Saisie réservée à l’entraîneur et à la direction.');
    if (m.createdById === user.id) return;
    if (!(await this.coachesOne(user, [m.playerAId, m.playerBId]))) throw new ForbiddenException('Ce match ne concerne pas vos joueurs.');
  }

  private async coachesOne(user: AuthUser, ids: (string | null)[]) {
    const players = ids.filter((x): x is string => Boolean(x));
    if (!players.length || !user.coachId) return false;
    const season = await this.access.activeSeason();
    const n = await this.prisma.groupMember.count({
      where: {
        enrollment: { playerId: { in: players }, seasonId: season.id },
        group: { archivedAt: null, slots: { some: { coaches: { some: { coachId: user.coachId } } } } },
      },
    });
    return n > 0;
  }

  private async load(id: string): Promise<MatchRow> {
    const m = await this.prisma.match.findUnique({
      where: { id },
      include: { points: true, createdBy: { select: { firstName: true, lastName: true } } },
    });
    if (!m) throw new NotFoundException('Match introuvable.');
    return m;
  }

  private summary(m: MatchRow | Prisma.MatchGetPayload<{ include: { points: true } }>) {
    const state = m.firstServer === null ? null : computeMatch(formatOf(m), m.firstServer as Side, inputsOf(m as MatchRow));
    return {
      id: m.id,
      kind: m.kind,
      kindLabel: MATCH_KIND_LABEL[m.kind as keyof typeof MATCH_KIND_LABEL] ?? m.kind,
      title: m.title,
      date: isoDay(m.date),
      court: m.court,
      playerA: { id: m.playerAId, name: m.playerAName },
      playerB: { id: m.playerBId, name: m.playerBName },
      format: formatOf(m),
      status: m.status,
      winner: m.winner,
      score: m.status === MatchStatus.LIVE && state ? scoreLine(state) : m.score,
      live: m.status === MatchStatus.LIVE && state ? { point: state.point, server: state.server, tiebreak: state.tiebreak } : null,
      endReason: m.endReason,
    };
  }

  /** Joueurs du club sélectionnables pour un match : entraîneur = ses groupes ; direction = joueurs inscrits cette saison. */
  @Get('players')
  @Roles(Role.ADMIN, Role.COACH)
  async players(@CurrentUser() user: AuthUser) {
    if (user.role === Role.ADMIN && !can(user, 'matches.manage')) throw new ForbiddenException('Accès refusé : autorisation « matchs » manquante.');
    const season = await this.access.activeSeason();
    const rows = await this.prisma.player.findMany({
      where: {
        archivedAt: null,
        enrollments: {
          some: {
            seasonId: season.id,
            ...(user.role === Role.COACH
              ? { groups: { some: { group: { archivedAt: null, slots: { some: { coaches: { some: { coachId: user.coachId ?? '' } } } } } } } }
              : {}),
          },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    });
    return rows.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim() }));
  }

  /** Liste : en cours, à venir et terminés (90 derniers jours), ou les matchs d'un joueur. Tous les acteurs. */
  @Get()
  @Roles(Role.ADMIN, Role.COACH, Role.PARENT, Role.PLAYER)
  async list(@Query() q: ListQuery) {
    const since = new Date(Date.now() - 90 * 86_400_000);
    const rows = await this.prisma.match.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.playerId ? { OR: [{ playerAId: q.playerId }, { playerBId: q.playerId }] } : { OR: [{ status: { in: [MatchStatus.LIVE, MatchStatus.SCHEDULED] } }, { date: { gte: since } }] }),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: { points: true },
    });
    return rows.map((m) => this.summary(m));
  }

  /** Détail : score courant, sets, statistiques (match et par set), points annotés (point par point). */
  @Get(':id')
  @Roles(Role.ADMIN, Role.COACH, Role.PARENT, Role.PLAYER)
  async detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const m = await this.load(id);
    const state = m.firstServer === null ? null : computeMatch(formatOf(m), m.firstServer as Side, inputsOf(m));
    let canScore = false;
    try {
      await this.assertScorer(user, m);
      canScore = true;
    } catch {
      canScore = false;
    }
    const setsPlayed = state ? [...new Set(state.points.map((p) => p.set))] : [];
    return {
      ...this.summary(m),
      scorer: `${m.createdBy.firstName} ${m.createdBy.lastName}`.trim(),
      canScore,
      state: state && {
        sets: state.sets,
        setsWon: state.setsWon,
        point: state.point,
        server: state.server,
        tiebreak: state.tiebreak,
        breakPoint: state.breakPoint,
        decisivePoint: state.decisivePoint,
      },
      stats: state ? { all: matchStats(state.points), sets: setsPlayed.map((s) => ({ set: s, stats: matchStats(state.points, s) })) } : null,
      points: state?.points ?? [],
    };
  }

  @Post()
  @Roles(Role.ADMIN, Role.COACH)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateMatchDto) {
    if (!dto.playerAId && !dto.playerBId) throw new BadRequestException('Au moins un joueur du club.');
    if (dto.playerAId && dto.playerAId === dto.playerBId) throw new BadRequestException('Deux joueurs différents.');
    const ids = [dto.playerAId, dto.playerBId].filter((x): x is string => Boolean(x));
    const players = await this.prisma.player.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true, firstName: true, lastName: true } });
    if (players.length !== ids.length) throw new NotFoundException('Joueur introuvable.');
    const nameOf = (id?: string, fallback?: string) => {
      const p = players.find((x) => x.id === id);
      return p ? `${p.firstName} ${p.lastName}`.trim() : (fallback ?? '').trim();
    };
    await this.assertScorer(user, { createdById: '', playerAId: dto.playerAId ?? null, playerBId: dto.playerBId ?? null });
    if (dto.superTB && !dto.tiebreak) dto.tiebreak = true;
    const m = await this.prisma.match.create({
      data: {
        kind: dto.kind,
        title: dto.title?.trim() || null,
        date: dayFromIso(dto.date),
        court: dto.court?.trim() || null,
        playerAId: dto.playerAId ?? null,
        playerAName: nameOf(dto.playerAId, dto.playerAName),
        playerBId: dto.playerBId ?? null,
        playerBName: nameOf(dto.playerBId, dto.playerBName),
        setsToWin: dto.setsToWin,
        games: dto.games,
        tiebreak: dto.tiebreak,
        superTB: dto.superTB,
        noAd: dto.noAd,
        createdById: user.id,
      },
    });
    await this.audit.log(user.id, { action: 'Match créé', entity: 'Match', entityId: m.id, target: `${m.playerAName} – ${m.playerBName}`, after: `${MATCH_KIND_LABEL[dto.kind]} · ${dto.date}` });
    return { id: m.id };
  }

  /** Lancer le match : qui sert en premier ; notification aux familles des joueurs du club. */
  @Post(':id/start')
  @Roles(Role.ADMIN, Role.COACH)
  async start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartDto) {
    const m = await this.load(id);
    await this.assertScorer(user, m);
    if (m.status !== MatchStatus.SCHEDULED) throw new BadRequestException('Match déjà lancé.');
    await this.prisma.match.update({ where: { id }, data: { firstServer: dto.firstServer, status: MatchStatus.LIVE, startedAt: new Date() } });
    await this.notify(m, `Match en cours : ${m.playerAName} – ${m.playerBName}`, 'Suivez le score en direct dans Matchs.');
    return { ok: true };
  }

  /** Saisir un point (dans l'ordre) ; le match se termine tout seul au dernier point. */
  @Post(':id/points')
  @Roles(Role.ADMIN, Role.COACH)
  async point(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PointDto) {
    const m = await this.load(id);
    await this.assertScorer(user, m);
    if (m.status !== MatchStatus.LIVE || m.firstServer === null) throw new BadRequestException('Le match n’est pas en cours.');
    const kind = dto.kind ?? PointKind.NONE;
    const before = computeMatch(formatOf(m), m.firstServer as Side, inputsOf(m));
    if (kind === PointKind.ACE && dto.winner !== before.server) throw new BadRequestException('Un ace est gagné par le serveur.');
    if (kind === PointKind.DF && (dto.winner === before.server || dto.firstIn)) throw new BadRequestException('Une double faute est perdue par le serveur, sur 2e balle.');
    const seq = m.points.length;
    await this.prisma.matchPoint.create({
      data: { matchId: id, seq, winner: dto.winner, firstIn: dto.firstIn, kind, shot: dto.shot ?? null, createdById: user.id },
    });
    const state = computeMatch(formatOf(m), m.firstServer as Side, [...inputsOf(m), { winner: dto.winner, firstIn: dto.firstIn, kind, shot: dto.shot }]);
    if (state.winner !== null) await this.finish(user, m, state.winner, scoreLine(state), matchStats(state.points));
    return { finished: state.winner !== null, score: scoreLine(state) };
  }

  private async finish(user: AuthUser, m: MatchRow, winner: Side, score: string, stats: unknown) {
    await this.prisma.match.update({
      where: { id: m.id },
      data: { status: MatchStatus.FINISHED, winner, score, stats: stats as Prisma.InputJsonValue, finishedAt: new Date(), version: { increment: 1 } },
    });
    const name = winner === 0 ? m.playerAName : m.playerBName;
    await this.audit.log(user.id, { action: 'Match terminé', entity: 'Match', entityId: m.id, target: `${m.playerAName} – ${m.playerBName}`, after: `${name} gagne ${score}` });
    await this.notify(m, `Match terminé : ${name} gagne ${score}`, `${m.playerAName} – ${m.playerBName}. Statistiques dans Matchs.`);
  }

  /** Annuler le dernier point (erreur de saisie). Match terminé : seulement dans les 30 minutes, sinon la direction. */
  @Delete(':id/points/last')
  @Roles(Role.ADMIN, Role.COACH)
  async undo(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const m = await this.load(id);
    await this.assertScorer(user, m);
    if (!m.points.length) throw new BadRequestException('Aucun point à annuler.');
    if (m.status === MatchStatus.ABANDONED || m.status === MatchStatus.SCHEDULED) throw new BadRequestException('Match non en cours.');
    if (m.status === MatchStatus.FINISHED) {
      const late = !m.finishedAt || Date.now() - m.finishedAt.getTime() > UNDO_AFTER_END_MIN * 60_000;
      if (late && user.role !== Role.ADMIN) throw new BadRequestException('Match terminé depuis plus de 30 minutes : correction par la direction.');
    }
    const last = m.points.reduce((a, b) => (a.seq > b.seq ? a : b));
    await this.prisma.$transaction([
      this.prisma.matchPoint.delete({ where: { id: last.id } }),
      ...(m.status === MatchStatus.FINISHED
        ? [this.prisma.match.update({ where: { id }, data: { status: MatchStatus.LIVE, winner: null, score: null, stats: Prisma.DbNull, finishedAt: null } })]
        : []),
    ]);
    if (m.status === MatchStatus.FINISHED) {
      await this.audit.log(user.id, { action: 'Match rouvert (point annulé)', entity: 'Match', entityId: id, target: `${m.playerAName} – ${m.playerBName}`, before: m.score ?? undefined });
    }
    return { ok: true };
  }

  /** Abandon ou annulation (motif obligatoire) ; le score atteint est conservé. */
  @Post(':id/abandon')
  @Roles(Role.ADMIN, Role.COACH)
  async abandon(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    const m = await this.load(id);
    await this.assertScorer(user, m);
    if (m.status === MatchStatus.FINISHED || m.status === MatchStatus.ABANDONED) throw new BadRequestException('Match déjà terminé.');
    const state = m.firstServer === null ? null : computeMatch(formatOf(m), m.firstServer as Side, inputsOf(m));
    await this.prisma.match.update({
      where: { id },
      data: {
        status: MatchStatus.ABANDONED,
        endReason: dto.reason.trim(),
        score: state ? scoreLine(state) || null : null,
        stats: state ? (matchStats(state.points) as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        finishedAt: new Date(),
      },
    });
    await this.audit.log(user.id, { action: m.status === MatchStatus.SCHEDULED ? 'Match annulé' : 'Match abandonné', entity: 'Match', entityId: id, target: `${m.playerAName} – ${m.playerBName}`, reason: dto.reason });
    return { ok: true };
  }

  /** Bilan des matchs d'un joueur (saison) : victoires, défaites, statistiques cumulées. Famille, entraîneur, direction. */
  @Get('player/summary')
  @Roles(Role.ADMIN, Role.COACH, Role.PARENT, Role.PLAYER)
  async playerSummary(@CurrentUser() user: AuthUser, @Query() q: PlayerQuery) {
    const playerId = user.role === Role.PARENT || user.role === Role.PLAYER ? await this.access.resolvePlayer(user, q.playerId) : q.playerId;
    if (!playerId) throw new BadRequestException('Précisez le joueur.');
    const season = await this.access.activeSeason();
    const rows = await this.prisma.match.findMany({
      where: {
        status: MatchStatus.FINISHED,
        date: { gte: season.startDate },
        OR: [{ playerAId: playerId }, { playerBId: playerId }],
      },
      orderBy: { date: 'desc' },
      include: { points: true },
    });
    const totals = { aces: 0, doubleFaults: 0, firstIn: [0, 0], firstWon: [0, 0], secondWon: [0, 0], bpSaved: [0, 0], bpWon: [0, 0], winners: 0, unforced: 0 };
    let wins = 0;
    const add = (t: number[], r: [number, number]) => {
      t[0] += r[0];
      t[1] += r[1];
    };
    for (const m of rows) {
      const side: Side = m.playerAId === playerId ? 0 : 1;
      if (m.winner === side) wins++;
      const state = computeMatch(formatOf(m), (m.firstServer ?? 0) as Side, inputsOf(m as MatchRow));
      const s = matchStats(state.points)[side];
      totals.aces += s.aces;
      totals.doubleFaults += s.doubleFaults;
      add(totals.firstIn, s.firstServeIn);
      add(totals.firstWon, s.firstServeWon);
      add(totals.secondWon, s.secondServeWon);
      add(totals.bpSaved, s.breakPointsSaved);
      add(totals.bpWon, s.breakPointsWon);
      totals.winners += s.winners;
      totals.unforced += s.unforcedErrors;
    }
    return {
      played: rows.length,
      wins,
      losses: rows.length - wins,
      totals,
      recent: rows.slice(0, 5).map((m) => ({
        id: m.id,
        date: isoDay(m.date),
        opponent: m.playerAId === playerId ? m.playerBName : m.playerAName,
        won: m.winner === (m.playerAId === playerId ? 0 : 1),
        score: m.score,
        kind: MATCH_KIND_LABEL[m.kind as keyof typeof MATCH_KIND_LABEL] ?? m.kind,
      })),
    };
  }

  /** Notification aux parents (et aux joueurs avec compte) des joueurs du club du match. */
  private async notify(m: { id: string; playerAId: string | null; playerBId: string | null }, title: string, body: string) {
    const ids = [m.playerAId, m.playerBId].filter((x): x is string => Boolean(x));
    if (!ids.length) return;
    const [links, players] = await Promise.all([
      this.prisma.parentLink.findMany({ where: { playerId: { in: ids }, parent: { isActive: true } }, select: { parentId: true } }),
      this.prisma.player.findMany({ where: { id: { in: ids }, userId: { not: null } }, select: { userId: true } }),
    ]);
    const users = [...new Set([...links.map((l) => l.parentId), ...players.map((p) => p.userId!)])];
    if (users.length) {
      await this.prisma.notification.createMany({ data: users.map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link: `/matchs/${m.id}` })) });
    }
  }
}
