import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EmailKind, MatchStatus, Prisma, ReservationType, SeasonStatus, TournamentFormat, TournamentStatus } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { addDaysIso, dayFromIso, isoDay, localInstant, minutesOf } from '../common/dates';
import { fullName } from '../common/rules';
import { DAY_LONG, periodSelect, slotRunsOn, withPeriod } from '../common/sessions';
import { PrismaService } from '../prisma/prisma.service';

export type Eligibility = { mode: 'cats' | 'age' | 'open'; categoryIds?: string[]; fromYear?: number; toYear?: number; gender?: 'M' | 'F' | null };
export const TBD = 'À déterminer';
const NIGHT_MIN = 18 * 60;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Ordre standard des têtes de série dans un tableau de taille `size` (1 et 2 ne se rencontrent qu'en finale). */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((x) => [x, n + 1 - x]);
  }
  return order;
}

/** Libellé d'un tour d'élimination directe selon le nombre de joueurs restants. */
export function roundLabel(format: TournamentFormat, round: number, rounds: number): string {
  if (format === TournamentFormat.ROUND_ROBIN) return `Journée ${round}`;
  const left = 2 ** (rounds - round + 1);
  return left === 2 ? 'Finale' : left === 4 ? 'Demi-finale' : left === 8 ? 'Quart de finale' : left === 16 ? '8e de finale' : `Tour ${round}`;
}

type Tx = Prisma.TransactionClient;

/**
 * Logique des tournois : critères d'inscription, tirage (élimination directe avec têtes de série et exempts, ou
 * championnat), planning des matchs sur les terrains choisis (réservations « tournoi »), conflits avec les entraînements,
 * avancement du tableau à la fin de chaque match, historique d'un joueur.
 */
