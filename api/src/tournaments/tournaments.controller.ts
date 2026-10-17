import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MatchStatus, Prisma, Role, TournamentFormat, TournamentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, can, CurrentUser, Perm, Roles } from '../auth/auth-user';
import { dayFromIso, isoDay } from '../common/dates';
import { num } from '../common/money';
import { assertVersion, fullName } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';
import { Eligibility, roundLabel, TBD, TournamentsService } from './tournaments.service';

/** « 2026-10-24 » → « samedi 24 octobre ». */
const frDate = (iso: string) => dayFromIso(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['INTERNAL', 'OPEN', 'CHAMPIONSHIP', 'INTERCLUB'] as const;
const KIND_LABEL: Record<(typeof KINDS)[number], string> = { INTERNAL: 'Tournoi interne', OPEN: 'Open', CHAMPIONSHIP: 'Championnat', INTERCLUB: 'Rencontre inter-clubs' };

class EligibilityDto {
  @IsIn(['cats', 'age', 'open']) mode: 'cats' | 'age' | 'open';
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) categoryIds?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1950) @Max(2030) fromYear?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1950) @Max(2030) toYear?: number;
  @IsOptional() @IsIn(['M', 'F', null]) gender?: 'M' | 'F' | null;
}

class TournamentDto {
  @IsString() @IsNotEmpty({ message: 'Nom du tournoi obligatoire.' }) @MaxLength(100) name: string;
  @IsIn(KINDS) kind: (typeof KINDS)[number];
  @Matches(DATE, { message: 'Date de début obligatoire.' }) startDate: string;
  @Matches(DATE, { message: 'Date de fin obligatoire.' }) endDate: string;
  @ValidateNested() @Type(() => EligibilityDto) eligibility: EligibilityDto;
  @IsIn([TournamentFormat.KNOCKOUT, TournamentFormat.ROUND_ROBIN]) format: TournamentFormat;
  @Type(() => Number) @IsInt() @Min(2) @Max(64) maxPlayers: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) fee?: number | null;
  @IsBoolean() familyRequest: boolean;
  @Type(() => Number) @IsIn([1, 2, 3]) setsToWin: number;
  @Type(() => Number) @IsIn([4, 6]) games: number;
  @IsBoolean() tiebreak: boolean;
  @IsBoolean() superTB: boolean;
  @IsBoolean() noAd: boolean;
  @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) courtIds: string[];
  @Matches(/^\d{2}:\d{2}$/) dayStart: string;
  @Matches(/^\d{2}:\d{2}$/) dayEnd: string;
  @Type(() => Number) @IsInt() @Min(30) @Max(240) matchMinutes: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(240) restMinutes: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  /** Résultats visibles de tous (sinon : joueurs concernés, leurs parents, la direction). */
  @IsOptional() @IsBoolean() resultsPublic?: boolean;
  /** Score en direct (sinon : résultat à la fin du match). */
  @IsOptional() @IsBoolean() liveScoring?: boolean;
  /** Arbitre proposé pour tous les matchs : compte du club, ou nom d'une personne hors club. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() refereeUserId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(80) refereeName?: string | null;
}

class RefereeDto {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() userId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(80) name?: string | null;
}

class PaymentDto {
  @IsBoolean() paid: boolean;
}

class PublishDto {
  @IsBoolean() published: boolean;
}

class CandidatesQuery {
  @IsOptional() @IsString() @MaxLength(60) q?: string;
}

class UpdateDto extends TournamentDto {
  @IsInt() @Min(1) version: number;
}

class EntryDto {
  @ValidateIf((o: EntryDto) => !o.name) @IsUUID() playerId?: string;
  /** Joueur extérieur (nom, club). */
  @ValidateIf((o: EntryDto) => !o.playerId) @IsString() @IsNotEmpty({ message: 'Nom du joueur obligatoire.' }) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(300) derogationReason?: string;
}

class SeedDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(64) seed?: number | null;
}

class RequestDto {
  @IsOptional() @IsUUID() playerId?: string;
}

class ResultDto {
  @Type(() => Number) @IsIn([0, 1], { message: 'Choisissez le vainqueur.' }) winner: 0 | 1;
  /** Score saisi (ex. « 6-3 4-6 10-7 ») ; vide = victoire par forfait. */
  @IsOptional() @IsString() @MaxLength(60) score?: string;
}

class ConflictDto {
  @IsUUID() slotId: string;
  @Matches(DATE) date: string;
  @IsIn(['move', 'postpone']) action: 'move' | 'postpone';
  @IsOptional() @IsUUID() courtId?: string;
}

class HistoryQuery {
  @IsOptional() @IsUUID() playerId?: string;
}

