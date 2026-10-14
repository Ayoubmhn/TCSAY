import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DiscountKind, PaymentMethod, PaymentPlan, Prisma } from '@prisma/client';
import { IsOptional, IsUUID } from 'class-validator';
import { AccessService } from '../access/access.service';
import { Perm } from '../auth/auth-user';
import { addDaysIso, dayFromIso, isoDay, localDayOf, pad, todayIso } from '../common/dates';
import { num } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

const round = (n: number) => Math.round(n * 1000) / 1000;
const DAY = 86_400_000;

class FinanceQuery {
  @IsOptional()
  @IsUUID()
  seasonId?: string;
}

/** « 2026-10 » d'un jour calendaire (colonne DATE). */
const monthOfDay = (d: Date) => isoDay(d).slice(0, 7);
/** « 2026-10 » d'un instant (heure du club). */
const monthOfInstant = (d: Date) => localDayOf(d).slice(0, 7);
/** Mois suivant : « 2026-12 » → « 2027-01 ». */
function nextMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
}
/** Même mois l'année précédente. */
const lastYear = (m: string) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
/** Jours entre deux jours calendaires « AAAA-MM-JJ ». */
const daysBetween = (from: string, to: string) => Math.round((dayFromIso(to).getTime() - dayFromIso(from).getTime()) / DAY);

type PaymentRow = { amount: Prisma.Decimal; kind: string; method: PaymentMethod; paidAt: Date };

/**
 * Statistiques financières d'une saison (saison active par défaut) :
 * encaissements par mois comparés à la saison précédente, prévision des échéances,
 * retards par ancienneté et familles à relancer, coût des réductions, modes de paiement, bilan recettes − salaires.
 */
@ApiTags('Dashboard')
@ApiBearerAuth()
@Perm('stats.view')
@Controller('stats/finances')
export class FinanceStatsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async finances(@Query() query: FinanceQuery) {
    const season = await this.access.seasonOrActive(query.seasonId);
    const previous = await this.prisma.season.findFirst({
      where: { archivedAt: null, startDate: { lt: season.startDate } },
      orderBy: { startDate: 'desc' },
    });
    const today = todayIso();