@Injectable()
export class TournamentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async find(id: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Tournoi introuvable.');
    return t;
  }

  /** Le joueur remplit-il les critères (catégorie de la saison active, année de naissance, genre) ? */
  async eligible(elig: Eligibility, playerId: string): Promise<{ ok: boolean; why?: string }> {
    const p = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { birthDate: true, gender: true, archivedAt: true, enrollments: { where: { season: { status: SeasonStatus.ACTIVE } }, select: { categoryId: true } } },
    });
    if (!p || p.archivedAt) return { ok: false, why: 'joueur introuvable' };
    if (elig.gender && p.gender !== elig.gender) return { ok: false, why: elig.gender === 'F' ? 'tournoi réservé aux filles' : 'tournoi réservé aux garçons' };
    if (elig.mode === 'cats' && elig.categoryIds?.length && !p.enrollments.some((e) => elig.categoryIds!.includes(e.categoryId))) {
      return { ok: false, why: 'catégorie hors critères' };
    }
    if (elig.mode === 'age') {
      const y = p.birthDate?.getUTCFullYear();
      if (!y || (elig.fromYear && y < elig.fromYear) || (elig.toYear && y > elig.toYear)) return { ok: false, why: 'année de naissance hors critères' };
    }
    return { ok: true };
  }

  /** Comptes à prévenir pour un joueur du club : parents actifs, et le joueur s'il a son compte. */
  async familyOf(playerIds: (string | null)[]): Promise<string[]> {
    const ids = playerIds.filter((x): x is string => Boolean(x));
    if (!ids.length) return [];
    const players = await this.prisma.player.findMany({
      where: { id: { in: ids } },
      select: { userId: true, parentLinks: { where: { parent: { isActive: true } }, select: { parentId: true } } },
    });
    return [...new Set(players.flatMap((p) => [...p.parentLinks.map((l) => l.parentId), ...(p.userId ? [p.userId] : [])]))];
  }

  async notify(users: string[], title: string, body: string, link: string, tx: Tx | PrismaService = this.prisma) {
    if (users.length) await tx.notification.createMany({ data: users.map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link })) });
  }

  /**
   * Tirage et planning : crée tous les matchs (tours suivants « À déterminer »), place chaque match sur un terrain et un
   * horaire libres (repos entre deux matchs d'un même joueur) et bloque le terrain par une réservation « tournoi ».
   */
  async draw(actorId: string, id: string) {
    const t = await this.find(id);
    if (t.status !== TournamentStatus.REGISTRATION && t.status !== TournamentStatus.DRAFT) throw new BadRequestException('Tirage déjà fait.');
    const entries = await this.prisma.tournamentEntry.findMany({ where: { tournamentId: id, status: 'CONFIRMED' }, orderBy: { createdAt: 'asc' } });
    if (entries.length < 2) throw new BadRequestException('Il faut au moins 2 inscrits confirmés.');
    if (!t.courtIds.length) throw new BadRequestException('Choisissez au moins un terrain.');
    // Têtes de série d'abord (dans l'ordre), puis les autres au hasard.
    const seeded = entries.filter((e) => e.seed).sort((a, b) => a.seed! - b.seed!);
    const others = entries.filter((e) => !e.seed).sort(() => Math.random() - 0.5);
    const ranked = [...seeded, ...others];

    type Planned = { round: number; position: number; a: (typeof ranked)[number] | null; b: (typeof ranked)[number] | null; feeders?: [number, number] };
    const planned: Planned[] = [];
    let rounds = 1;
    if (t.format === TournamentFormat.KNOCKOUT) {
      const size = Math.max(2, 2 ** Math.ceil(Math.log2(ranked.length)));
      rounds = Math.log2(size);
      const slots = seedOrder(size).map((seed) => ranked[seed - 1] ?? null);
      for (let p = 0; p < size / 2; p++) planned.push({ round: 1, position: p, a: slots[2 * p], b: slots[2 * p + 1] });
      for (let r = 2; r <= rounds; r++) for (let p = 0; p < size / 2 ** r; p++) planned.push({ round: r, position: p, a: null, b: null });
      // Exempts : le joueur seul passe directement au tour suivant (pas de match).
      for (const m of planned.filter((x) => x.round === 1 && (!x.a || !x.b))) {
        const next = planned.find((x) => x.round === 2 && x.position === Math.floor(m.position / 2));
        if (next) next[m.position % 2 ? 'b' : 'a'] = m.a ?? m.b;
      }
    } else {
      // Championnat : méthode du cercle (un exempt si nombre impair).
      const list: (typeof ranked[number] | null)[] = [...ranked];
      if (list.length % 2) list.push(null);
      const n = list.length;
      rounds = n - 1;
      for (let r = 0; r < n - 1; r++) {
        for (let i = 0; i < n / 2; i++) {
          const a = list[i];
          const b = list[n - 1 - i];
          if (a && b) planned.push({ round: r + 1, position: i, a, b });
        }
        list.splice(1, 0, list.pop()!);
      }
    }
    const real = planned.filter((m) => !(t.format === TournamentFormat.KNOCKOUT && m.round === 1 && (!m.a || !m.b)));

    // Créneaux possibles : jours du tournoi × heures × terrains.
    const courts = await this.prisma.court.findMany({ where: { id: { in: t.courtIds }, active: true }, orderBy: { sortOrder: 'asc' } });
    const from = isoDay(t.startDate);
    const to = isoDay(t.endDate);
    const startMin = minutesOf(t.dayStart);
    const endMin = minutesOf(t.dayEnd);
    const existing = await this.prisma.reservation.findMany({
      where: { courtId: { in: courts.map((c) => c.id) }, activeKey: { not: null }, startTime: { lt: localInstant(addDaysIso(to, 1), 0) }, endTime: { gt: localInstant(from, 0) } },
      select: { courtId: true, startTime: true, endTime: true },
    });
    const taken: { courtId: string; start: Date; end: Date }[] = existing.map((r) => ({ courtId: r.courtId, start: r.startTime, end: r.endTime }));
    const endOf = new Map<string, Date>(); // fin du match (round|position)
    const playerFree = new Map<string, Date>(); // joueur → disponible à partir de
    const schedule = new Map<string, { courtId: string; court: string; start: Date; end: Date; day: string }>();
    const unplaced: string[] = [];
    const rest = t.restMinutes * 60_000;
    for (const m of real.sort((x, y) => x.round - y.round || x.position - y.position)) {
      let earliest = localInstant(from, t.dayStart);
      if (t.format === TournamentFormat.KNOCKOUT && m.round > 1) {
        for (const q of [2 * m.position, 2 * m.position + 1]) {
          const e = endOf.get(`${m.round - 1}|${q}`);
          if (e && e.getTime() + rest > earliest.getTime()) earliest = new Date(e.getTime() + rest);
        }
      }
      for (const e of [m.a, m.b]) {
        const free = e && playerFree.get(e.id);
        if (free && free > earliest) earliest = free;
      }
      let placed = false;
      for (let day = from; day <= to && !placed; day = addDaysIso(day, 1)) {
        for (let min = startMin; min + t.matchMinutes <= endMin && !placed; min += 30) {
          const start = localInstant(day, hhmm(min));
          const end = new Date(start.getTime() + t.matchMinutes * 60_000);
          if (start < earliest) continue;
          for (const c of courts) {
            if (min + t.matchMinutes > NIGHT_MIN && !c.lit) continue;
            if (taken.some((x) => x.courtId === c.id && x.start < end && start < x.end)) continue;
            taken.push({ courtId: c.id, start, end });
            schedule.set(`${m.round}|${m.position}`, { courtId: c.id, court: c.name, start, end, day });
            endOf.set(`${m.round}|${m.position}`, end);
            for (const e of [m.a, m.b]) if (e) playerFree.set(e.id, new Date(end.getTime() + rest));
            placed = true;
            break;
          }
        }
      }
      if (!placed) unplaced.push(`${roundLabel(t.format, m.round, rounds)} n° ${m.position + 1}`);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const m of real) {
        const slot = schedule.get(`${m.round}|${m.position}`);
        const reservation = slot
          ? await tx.reservation.create({
              data: {
                courtId: slot.courtId,
                type: ReservationType.TOURNAMENT,
                startTime: slot.start,
                endTime: slot.end,
                price: 0,
                bookedById: actorId,
                activeKey: `${slot.courtId}|${slot.start.toISOString()}`,
              },
            })
          : null;
        const label = roundLabel(t.format, m.round, rounds);
        await tx.match.create({
          data: {
            kind: 'TOURNAMENT',
            title: `${t.name} · ${label}`,
            date: dayFromIso(slot?.day ?? from),
            court: slot?.court ?? null,
            playerAId: m.a?.playerId ?? null,
            playerAName: m.a?.name ?? `${TBD}`,
            playerBId: m.b?.playerId ?? null,
            playerBName: m.b?.name ?? `${TBD}`,
            setsToWin: t.setsToWin,
            games: t.games,
            tiebreak: t.tiebreak,
            superTB: t.superTB,
            noAd: t.noAd,
            createdById: actorId,
            tournamentId: t.id,
            round: m.round,
            position: m.position,
            scheduledAt: slot?.start ?? null,
            reservationId: reservation?.id ?? null,
            refereeUserId: t.refereeUserId,
            refereeName: t.refereeName,
          },
        });
      }
      // Tableau et créneaux d'abord vérifiés par la direction, puis publiés (familles prévenues à la publication).
      await tx.tournament.update({ where: { id }, data: { status: TournamentStatus.RUNNING, drawPublished: false, version: { increment: 1 } } });
      await this.audit.log(actorId, { action: 'Tirage du tournoi', entity: 'Tournament', entityId: id, target: t.name, after: `${entries.length} joueurs · ${real.length} matchs` }, tx);
    });
    return { matches: real.length, unplaced };
  }

  /**
   * Ce qu'un acteur voit d'un match de tournoi : résultat (si les résultats sont publics, ou s'il est concerné : joueur,
   * parent, arbitre, direction) et score en direct (si le direct est choisi, sinon seulement arbitre et direction).
   */
  visibility(
    t: { resultsPublic: boolean; liveScoring: boolean },
    m: { playerAId: string | null; playerBId: string | null; refereeUserId: string | null },
    who: { manage: boolean; user: { id: string }; own: string[] },
  ): { result: boolean; live: boolean } {
    const referee = m.refereeUserId === who.user.id;
    const concerned = who.manage || referee || Boolean((m.playerAId && who.own.includes(m.playerAId)) || (m.playerBId && who.own.includes(m.playerBId)));
    return { result: t.resultsPublic || concerned, live: who.manage || referee || (t.liveScoring && (t.resultsPublic || concerned)) };
  }

  /** Match terminé : le vainqueur passe au tour suivant ; finale (ou dernier match du championnat) → tournoi terminé. */
  async afterMatch(matchId: string) {
    const m = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!m?.tournamentId || m.status !== MatchStatus.FINISHED || m.winner === null || m.round === null || m.position === null) return;
    const t = await this.find(m.tournamentId);
    const winnerName = m.winner === 0 ? m.playerAName : m.playerBName;
    const winnerId = m.winner === 0 ? m.playerAId : m.playerBId;
    if (t.format === TournamentFormat.KNOCKOUT) {
      const next = await this.prisma.match.findFirst({ where: { tournamentId: t.id, round: m.round + 1, position: Math.floor(m.position / 2) } });
      if (next) {
        const side = m.position % 2 ? 'B' : 'A';
        await this.prisma.match.update({ where: { id: next.id }, data: side === 'A' ? { playerAId: winnerId, playerAName: winnerName } : { playerBId: winnerId, playerBName: winnerName } });
        return;
      }
      await this.finish(t.id, t.name, winnerName, winnerId);
      return;
    }
    const left = await this.prisma.match.count({ where: { tournamentId: t.id, status: { in: [MatchStatus.SCHEDULED, MatchStatus.LIVE] } } });
    if (!left) {
      const standings = await this.standings(t.id);
      const top = standings[0];
      if (top) await this.finish(t.id, t.name, top.name, top.playerId);
    }
  }

  private async finish(id: string, name: string, winnerName: string, winnerId: string | null) {
    await this.prisma.tournament.update({ where: { id }, data: { status: TournamentStatus.FINISHED, winnerName } });
    const entries = await this.prisma.tournamentEntry.findMany({ where: { tournamentId: id }, select: { playerId: true } });
    await this.notify(await this.familyOf(entries.map((e) => e.playerId)), `${name} : ${winnerName} remporte le tournoi`, 'Résultats et tableau complet dans Tournois.', `/tournois/${id}`);
    void winnerId;
  }

  /**
   * Avant d'annuler le dernier point d'un match de tournoi terminé : le match suivant ne doit pas avoir commencé.
   * Après l'annulation, la place du vainqueur au tour suivant est libérée.
   */
  async beforeReopen(m: { id: string; tournamentId: string | null; round: number | null; position: number | null }) {
    if (!m.tournamentId || m.round === null || m.position === null) return;
    const next = await this.prisma.match.findFirst({ where: { tournamentId: m.tournamentId, round: m.round + 1, position: Math.floor(m.position / 2) } });
    if (next && next.status !== MatchStatus.SCHEDULED) throw new BadRequestException('Le match suivant du tableau a commencé : correction impossible.');
    if (next) {
      await this.prisma.match.update({
        where: { id: next.id },
        data: m.position % 2 ? { playerBId: null, playerBName: TBD } : { playerAId: null, playerAName: TBD },
      });
    } else {
      await this.prisma.tournament.update({ where: { id: m.tournamentId }, data: { status: TournamentStatus.RUNNING, winnerName: null } });
    }
  }

  /** Classement d'un championnat : victoires, puis différence de sets. */
  async standings(id: string) {
    const [entries, matches] = await Promise.all([
      this.prisma.tournamentEntry.findMany({ where: { tournamentId: id, status: 'CONFIRMED' } }),
      this.prisma.match.findMany({ where: { tournamentId: id, status: MatchStatus.FINISHED } }),
    ]);
    const row = new Map(entries.map((e) => [e.name, { name: e.name, playerId: e.playerId, played: 0, wins: 0, losses: 0, setsFor: 0, setsAgainst: 0 }]));
    for (const m of matches) {
      const sets = (m.score ?? '').split(' ').filter(Boolean).map((s) => s.replace(/\(.*\)/, '').split('-').map(Number));
      const won = [sets.filter(([a, b]) => a > b).length, sets.filter(([a, b]) => b > a).length];
      for (const [i, n] of [m.playerAName, m.playerBName].entries()) {
        const r = row.get(n);
        if (!r) continue;
        r.played++;
        if (m.winner === i) r.wins++;
        else r.losses++;
        r.setsFor += won[i] ?? 0;
        r.setsAgainst += won[1 - i] ?? 0;
      }
    }
    return [...row.values()].sort((a, b) => b.wins - a.wins || b.setsFor - b.setsAgainst - (a.setsFor - a.setsAgainst) || a.name.localeCompare(b.name, 'fr'));
  }

  /** Entraînements qui tombent sur un terrain et un horaire de match du tournoi (avec la décision prise). */
  async conflicts(id: string) {
    const matches = await this.prisma.match.findMany({
      where: { tournamentId: id, scheduledAt: { not: null } },
      include: { reservation: { select: { courtId: true, startTime: true, endTime: true } } },
    });
    if (!matches.length) return [];
    const days = [...new Set(matches.map((m) => isoDay(m.date)))];
    const season = await this.access.activeSeason();
    const slots = (
      await this.prisma.groupSlot.findMany({
        where: { courtId: { not: null }, group: { seasonId: season.id, archivedAt: null } },
        include: {
          group: { select: { id: true, name: true, ...periodSelect } },
          court: { select: { id: true, name: true } },
          coaches: { select: { coach: { select: { user: { select: { firstName: true, lastName: true } } } } } },
          changes: { where: { date: { in: days.map(dayFromIso) } }, include: { court: { select: { name: true } } } },
        },
      })
    ).map(withPeriod);
    const out = new Map<string, unknown>();
    for (const m of matches) {
      if (!m.reservation) continue;
      const day = isoDay(m.date);
      for (const s of slots) {
        if (s.courtId !== m.reservation.courtId || !slotRunsOn(s, day)) continue;
        const sStart = localInstant(day, s.startTime);
        const sEnd = localInstant(day, s.endTime);
        if (!(sStart < m.reservation.endTime && m.reservation.startTime < sEnd)) continue;
        const key = `${s.id}|${day}`;
        if (out.has(key)) continue;
        const change = s.changes.find((c) => isoDay(c.date) === day);
        out.set(key, {
          slotId: s.id,
          date: day,
          dayLabel: DAY_LONG[s.day],
          group: s.group.name,
          groupId: s.group.id,
          startTime: s.startTime,
          endTime: s.endTime,
          court: s.court?.name ?? '',
          coaches: s.coaches.map((c) => fullName(c.coach.user).trim()),
          change: change ? { kind: change.kind, court: change.court?.name ?? null, reason: change.reason } : null,
          freeCourt: await this.freeCourt(day, s.startTime, s.endTime, s.courtId!),
        });
      }
    }
    return [...out.values()];
  }

  /** Terrain libre ce jour-là sur cet horaire (aucun créneau ni réservation, éclairé si la séance finit après 18h). */
  async freeCourt(day: string, startTime: string, endTime: string, exceptCourtId: string): Promise<{ id: string; name: string } | null> {
    const season = await this.access.activeSeason();
    const start = localInstant(day, startTime);
    const end = localInstant(day, endTime);
    const [courts, slots, reservations, moves] = await Promise.all([
      this.prisma.court.findMany({ where: { active: true, maintenance: false, id: { not: exceptCourtId } }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.groupSlot.findMany({ where: { courtId: { not: null }, group: { seasonId: season.id, archivedAt: null } }, include: { group: { select: periodSelect } } }),
      this.prisma.reservation.findMany({ where: { activeKey: { not: null }, startTime: { lt: end }, endTime: { gt: start } }, select: { courtId: true } }),
      this.prisma.sessionChange.findMany({ where: { date: dayFromIso(day), kind: 'MOVED' }, include: { slot: true } }),
    ]);
    const busy = new Set<string>(reservations.map((r) => r.courtId));
    for (const s of slots.map(withPeriod)) {
      if (!slotRunsOn(s, day)) continue;
      if (localInstant(day, s.startTime) < end && start < localInstant(day, s.endTime)) busy.add(s.courtId!);
    }
    for (const mv of moves) if (mv.courtId && localInstant(day, mv.slot.startTime) < end && start < localInstant(day, mv.slot.endTime)) busy.add(mv.courtId);
    const night = minutesOf(endTime) > NIGHT_MIN;
    const c = courts.find((x) => !busy.has(x.id) && (!night || x.lit));
    return c ? { id: c.id, name: c.name } : null;
  }

  /** Historique des tournois d'un joueur : résultat, victoires et défaites, matchs. */
  async history(playerId: string) {
    const entries = await this.prisma.tournamentEntry.findMany({
      where: { playerId, status: 'CONFIRMED', tournament: { status: { in: [TournamentStatus.RUNNING, TournamentStatus.FINISHED] } } },
      include: { tournament: true },
      orderBy: { tournament: { startDate: 'desc' } },
    });
    const out = [];
    for (const e of entries) {
      const t = e.tournament;
      const matches = await this.prisma.match.findMany({
        where: { tournamentId: t.id, OR: [{ playerAId: playerId }, { playerBId: playerId }] },
        orderBy: [{ round: 'asc' }],
      });
      const rounds = t.format === TournamentFormat.KNOCKOUT ? ((await this.prisma.match.aggregate({ where: { tournamentId: t.id }, _max: { round: true } }))._max.round ?? 1) : 0;
      const played = matches.filter((m) => m.status === MatchStatus.FINISHED);
      const side = (m: (typeof matches)[number]) => (m.playerAId === playerId ? 0 : 1);
      const wins = played.filter((m) => m.winner === side(m)).length;
      let result = 'En cours';
      if (t.format === TournamentFormat.KNOCKOUT) {
        const lost = played.find((m) => m.winner !== side(m));
        if (t.winnerName === e.name) result = 'Vainqueur';
        else if (lost) result = lost.round === rounds ? 'Finaliste' : roundLabel(t.format, lost.round ?? 1, rounds);
      } else if (t.status === TournamentStatus.FINISHED) {
        const rank = (await this.standings(t.id)).findIndex((r) => r.playerId === playerId);
        result = rank === 0 ? 'Vainqueur' : `${rank + 1}e`;
      }
      out.push({
        tournamentId: t.id,
        name: t.name,
        date: isoDay(t.startDate),
        status: t.status,
        result,
        wins,
        losses: played.length - wins,
        matches: matches.map((m) => ({
          id: m.id,
          round: roundLabel(t.format, m.round ?? 1, rounds),
          opponent: side(m) === 0 ? m.playerBName : m.playerAName,
          score: m.score,
          status: m.status,
          won: m.status === MatchStatus.FINISHED ? m.winner === side(m) : null,
        })),
      });
    }
    return {
      tournaments: out,
      totals: {
        played: out.length,
        titles: out.filter((x) => x.result === 'Vainqueur').length,
        finals: out.filter((x) => x.result === 'Finaliste').length,
        wins: out.reduce((t, x) => t + x.wins, 0),
        losses: out.reduce((t, x) => t + x.losses, 0),
      },
    };
  }
}
