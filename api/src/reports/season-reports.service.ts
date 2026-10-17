import { Injectable } from '@nestjs/common';
import { Prisma, SeasonReportKind } from '@prisma/client';
import { addDaysIso, isoDay, localInstant } from '../common/dates';
import { num } from '../common/money';
import { fullName, notFound } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';

type SeasonRow = { id: string; label: string; startDate: Date; endDate: Date; status: string };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Chiffres des rapports de fin de saison, toujours calculés depuis la base (jamais saisis à la main) :
 * rapport moral (membres, encadrement, entraînement, compétitions, événements) et rapport financier
 * (recettes, dépenses dont salaires, résultat), avec la saison précédente pour comparer.
 */
@Injectable()
export class SeasonReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async season(id: string): Promise<SeasonRow> {
    const s = await this.prisma.season.findUnique({ where: { id }, select: { id: true, label: true, startDate: true, endDate: true, status: true } });
    if (!s) throw notFound('Saison');
    return s;
  }

  /** Saison qui précède (date de début antérieure la plus proche). */
  previous(s: SeasonRow) {
    return this.prisma.season.findFirst({
      where: { startDate: { lt: s.startDate }, archivedAt: null },
      orderBy: { startDate: 'desc' },
      select: { id: true, label: true, startDate: true, endDate: true, status: true },
    });
  }

  /** Bornes de la saison : du premier jour au lendemain du dernier (instants locaux). */
  private range(s: SeasonRow) {
    return { gte: localInstant(isoDay(s.startDate), 0), lt: localInstant(addDaysIso(isoDay(s.endDate), 1), 0) };
  }

  // ───────────────────────── Rapport moral ─────────────────────────

  async moral(s: SeasonRow) {
    const range = this.range(s);
    const prev = await this.previous(s);
    const [enrollments, groups, slots, marks, sessions, tournaments, matches, events, prevPlayers] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { seasonId: s.id, player: { archivedAt: null } },
        select: {
          playerId: true,
          player: { select: { gender: true, enrollments: { select: { season: { select: { startDate: true } } } } } },
          category: { select: { name: true, code: true } },
        },
      }),
      this.prisma.trainingGroup.findMany({ where: { seasonId: s.id, archivedAt: null }, select: { kind: true } }),
      this.prisma.slotCoach.findMany({
        where: { slot: { group: { seasonId: s.id, archivedAt: null } } },
        select: { coach: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } },
      }),
      this.prisma.attendance.groupBy({ by: ['status'], where: { group: { seasonId: s.id } }, _count: true }),
      this.prisma.attendance.findMany({ where: { group: { seasonId: s.id } }, distinct: ['slotId', 'date'], select: { slotId: true } }),
      this.prisma.tournament.findMany({
        where: { startDate: range, status: { not: 'CANCELLED' } },
        orderBy: { startDate: 'asc' },
        select: { name: true, startDate: true, endDate: true, status: true, winnerName: true, _count: { select: { entries: { where: { status: 'CONFIRMED' } } } } },
      }),
      this.prisma.match.count({ where: { status: 'FINISHED', date: range } }),
      this.prisma.event.findMany({ where: { published: true, archivedAt: null, date: range }, orderBy: { date: 'asc' }, select: { title: true, date: true, place: true } }),
      prev ? this.prisma.enrollment.count({ where: { seasonId: prev.id } }) : Promise.resolve(null),
    ]);

    // Membres par catégorie (garçons / filles), nouveaux et réinscrits.
    const byCat = new Map<string, { category: string; code: string; boys: number; girls: number }>();
    let fresh = 0;
    for (const e of enrollments) {
      const row = byCat.get(e.category.code) ?? { category: e.category.name, code: e.category.code, boys: 0, girls: 0 };
      if (e.player.gender === 'F') row.girls++;
      else row.boys++;
      byCat.set(e.category.code, row);
      if (!e.player.enrollments.some((x) => x.season.startDate < s.startDate)) fresh++;
    }
    const categories = [...byCat.values()].sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }));
    const coaches = new Map(slots.map((x) => [x.coach.id, fullName(x.coach.user).trim()]));
    const count = (st: string) => marks.find((m) => m.status === st)?._count ?? 0;
    const marked = count('PRESENT') + count('LATE') + count('ABSENT');

    return {
      members: {
        total: enrollments.length,
        boys: categories.reduce((t, c) => t + c.boys, 0),
        girls: categories.reduce((t, c) => t + c.girls, 0),
        newPlayers: fresh,
        returning: enrollments.length - fresh,
        previousTotal: prevPlayers,
        categories,
      },
      staff: {
        groups: groups.length,
        competitive: groups.filter((g) => g.kind === 'COMPETITIVE').length,
        leisure: groups.filter((g) => g.kind === 'LEISURE').length,
        coaches: [...coaches.values()].sort((a, b) => a.localeCompare(b, 'fr')),
      },
      training: { sessions: sessions.length, marked, rate: marked ? Math.round(((count('PRESENT') + count('LATE')) / marked) * 100) : null },
      competition: {
        matches,
        tournaments: tournaments.map((t) => ({
          name: t.name,
          startDate: isoDay(t.startDate),
          endDate: isoDay(t.endDate),
          finished: t.status === 'FINISHED',
          winner: t.winnerName,
          players: t._count.entries,
        })),
      },
      events: events.map((e) => ({ title: e.title, date: isoDay(e.date), place: e.place })),
    };
  }

  // ───────────────────────── Rapport financier ─────────────────────────

  async financial(s: SeasonRow) {
    const current = await this.money(s);
    const prev = await this.previous(s);
    const previous = prev ? await this.money(prev) : null;
    return {
      ...current,
      previous: previous ? { label: prev!.label, income: previous.income.total, expenses: previous.expenses.total, result: previous.result } : null,
    };
  }

  /** Recettes (cotisations, réservations, inscriptions aux tournois) et dépenses (factures, matériel…, salaires) d'une saison. */
  async money(s: SeasonRow) {
    const range = this.range(s);
    const [payments, due, reservations, entries, expenses, unpaidExpenses, salaries, history] = await Promise.all([
      this.prisma.payment.aggregate({ where: { installment: { membership: { enrollment: { seasonId: s.id } } } }, _sum: { amount: true }, _count: true }),
      this.prisma.membership.aggregate({ where: { enrollment: { seasonId: s.id, player: { archivedAt: null } } }, _sum: { totalAmount: true, baseAmount: true } }),
      this.prisma.reservation.aggregate({ where: { cancelledAt: null, startTime: range, type: { in: ['LEISURE', 'PRIVATE'] } }, _sum: { price: true }, _count: true }),
      this.prisma.tournamentEntry.findMany({ where: { paidAt: { not: null }, tournament: { startDate: range } }, select: { tournament: { select: { fee: true } } } }),
      this.prisma.expense.groupBy({ by: ['category'], where: { archivedAt: null, paidAt: range }, _sum: { amount: true }, _count: true }),
      this.prisma.expense.aggregate({ where: { archivedAt: null, paidAt: null, date: range }, _sum: { amount: true }, _count: true }),
      this.prisma.salary.groupBy({ by: ['paidAt'], where: { seasonId: s.id }, _sum: { amount: true } }),
      // Saison passée : recettes et dépenses importées (cahier, Excel, Word).
      this.prisma.historicalEntry.groupBy({ by: ['kind', 'category'], where: { seasonId: s.id, archivedAt: null }, _sum: { amount: true }, _count: true }),
    ]);
    const hist = (kind: 'INCOME' | 'EXPENSE', category?: string) =>
      round3(history.filter((h) => h.kind === kind && (!category || h.category === category)).reduce((t, h) => t + num(h._sum.amount ?? 0), 0));
    const histCount = (kind: 'INCOME' | 'EXPENSE', category: string) => history.find((h) => h.kind === kind && h.category === category)?._count ?? 0;

    const fees = round3(num(payments._sum.amount ?? 0) + hist('INCOME', 'FEES'));
    const courts = round3(num(reservations._sum.price ?? 0));
    const tournaments = round3(entries.reduce((t, e) => t + num(e.tournament.fee ?? 0), 0));
    const dueTotal = num(due._sum.totalAmount ?? 0);
    const paidSalaries = round3(salaries.filter((x) => x.paidAt).reduce((t, x) => t + num(x._sum.amount ?? 0), 0) + hist('EXPENSE', 'SALARY'));
    const unpaidSalaries = round3(salaries.filter((x) => !x.paidAt).reduce((t, x) => t + num(x._sum.amount ?? 0), 0));
    const cats = new Map<string, { category: string; count: number; amount: number }>();
    for (const e of expenses) cats.set(e.category, { category: e.category, count: e._count, amount: round3(num(e._sum.amount ?? 0)) });
    for (const h of history.filter((x) => x.kind === 'EXPENSE' && x.category !== 'SALARY')) {
      const c = cats.get(h.category) ?? { category: h.category, count: 0, amount: 0 };
      cats.set(h.category, { category: h.category, count: c.count + h._count, amount: round3(c.amount + num(h._sum.amount ?? 0)) });
    }
    const byCategory = [...cats.values()].sort((a, b) => b.amount - a.amount);
    // Autres recettes importées (dons, locations, subventions…), à part des cotisations.
    const other = ['DONATION', 'RENTAL', 'TOURNAMENT', 'GRANT', 'OTHER']
      .map((category) => ({ category, count: histCount('INCOME', category), amount: hist('INCOME', category) }))
      .filter((x) => x.amount > 0);
    const incomeTotal = round3(fees + courts + tournaments + other.reduce((t, x) => t + x.amount, 0));
    const expenseTotal = round3(paidSalaries + byCategory.reduce((t, c) => t + c.amount, 0));

    return {
      income: {
        fees,
        feesCount: payments._count + histCount('INCOME', 'FEES'),
        courts,
        courtsCount: reservations._count,
        tournaments,
        other,
        imported: hist('INCOME') > 0 || hist('EXPENSE') > 0,
        total: incomeTotal,
        // Reste à encaisser sur les cotisations de la saison, et coût des réductions accordées.
        remaining: round3(Math.max(0, dueTotal - fees)),
        discounts: round3(Math.max(0, num(due._sum.baseAmount ?? 0) - dueTotal)),
      },
      expenses: {
        salaries: paidSalaries,
        categories: byCategory,
        total: expenseTotal,
        unpaid: round3(num(unpaidExpenses._sum.amount ?? 0) + unpaidSalaries),
      },
      result: round3(incomeTotal - expenseTotal),
    };
  }

  // ───────────────────────── Textes du bureau ─────────────────────────

  /** Textes de la saison ; à défaut, ceux de la saison précédente (à relire), sinon rien (modèle par défaut côté écran). */
  async drafts(s: SeasonRow) {
    const prev = await this.previous(s);
    const rows = await this.prisma.seasonReportDraft.findMany({ where: { seasonId: { in: [s.id, ...(prev ? [prev.id] : [])] } } });
    const pick = (kind: SeasonReportKind) => {
      const own = rows.find((r) => r.seasonId === s.id && r.kind === kind);
      if (own) return { texts: own.texts as Record<string, string>, version: own.version, from: 'season' as const, updatedAt: own.updatedAt };
      const old = rows.find((r) => r.seasonId === prev?.id && r.kind === kind);
      return old ? { texts: old.texts as Record<string, string>, version: 0, from: 'previous' as const, updatedAt: null } : { texts: {}, version: 0, from: 'default' as const, updatedAt: null };
    };
    return { MORAL: pick('MORAL'), FINANCIAL: pick('FINANCIAL') };
  }

  saveDraft(seasonId: string, kind: SeasonReportKind, texts: Record<string, string>, userId: string) {
    return this.prisma.seasonReportDraft.upsert({
      where: { seasonId_kind: { seasonId, kind } },
      create: { seasonId, kind, texts: texts as Prisma.InputJsonValue, updatedById: userId },
      update: { texts: texts as Prisma.InputJsonValue, updatedById: userId, version: { increment: 1 } },
    });
  }
}