/**
 * Tournois : tout le monde consulte (liste, tableau, résultats) ; la direction technique (« tournaments.manage ») crée,
 * inscrit, tire au sort, planifie les terrains, règle les conflits avec les entraînements et saisit les résultats.
 * Les familles peuvent demander une inscription si le tournoi l'autorise.
 */
@ApiTags('Tournois')
@ApiBearerAuth()
@Controller('tournaments')
export class TournamentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tournaments: TournamentsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  private manager(user: AuthUser) {
    return user.role === Role.ADMIN && can(user, 'tournaments.manage');
  }

  private view(t: Prisma.TournamentGetPayload<object>, extra: Record<string, unknown> = {}) {
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      kindLabel: KIND_LABEL[t.kind as (typeof KINDS)[number]] ?? t.kind,
      startDate: isoDay(t.startDate),
      endDate: isoDay(t.endDate),
      eligibility: t.eligibility as Eligibility,
      format: t.format,
      maxPlayers: t.maxPlayers,
      fee: t.fee === null ? null : num(t.fee),
      familyRequest: t.familyRequest,
      setsToWin: t.setsToWin,
      games: t.games,
      tiebreak: t.tiebreak,
      superTB: t.superTB,
      noAd: t.noAd,
      courtIds: t.courtIds,
      dayStart: t.dayStart,
      dayEnd: t.dayEnd,
      matchMinutes: t.matchMinutes,
      restMinutes: t.restMinutes,
      status: t.status,
      winnerName: t.winnerName,
      notes: t.notes,
      resultsPublic: t.resultsPublic,
      liveScoring: t.liveScoring,
      drawPublished: t.drawPublished,
      referee: t.refereeUserId || t.refereeName ? { userId: t.refereeUserId, name: t.refereeName } : null,
      version: t.version,
      ...extra,
    };
  }

  /** Critères lisibles (« Benjamins, Minimes · garçons »). */
  private async eligibilityLabel(e: Eligibility) {
    const gender = e.gender === 'M' ? ' · garçons' : e.gender === 'F' ? ' · filles' : '';
    if (e.mode === 'cats' && e.categoryIds?.length) {
      const cats = await this.prisma.category.findMany({ where: { id: { in: e.categoryIds } }, select: { name: true } });
      return cats.map((c) => c.name).join(', ') + gender;
    }
    if (e.mode === 'age') return `Nés de ${e.fromYear ?? '…'} à ${e.toYear ?? '…'}${gender}`;
    return `Ouvert à tous${gender}`;
  }

  @Get()
  @Roles(Role.ADMIN, Role.COACH, Role.PARENT, Role.PLAYER)
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.tournament.findMany({
      where: this.manager(user) ? { status: { not: TournamentStatus.CANCELLED } } : { status: { notIn: [TournamentStatus.DRAFT, TournamentStatus.CANCELLED] } },
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { entries: { where: { status: 'CONFIRMED' } } } } },
    });
    const out = [];
    for (const t of rows) out.push(this.view(t, { entries: t._count.entries, eligibilityLabel: await this.eligibilityLabel(t.eligibility as Eligibility) }));
    return { canManage: this.manager(user), tournaments: out };
  }

  /** Historique des tournois d'un joueur (joueur, parent : ses enfants ; direction : tout joueur). */
  @Get('history')
  @Roles(Role.ADMIN, Role.PARENT, Role.PLAYER)
  async history(@CurrentUser() user: AuthUser, @Query() q: HistoryQuery) {
    const playerId = await this.access.resolvePlayer(user, q.playerId);
    return this.tournaments.history(playerId);
  }

  /** Arbitres possibles : tous les comptes actifs du club (joueur, parent, entraîneur, personnel), recherche par nom. */
  @Get('referee-candidates')
  @Perm('tournaments.manage')
  async candidates(@Query() q: CandidatesQuery) {
    const words = (q.q ?? '').trim().split(/\s+/).filter(Boolean);
    const rows = await this.prisma.user.findMany({
      where: {
        isActive: true,
        roles: { isEmpty: false },
        AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }] })),
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 30,
      select: { id: true, firstName: true, lastName: true, roles: true },
    });
    const ROLE: Record<string, string> = { PRESIDENT: 'Président', ADMIN_AGENT: 'Agent', SUPERVISOR: 'Superviseur', TECH_DIRECTOR: 'Directeur technique', COACH: 'Entraîneur', PARENT: 'Parent', PLAYER: 'Joueur' };
    return rows.map((u) => ({ id: u.id, name: fullName(u).trim(), roles: u.roles.map((r) => ROLE[r] ?? r).join(', ') }));
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.COACH, Role.PARENT, Role.PLAYER)
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const t = await this.tournaments.find(id);
    const manage = this.manager(user);
    if (t.status === TournamentStatus.DRAFT && !manage) throw new NotFoundException('Tournoi introuvable.');
    const [entries, matches, courts] = await Promise.all([
      this.prisma.tournamentEntry.findMany({
        where: { tournamentId: id, ...(manage ? {} : { status: 'CONFIRMED' }) },
        include: { player: { select: { firstName: true, lastName: true, memberCode: true, level: true, enrollments: { where: { season: { status: 'ACTIVE' } }, select: { category: { select: { name: true } } } } } } },
        orderBy: [{ seed: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.match.findMany({ where: { tournamentId: id }, orderBy: [{ round: 'asc' }, { position: 'asc' }] }),
      this.prisma.court.findMany({ where: { id: { in: t.courtIds } }, select: { id: true, name: true } }),
    ]);
    const rounds = matches.reduce((r, m) => Math.max(r, m.round ?? 1), 1);
    const own = user.role === Role.PARENT || user.role === Role.PLAYER ? await this.access.ownPlayerIds(user) : [];
    // Tableau pas encore publié : visible de la direction seulement.
    const drawHidden = !t.drawPublished && !manage;
    const mine = (m: { playerAId: string | null; playerBId: string | null }) => Boolean((m.playerAId && own.includes(m.playerAId)) || (m.playerBId && own.includes(m.playerBId)));
    const shown = (m: (typeof matches)[number]) => this.tournaments.visibility(t, m, { manage, user, own });
    return this.view(t, {
      canManage: manage,
      eligibilityLabel: await this.eligibilityLabel(t.eligibility as Eligibility),
      courts,
      entries: entries.map((e) => ({
        id: e.id,
        playerId: e.playerId,
        name: e.name,
        seed: e.seed,
        status: e.status,
        derogationReason: manage ? e.derogationReason : null,
        code: e.player?.memberCode ?? null,
        // Feuille imprimée (Nom, Prénom, Club) : joueur du club, sinon nom saisi.
        firstName: e.player?.firstName ?? null,
        lastName: e.player?.lastName ?? null,
        club: e.playerId ? 'TCSAY' : null,
        level: e.player?.level ?? null,
        category: e.player?.enrollments[0]?.category.name ?? null,
        mine: Boolean(e.playerId && own.includes(e.playerId)),
        paid: manage || (e.playerId && own.includes(e.playerId)) ? Boolean(e.paidAt) : undefined,
        paidAt: manage || (e.playerId && own.includes(e.playerId)) ? e.paidAt : null,
      })),
      drawHidden,
      rounds,
      matches: drawHidden
        ? []
        : matches.map((m) => {
            const v = shown(m);
            return {
              id: m.id,
              round: m.round,
              position: m.position,
              roundLabel: roundLabel(t.format, m.round ?? 1, rounds),
              playerA: { id: m.playerAId, name: m.playerAName },
              playerB: { id: m.playerBId, name: m.playerBName },
              status: m.status,
              winner: v.result ? m.winner : null,
              score: v.result && (m.status !== MatchStatus.LIVE || v.live) ? m.score : null,
              resultHidden: !v.result,
              court: m.court,
              scheduledAt: m.scheduledAt,
              ready: !m.playerAName.startsWith(TBD) && !m.playerBName.startsWith(TBD),
              referee: m.refereeUserId || m.refereeName ? { userId: m.refereeUserId, name: m.refereeName } : null,
              mine: mine(m),
            };
          }),
      standings:
        t.format === TournamentFormat.ROUND_ROBIN && t.status !== TournamentStatus.REGISTRATION && !drawHidden && (t.resultsPublic || manage)
          ? await this.tournaments.standings(id)
          : [],
      winnerName: t.resultsPublic || manage ? t.winnerName : null,
      myPlayers: own,
    });
  }

  private async validate(dto: TournamentDto) {
    if (dto.endDate < dto.startDate) throw new BadRequestException('La date de fin suit la date de début.');
    if (dto.dayEnd <= dto.dayStart) throw new BadRequestException('L’heure de fin de journée suit l’heure de début.');
    if (dto.eligibility.mode === 'cats' && !dto.eligibility.categoryIds?.length) throw new BadRequestException('Choisissez au moins une catégorie.');
    const courts = await this.prisma.court.count({ where: { id: { in: dto.courtIds }, active: true } });
    if (courts !== dto.courtIds.length || !courts) throw new BadRequestException('Choisissez des terrains actifs.');
  }

  private data(dto: TournamentDto) {
    return {
      name: dto.name.trim(),
      kind: dto.kind,
      startDate: dayFromIso(dto.startDate),
      endDate: dayFromIso(dto.endDate),
      eligibility: { mode: dto.eligibility.mode, categoryIds: dto.eligibility.categoryIds ?? [], fromYear: dto.eligibility.fromYear ?? null, toYear: dto.eligibility.toYear ?? null, gender: dto.eligibility.gender ?? null } as Prisma.InputJsonValue,
      format: dto.format,
      maxPlayers: dto.maxPlayers,
      fee: dto.fee ?? null,
      familyRequest: dto.familyRequest,
      setsToWin: dto.setsToWin,
      games: dto.games,
      tiebreak: dto.tiebreak || dto.superTB,
      superTB: dto.superTB,
      noAd: dto.noAd,
      courtIds: dto.courtIds,
      dayStart: dto.dayStart,
      dayEnd: dto.dayEnd,
      matchMinutes: dto.matchMinutes,
      restMinutes: dto.restMinutes,
      notes: dto.notes?.trim() || null,
      resultsPublic: dto.resultsPublic ?? true,
      liveScoring: dto.liveScoring ?? true,
    };
  }

  /** Arbitre : compte du club (nom repris de la fiche) ou nom libre (hors club) ; null = aucun. */
  private async referee(userId?: string | null, name?: string | null): Promise<{ refereeUserId: string | null; refereeName: string | null }> {
    if (userId) {
      const u = await this.prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true, firstName: true, lastName: true } });
      if (!u) throw new BadRequestException('Arbitre introuvable ou désactivé.');
      return { refereeUserId: u.id, refereeName: fullName(u).trim() };
    }
    return { refereeUserId: null, refereeName: name?.trim() || null };
  }

  @Post()
  @Perm('tournaments.manage')
  async create(@CurrentUser() actor: AuthUser, @Body() dto: TournamentDto) {
    await this.validate(dto);
    const t = await this.prisma.tournament.create({
      data: { ...this.data(dto), ...(await this.referee(dto.refereeUserId, dto.refereeName)), status: TournamentStatus.REGISTRATION, createdById: actor.id },
    });
    await this.audit.log(actor.id, { action: 'Tournoi créé', entity: 'Tournament', entityId: t.id, target: t.name, after: `${dto.startDate} → ${dto.endDate}` });
    // Annonce : familles des joueurs qui remplissent les critères (le tournoi s'affiche aussi sur leur accueil).
    const when = dto.startDate === dto.endDate ? `le ${frDate(dto.startDate)}` : `du ${frDate(dto.startDate)} au ${frDate(dto.endDate)}`;
    await this.tournaments.notify(
      await this.tournaments.eligibleFamilies(dto.eligibility as Eligibility),
      `Nouveau tournoi : ${t.name}`,
      `${when}${t.fee !== null ? ` · inscription ${num(t.fee)} DT` : ''}. ${t.familyRequest ? 'Inscrivez-vous dans Tournois.' : 'Inscriptions par le club.'}`,
      `/tournois/${t.id}`,
    );
    if (t.refereeUserId) await this.tournaments.notify([t.refereeUserId], `Arbitre du tournoi ${t.name}`, `Vous êtes l’arbitre prévu (${when}). Vos matchs vous seront notifiés à la publication du tableau.`, `/tournois/${t.id}`);
    return { id: t.id };
  }

  @Patch(':id')
  @Perm('tournaments.manage')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDto) {
    const t = await this.tournaments.find(id);
    assertVersion(t, dto.version, 'Ce tournoi');
    if (t.status !== TournamentStatus.REGISTRATION && t.status !== TournamentStatus.DRAFT) throw new BadRequestException('Tirage fait : le tournoi ne se modifie plus.');
    await this.validate(dto);
    const ref = await this.referee(dto.refereeUserId, dto.refereeName);
    await this.prisma.tournament.update({ where: { id }, data: { ...this.data(dto), ...ref, version: { increment: 1 } } });
    await this.audit.log(actor.id, { action: 'Tournoi modifié', entity: 'Tournament', entityId: id, target: dto.name });
    const link = `/tournois/${id}`;
    const moved = isoDay(t.startDate) !== dto.startDate || isoDay(t.endDate) !== dto.endDate || t.dayStart !== dto.dayStart || t.dayEnd !== dto.dayEnd;
    if (moved) await this.tournaments.notify(await this.tournaments.entryFamilies(id), `Tournoi modifié : ${dto.name}`, `Nouvelles dates : du ${frDate(dto.startDate)} au ${frDate(dto.endDate)}, ${dto.dayStart}–${dto.dayEnd}.`, link);
    if (ref.refereeUserId !== t.refereeUserId) {
      if (ref.refereeUserId) await this.tournaments.notify([ref.refereeUserId], `Arbitre du tournoi ${dto.name}`, 'Vous êtes l’arbitre prévu. Vos matchs vous seront notifiés à la publication du tableau.', link);
      if (t.refereeUserId) await this.tournaments.notify([t.refereeUserId], `Arbitrage : ${dto.name}`, 'Un autre arbitre est prévu pour ce tournoi.', link);
    }
    return { ok: true };
  }

  /** Annule un tournoi : matchs non joués supprimés, terrains libérés (réservations annulées). */
  @Post(':id/cancel')
  @HttpCode(200)
  @Perm('tournaments.manage')
  async cancel(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body('reason') reason?: string) {
    const t = await this.tournaments.find(id);
    if (!reason?.trim()) throw new BadRequestException('Le motif est obligatoire.');
    if (t.status === TournamentStatus.FINISHED) throw new BadRequestException('Tournoi terminé : il ne s’annule plus.');
    await this.prisma.$transaction(async (tx) => {
      const pending = await tx.match.findMany({ where: { tournamentId: id, status: MatchStatus.SCHEDULED }, select: { id: true, reservationId: true } });
      await tx.reservation.updateMany({
        where: { id: { in: pending.map((m) => m.reservationId).filter((x): x is string => Boolean(x)) } },
        data: { activeKey: null, cancelledAt: new Date(), cancelledById: actor.id, cancelReason: `Tournoi annulé : ${reason.trim()}` },
      });
      await tx.match.deleteMany({ where: { id: { in: pending.map((m) => m.id) } } });
      await tx.tournament.update({ where: { id }, data: { status: TournamentStatus.CANCELLED } });
      await this.audit.log(actor.id, { action: 'Tournoi annulé', entity: 'Tournament', entityId: id, target: t.name, reason: reason.trim() }, tx);
    });
    const refs = await this.prisma.match.findMany({ where: { tournamentId: id, refereeUserId: { not: null } }, select: { refereeUserId: true } });
    const users = [...(await this.tournaments.entryFamilies(id)), ...refs.map((r) => r.refereeUserId!), ...(t.refereeUserId ? [t.refereeUserId] : [])];
    await this.tournaments.notify([...new Set(users)], `Tournoi annulé : ${t.name}`, `Motif : ${reason.trim()}.`, `/tournois/${id}`);
    return { ok: true };
  }

  @Post(':id/entries')
  @Perm('tournaments.manage')
  async addEntry(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EntryDto) {
    const t = await this.tournaments.find(id);
    if (t.status !== TournamentStatus.REGISTRATION) throw new BadRequestException('Inscriptions fermées.');
    const count = await this.prisma.tournamentEntry.count({ where: { tournamentId: id, status: 'CONFIRMED' } });
    if (count >= t.maxPlayers) throw new BadRequestException(`Tableau complet (${t.maxPlayers} places).`);
    let name = dto.name?.trim() ?? '';
    let derogation: string | null = null;
    if (dto.playerId) {
      const p = await this.prisma.player.findUnique({ where: { id: dto.playerId }, select: { firstName: true, lastName: true } });
      if (!p) throw new NotFoundException('Joueur introuvable.');
      name = fullName(p).trim();
      const ok = await this.tournaments.eligible(t.eligibility as Eligibility, dto.playerId);
      if (!ok.ok) {
        derogation = dto.derogationReason?.trim() || null;
        if (!derogation) throw new BadRequestException(`Hors critères (${ok.why}) : motif de dérogation obligatoire.`);
      }
      const existing = await this.prisma.tournamentEntry.findUnique({ where: { tournamentId_playerId: { tournamentId: id, playerId: dto.playerId } } });
      if (existing && existing.status !== 'WITHDRAWN') {
        if (existing.status === 'PENDING') {
          await this.prisma.tournamentEntry.update({ where: { id: existing.id }, data: { status: 'CONFIRMED', derogationReason: derogation } });
          await this.tournaments.notify(await this.tournaments.familyOf([dto.playerId]), `Inscription confirmée : ${t.name}`, `${name} est inscrit au tournoi.`, `/tournois/${id}`);
          return { id: existing.id };
        }
        throw new BadRequestException('Joueur déjà inscrit.');
      }
      if (existing) {
        await this.prisma.tournamentEntry.update({ where: { id: existing.id }, data: { status: 'CONFIRMED', derogationReason: derogation } });
        return { id: existing.id };
      }
    }
    const e = await this.prisma.tournamentEntry.create({ data: { tournamentId: id, playerId: dto.playerId ?? null, name, derogationReason: derogation } });
    await this.audit.log(actor.id, { action: 'Inscription au tournoi', entity: 'Tournament', entityId: id, target: `${t.name} · ${name}`, reason: derogation ?? undefined });
    if (dto.playerId) await this.tournaments.notify(await this.tournaments.familyOf([dto.playerId]), `Inscription au tournoi ${t.name}`, `${name} est inscrit.`, `/tournois/${id}`);
    return { id: e.id };
  }

  @Patch(':id/entries/:entryId')
  @Perm('tournaments.manage')
  async seed(@Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @Body() dto: SeedDto) {
    const e = await this.prisma.tournamentEntry.findFirst({ where: { id: entryId, tournamentId: id } });
    if (!e) throw new NotFoundException('Inscription introuvable.');
    await this.prisma.tournamentEntry.update({ where: { id: entryId }, data: { seed: dto.seed ?? null } });
    return { ok: true };
  }

  @Delete(':id/entries/:entryId')
  @Perm('tournaments.manage')
  async withdraw(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string) {
    const t = await this.tournaments.find(id);
    if (t.status !== TournamentStatus.REGISTRATION) throw new BadRequestException('Tirage fait : retrait impossible (forfait à saisir sur le match).');
    const e = await this.prisma.tournamentEntry.findFirst({ where: { id: entryId, tournamentId: id } });
    if (!e) throw new NotFoundException('Inscription introuvable.');
    await this.prisma.tournamentEntry.delete({ where: { id: entryId } });
    await this.audit.log(actor.id, { action: e.status === 'PENDING' ? 'Demande d’inscription refusée' : 'Retrait du tournoi', entity: 'Tournament', entityId: id, target: `${t.name} · ${e.name}` });
    if (e.playerId) {
      await this.tournaments.notify(
        await this.tournaments.familyOf([e.playerId]),
        e.status === 'PENDING' ? `Demande refusée : ${t.name}` : `Inscription retirée : ${t.name}`,
        e.status === 'PENDING' ? `La demande pour ${e.name} n’a pas été retenue. Renseignez-vous auprès de la direction technique.` : `${e.name} ne fait plus partie des inscrits.`,
        `/tournois/${id}`,
      );
    }
    return { ok: true };
  }

  /** Famille : demande d'inscription (validée ensuite par la direction technique). */
  @Post(':id/request')
  @HttpCode(200)
  @Roles(Role.PARENT, Role.PLAYER)
  async request(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequestDto) {
    const t = await this.tournaments.find(id);
    if (!t.familyRequest || t.status !== TournamentStatus.REGISTRATION) throw new ForbiddenException('Inscriptions par la direction technique seulement.');
    const playerId = await this.access.resolvePlayer(user, dto.playerId);
    const ok = await this.tournaments.eligible(t.eligibility as Eligibility, playerId);
    if (!ok.ok) throw new BadRequestException(`Inscription impossible : ${ok.why}.`);
    const p = await this.prisma.player.findUniqueOrThrow({ where: { id: playerId }, select: { firstName: true, lastName: true } });
    const existing = await this.prisma.tournamentEntry.findUnique({ where: { tournamentId_playerId: { tournamentId: id, playerId } } });
    if (existing && existing.status !== 'WITHDRAWN') throw new BadRequestException(existing.status === 'PENDING' ? 'Demande déjà envoyée.' : 'Déjà inscrit.');
    if (existing) await this.prisma.tournamentEntry.update({ where: { id: existing.id }, data: { status: 'PENDING', requestedById: user.id } });
    else await this.prisma.tournamentEntry.create({ data: { tournamentId: id, playerId, name: fullName(p).trim(), status: 'PENDING', requestedById: user.id } });
    await this.tournaments.notify(await this.tournaments.managers(), `Demande d’inscription : ${fullName(p).trim()}`, `${t.name} : demande à valider dans Tournois › Inscrits.`, `/tournois/${id}`);
    return { ok: true, message: 'Demande envoyée : la direction technique la valide.' };
  }

  @Post(':id/draw')
  @HttpCode(200)
  @Perm('tournaments.manage')
  draw(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.draw(actor.id, id);
  }

  /** Résultat saisi par la direction (score sur papier, forfait) : le vainqueur passe au tour suivant. */
  @Post(':id/matches/:matchId/result')
  @HttpCode(200)
  @Perm('tournaments.manage')
  async result(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: ResultDto) {
    const m = await this.prisma.match.findFirst({ where: { id: matchId, tournamentId: id } });
    if (!m) throw new NotFoundException('Match introuvable.');
    if (m.playerAName.startsWith(TBD) || m.playerBName.startsWith(TBD)) throw new BadRequestException('Les deux joueurs ne sont pas encore connus.');
    if (m.status === MatchStatus.FINISHED) throw new BadRequestException('Match déjà terminé.');
    const score = dto.score?.trim() || 'Forfait';
    await this.prisma.match.update({
      where: { id: matchId },
      data: { status: MatchStatus.FINISHED, winner: dto.winner, score, finishedAt: new Date(), endReason: dto.score?.trim() ? null : 'Victoire par forfait' },
    });
    await this.audit.log(actor.id, { action: 'Résultat de match saisi', entity: 'Match', entityId: matchId, target: `${m.playerAName} – ${m.playerBName}`, after: `${dto.winner ? m.playerBName : m.playerAName} · ${score}` });
    await this.tournaments.notify(await this.tournaments.familyOf([m.playerAId, m.playerBId]), `Résultat : ${dto.winner ? m.playerBName : m.playerAName} gagne`, `${m.playerAName} – ${m.playerBName} · ${score}.`, `/matchs/${matchId}`);
    await this.tournaments.afterMatch(matchId);
    return { ok: true };
  }

  /** Publie (ou retire) le tableau et les créneaux : les familles inscrites sont prévenues à la publication. */
  @Post(':id/publish')
  @HttpCode(200)
  @Perm('tournaments.manage')
  async publish(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishDto) {
    const t = await this.tournaments.find(id);
    if (t.status === TournamentStatus.REGISTRATION || t.status === TournamentStatus.DRAFT) throw new BadRequestException('Faites d’abord le tirage et le planning.');
    if (t.drawPublished === dto.published) return { ok: true };
    await this.prisma.tournament.update({ where: { id }, data: { drawPublished: dto.published, version: { increment: 1 } } });
    await this.audit.log(actor.id, { action: dto.published ? 'Tableau du tournoi publié' : 'Tableau du tournoi retiré', entity: 'Tournament', entityId: id, target: t.name });
    if (dto.published) {
      const entries = await this.prisma.tournamentEntry.findMany({ where: { tournamentId: id, status: 'CONFIRMED' }, select: { playerId: true } });
      await this.tournaments.notify(await this.tournaments.familyOf(entries.map((e) => e.playerId)), `Tableau du tournoi ${t.name}`, 'Le tableau et l’horaire des matchs sont publiés dans Tournois.', `/tournois/${id}`);
      // Arbitres : la liste de leurs matchs avec l'horaire.
      const ms = await this.prisma.match.findMany({ where: { tournamentId: id, refereeUserId: { not: null }, status: MatchStatus.SCHEDULED }, orderBy: { scheduledAt: 'asc' } });
      const byRef = new Map<string, typeof ms>();
      for (const m of ms) byRef.set(m.refereeUserId!, [...(byRef.get(m.refereeUserId!) ?? []), m]);
      for (const [userId, list] of byRef) {
        const first = list[0];
        await this.tournaments.notify(
          [userId],
          `Arbitre : ${list.length} match(s) · ${t.name}`,
          `Premier match ${this.tournaments.slot(first)} (${first.playerAName} – ${first.playerBName}). Vous saisissez les points depuis Matchs.`,
          list.length === 1 ? `/matchs/${first.id}` : `/tournois/${id}`,
        );
      }
    }
    return { ok: true };
  }

  /** Inscription payante : réglée ou non (direction technique ou encaissement). */
  @Patch(':id/entries/:entryId/payment')
  @Perm('tournaments.manage', 'payments.collect')
  async payment(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @Body() dto: PaymentDto) {
    const t = await this.tournaments.find(id);
    if (t.fee === null) throw new BadRequestException('Tournoi gratuit : aucun paiement à suivre.');
    const e = await this.prisma.tournamentEntry.findFirst({ where: { id: entryId, tournamentId: id } });
    if (!e) throw new NotFoundException('Inscription introuvable.');
    await this.prisma.tournamentEntry.update({ where: { id: entryId }, data: dto.paid ? { paidAt: new Date(), paidById: actor.id } : { paidAt: null, paidById: null } });
    await this.audit.log(actor.id, {
      action: dto.paid ? 'Inscription au tournoi payée' : 'Paiement d’inscription annulé',
      entity: 'Tournament',
      entityId: id,
      target: `${t.name} · ${e.name}`,
      after: dto.paid ? `${num(t.fee)} DT` : null,
    });
    if (e.playerId) {
      await this.tournaments.notify(
        await this.tournaments.familyOf([e.playerId]),
        dto.paid ? `Inscription payée : ${t.name}` : `Paiement d’inscription annulé : ${t.name}`,
        dto.paid ? `${num(t.fee)} DT reçus pour ${e.name}. Merci !` : `Le paiement de ${e.name} est de nouveau à régler (${num(t.fee)} DT).`,
        `/tournois/${id}`,
      );
    }
    return { ok: true };
  }

  /** Arbitre d'un match (avant son début) : compte du club, ou nom d'une personne hors club. */
  @Patch(':id/matches/:matchId/referee')
  @Perm('tournaments.manage')
  async setReferee(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: RefereeDto) {
    const m = await this.prisma.match.findFirst({ where: { id: matchId, tournamentId: id } });
    if (!m) throw new NotFoundException('Match introuvable.');
    if (m.status !== MatchStatus.SCHEDULED) throw new BadRequestException('Match commencé : l’arbitre ne change plus.');
    const ref = await this.referee(dto.userId, dto.name);
    await this.prisma.match.update({ where: { id: matchId }, data: ref });
    await this.audit.log(actor.id, { action: 'Arbitre du match', entity: 'Match', entityId: matchId, target: `${m.playerAName} – ${m.playerBName}`, before: m.refereeName, after: ref.refereeName });
    if (ref.refereeUserId && ref.refereeUserId !== m.refereeUserId) {
      await this.tournaments.notify([ref.refereeUserId], `Arbitre : ${m.playerAName} – ${m.playerBName}`, `${m.title ?? 'Match'} · ${this.tournaments.slot(m)}. Vous saisissez les points depuis Matchs.`, `/matchs/${matchId}`);
    }
    if (m.refereeUserId && m.refereeUserId !== ref.refereeUserId) {
      await this.tournaments.notify([m.refereeUserId], `Arbitrage retiré : ${m.playerAName} – ${m.playerBName}`, `${m.title ?? 'Match'} · ${this.tournaments.slot(m)} : un autre arbitre est prévu.`, `/matchs/${matchId}`);
    }
    return { ok: true };
  }

  @Get(':id/conflicts')
  @Perm('tournaments.manage')
  conflicts(@Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.conflicts(id);
  }

  /** Entraînement en conflit : déplacé sur un terrain libre, ou reporté (à rattraper) ; groupe et entraîneurs prévenus. */
  @Post(':id/conflicts')
  @HttpCode(200)
  @Perm('tournaments.manage')
  async resolve(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConflictDto) {
    const t = await this.tournaments.find(id);
    const slot = await this.prisma.groupSlot.findUnique({
      where: { id: dto.slotId },
      include: {
        group: { include: { members: { select: { enrollment: { select: { playerId: true } } } } } },
        coaches: { select: { coach: { select: { userId: true } } } },
      },
    });
    if (!slot) throw new NotFoundException('Séance introuvable.');
    let courtId: string | null = null;
    let courtName = '';
    if (dto.action === 'move') {
      const free = dto.courtId
        ? await this.prisma.court.findUnique({ where: { id: dto.courtId }, select: { id: true, name: true } })
        : await this.tournaments.freeCourt(dto.date, slot.startTime, slot.endTime, slot.courtId ?? '');
      if (!free) throw new BadRequestException('Aucun terrain libre à cet horaire : reportez la séance.');
      courtId = free.id;
      courtName = free.name;
    }
    const reason = dto.action === 'move' ? `Terrain pris par le tournoi ${t.name} : séance sur ${courtName}` : `Terrain pris par le tournoi ${t.name} : séance reportée`;
    await this.prisma.sessionChange.upsert({
      where: { slotId_date: { slotId: slot.id, date: dayFromIso(dto.date) } },
      create: { slotId: slot.id, date: dayFromIso(dto.date), kind: dto.action === 'move' ? 'MOVED' : 'POSTPONED', courtId, reason, tournamentId: id, createdById: actor.id },
      update: { kind: dto.action === 'move' ? 'MOVED' : 'POSTPONED', courtId, reason, tournamentId: id, createdById: actor.id },
    });
    const users = [...(await this.tournaments.familyOf(slot.group.members.map((m) => m.enrollment.playerId))), ...slot.coaches.map((c) => c.coach.userId)];
    await this.tournaments.notify(
      [...new Set(users)],
      `${slot.group.name} · ${dto.date} ${slot.startTime} : ${dto.action === 'move' ? `séance sur ${courtName}` : 'séance reportée'}`,
      reason,
      '/seances',
    );
    await this.audit.log(actor.id, { action: dto.action === 'move' ? 'Séance déplacée (tournoi)' : 'Séance reportée (tournoi)', entity: 'GroupSlot', entityId: slot.id, target: `${slot.group.name} · ${dto.date}`, after: reason });
    return { ok: true };
  }
}