    const [memberships, salaries, reservations, prevPayments, prevReservations] = await Promise.all([
      this.prisma.membership.findMany({
        where: { enrollment: { seasonId: season.id } },
        include: {
          installments: { include: { payments: { select: { amount: true, kind: true, method: true, paidAt: true } } }, orderBy: { number: 'asc' } },
          enrollment: {
            select: {
              player: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  memberCode: true,
                  archivedAt: true,
                  email: true,
                  parentLinks: { where: { parent: { isActive: true } }, select: { parent: { select: { firstName: true, lastName: true, email: true, phone: true } } } },
                },
              },
            },
          },
        },
      }),
      this.prisma.salary.findMany({ where: { seasonId: season.id }, select: { amount: true, paidAt: true } }),
      this.reservationsOf(season),
      previous
        ? this.prisma.payment.findMany({
            where: { installment: { membership: { enrollment: { seasonId: previous.id } } } },
            select: { amount: true, kind: true, method: true, paidAt: true },
          })
        : Promise.resolve([] as PaymentRow[]),
      previous ? this.reservationsOf(previous) : Promise.resolve([]),
    ]);

    // ── Encaissements par mois (cotisations, réservations), saison précédente au même mois ──
    const payments: PaymentRow[] = memberships.flatMap((m) => m.installments.flatMap((i) => i.payments));
    const sumBy = <T>(rows: T[], key: (r: T) => string, value: (r: T) => number) => {
      const map = new Map<string, number>();
      for (const r of rows) map.set(key(r), (map.get(key(r)) ?? 0) + value(r));
      return map;
    };
    const cotisByMonth = sumBy(payments, (p) => monthOfInstant(p.paidAt), (p) => num(p.amount));
    const resByMonth = sumBy(reservations, (r) => monthOfInstant(r.startTime), (r) => num(r.price));
    const prevByMonth = sumBy(prevPayments, (p) => monthOfInstant(p.paidAt), (p) => num(p.amount));
    for (const [m, v] of sumBy(prevReservations, (r) => monthOfInstant(r.startTime), (r) => num(r.price))) prevByMonth.set(m, (prevByMonth.get(m) ?? 0) + v);

    let first = monthOfDay(season.leisureStartDate && season.leisureStartDate < season.startDate ? season.leisureStartDate : season.startDate);
    const known = [...cotisByMonth.keys()].sort();
    if (known.length && known[0] < first) first = known[0];
    let last = monthOfDay(season.endDate);
    if (known.length && known[known.length - 1] > last) last = known[known.length - 1];
    const months: { month: string; cotisations: number; reservations: number; previous: number | null }[] = [];
    for (let m = first; m <= last && months.length < 24; m = nextMonth(m)) {
      months.push({
        month: m,
        cotisations: round(cotisByMonth.get(m) ?? 0),
        reservations: round(resByMonth.get(m) ?? 0),
        previous: previous ? round(prevByMonth.get(lastYear(m)) ?? 0) : null,
      });
    }

    // ── Tranches : dû, encaissé, retards, prévision ──
    const aging = { lt30: { count: 0, amount: 0 }, d30to60: { count: 0, amount: 0 }, gt60: { count: 0, amount: 0 } };
    const forecast = { d30: 0, d60: 0, d90: 0, later: 0 };
    const families = new Map<
      string,
      { playerId: string; name: string; code: string | null; contact: string | null; phone: string | null; canEmail: boolean; amount: number; installments: number; daysLate: number; oldestInstallmentId: string; oldestDue: string }
    >();
    let due = 0;
    let cashed = 0;
    for (const m of memberships) {
      const player = m.enrollment.player;
      for (const i of m.installments) {
        const paid = i.payments.reduce((t, p) => t + num(p.amount), 0);
        due += num(i.amount);
        cashed += paid;
        const remaining = round(num(i.amount) - paid);
        if (remaining <= 0 || player.archivedAt) continue;
        const dueDay = isoDay(i.dueDate);
        const delta = daysBetween(today, dueDay); // > 0 : à venir ; < 0 : en retard
        if (delta >= 0) {
          if (delta <= 30) forecast.d30 += remaining;
          else if (delta <= 60) forecast.d60 += remaining;
          else if (delta <= 90) forecast.d90 += remaining;
          else forecast.later += remaining;
          continue;
        }
        const late = -delta;
        const bucket = late < 30 ? aging.lt30 : late <= 60 ? aging.d30to60 : aging.gt60;
        bucket.count++;
        bucket.amount += remaining;
        const parent = player.parentLinks[0]?.parent;
        const f = families.get(player.id) ?? {
          playerId: player.id,
          name: `${player.firstName} ${player.lastName}`.trim(),
          code: player.memberCode,
          contact: parent ? `${parent.firstName} ${parent.lastName}`.trim() : null,
          phone: parent?.phone ?? null,
          canEmail: Boolean(player.parentLinks.find((l) => l.parent.email)?.parent.email ?? player.email),
          amount: 0,
          installments: 0,
          daysLate: 0,
          oldestInstallmentId: i.id,
          oldestDue: dueDay,
        };
        f.amount += remaining;
        f.installments++;
        if (late > f.daysLate) {
          f.daysLate = late;
          f.oldestInstallmentId = i.id;
          f.oldestDue = dueDay;
        }
        families.set(player.id, f);
      }
    }

    // ── Réductions ──
    const discounts: Record<DiscountKind, { count: number; amount: number }> = {
      SIBLING: { count: 0, amount: 0 },
      SPECIAL: { count: 0, amount: 0 },
      EXEMPT: { count: 0, amount: 0 },
    };
    let baseTotal = 0;
    for (const m of memberships) {
      const base = m.baseAmount !== null ? num(m.baseAmount) : num(m.totalAmount);
      baseTotal += base;
      if (!m.discountKind) continue;
      discounts[m.discountKind].count++;
      discounts[m.discountKind].amount += Math.max(0, base - num(m.totalAmount));
    }
    const discountTotal = Object.values(discounts).reduce((t, d) => t + d.amount, 0);

    // ── Modes de paiement et échéanciers ──
    const methods: Record<PaymentMethod, { count: number; amount: number }> = {
      CASH: { count: 0, amount: 0 },
      CHEQUE: { count: 0, amount: 0 },
      ONLINE: { count: 0, amount: 0 },
    };
    let refunds = 0;
    for (const p of payments) {
      if (p.kind !== 'PAYMENT') {
        refunds += num(p.amount);
        continue;
      }
      methods[p.method].count++;
      methods[p.method].amount += num(p.amount);
    }
    const plans: Record<PaymentPlan, number> = { FULL: 0, SEMESTER: 0, MONTHLY: 0 };
    for (const m of memberships) plans[m.paymentPlan]++;

    // ── Comparaison : saison active = encaissé l'an passé à la même date ; autre saison = total de la précédente ──
    const sameDayLastYear = addDaysIso(today, -365);
    const toDate = season.status === 'ACTIVE';
    const prevCashedToDate = previous
      ? prevPayments.filter((p) => !toDate || localDayOf(p.paidAt) <= sameDayLastYear).reduce((t, p) => t + num(p.amount), 0)
      : null;

    const reservationsTotal = reservations.reduce((t, r) => t + num(r.price), 0);
    const salariesPaid = salaries.filter((s) => s.paidAt).reduce((t, s) => t + num(s.amount), 0);
    const salariesDue = salaries.filter((s) => !s.paidAt).reduce((t, s) => t + num(s.amount), 0);
    // Dépenses (factures, déclarations) payées ou à payer dans la période de la saison.
    const expenses = await this.prisma.expense.findMany({
      where: { archivedAt: null, date: { gte: season.startDate, lte: season.endDate } },
      select: { amount: true, paidAt: true },
    });
    const expensesPaid = expenses.filter((e) => e.paidAt).reduce((t, e) => t + num(e.amount), 0);
    const expensesDue = expenses.filter((e) => !e.paidAt).reduce((t, e) => t + num(e.amount), 0);
    const roundAll = <T extends Record<string, { count: number; amount: number }>>(o: T) =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { count: v.count, amount: round(v.amount) }])) as T;

    return {
      season: { id: season.id, label: season.label, status: season.status },
      previous: previous ? { id: previous.id, label: previous.label } : null,
      today,
      summary: {
        due: round(due),
        cashed: round(cashed),
        remaining: round(Math.max(0, due - cashed)),
        rate: due > 0 ? Math.round((cashed / due) * 100) : null,
        memberships: memberships.length,
        prevCashedToDate: prevCashedToDate === null ? null : round(prevCashedToDate),
        comparedToDate: toDate,
      },
      months,
      forecast: { d30: round(forecast.d30), d60: round(forecast.d60), d90: round(forecast.d90), later: round(forecast.later) },
      aging: roundAll(aging),
      toRemind: [...families.values()].map((f) => ({ ...f, amount: round(f.amount) })).sort((a, b) => b.amount - a.amount || b.daysLate - a.daysLate),
      discounts: { byKind: roundAll(discounts), total: round(discountTotal), base: round(baseTotal) },
      methods: roundAll(methods),
      refunds: round(refunds),
      plans,
      balance: {
        cotisations: round(cashed),
        reservations: round(reservationsTotal),
        salariesPaid: round(salariesPaid),
        salariesDue: round(salariesDue),
        expensesPaid: round(expensesPaid),
        expensesDue: round(expensesDue),
        net: round(cashed + reservationsTotal - salariesPaid - expensesPaid),
      },
    };
  }

  /** Réservations non annulées de la saison (montant réservé : non encaissé dans l'application). */
  private reservationsOf(season: { startDate: Date; endDate: Date; leisureStartDate: Date | null }) {
    const start = season.leisureStartDate && season.leisureStartDate < season.startDate ? season.leisureStartDate : season.startDate;
    return this.prisma.reservation.findMany({
      where: { cancelledAt: null, startTime: { gte: start, lt: new Date(season.endDate.getTime() + DAY) } },
      select: { price: true, startTime: true },
    });
  }
}
