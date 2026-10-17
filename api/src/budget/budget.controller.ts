import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExpenseCategory, HistoricalKind } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { addDaysIso, dayFromIso, isoDay, localInstant, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { LOCKED_SEASON } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';
import { SeasonReportsService } from '../reports/season-reports.service';

/** Postes du budget : recettes et dépenses (les projets validés sont comptés à part, d'après leur devis). */
export const INCOME_POSTS = ['FEES', 'COURTS', 'TOURNAMENTS', 'DONATION', 'GRANT', 'RENTAL', 'OTHER'] as const;
export const EXPENSE_POSTS = ['SALARY', ...Object.keys(ExpenseCategory)] as string[];
const BALANCE_KEY = 'budget.balance';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

class LineDto {
  @IsIn(['INCOME', 'EXPENSE']) kind: HistoricalKind;
  @IsString() @MaxLength(30) category: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) amount: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}
class LinesDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => LineDto) lines: LineDto[];
}
class BalanceDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) amount: number;
  @Matches(DATE, { message: 'Date obligatoire.' }) date: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}
class ForecastQuery {
  @IsOptional() @IsIn(['include', 'half', 'exclude']) late?: 'include' | 'half' | 'exclude';
}

const month = (d: string) => d.slice(0, 7);
const addMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * Budget de la saison (prévu face au réel calculé depuis la base) et prévision de trésorerie mois par mois
 * (tranches à encaisser, dépenses et salaires à payer, projets validés). Lecture : « budget.manage » ou « stats.view ».
 */
@ApiTags('Projets et budget')
@ApiBearerAuth()
@Controller('budget')
export class BudgetController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: SeasonReportsService,
    private readonly audit: AuditService,
  ) {}

  @Get(':seasonId')
  @Perm('budget.manage', 'stats.view')
  async get(@Param('seasonId', ParseUUIDPipe) seasonId: string) {
    const season = await this.reports.season(seasonId);
    const prev = await this.reports.previous(season);
    const [lines, actual, previous, projects] = await Promise.all([
      this.prisma.budgetLine.findMany({ where: { seasonId } }),
      this.actual(season),
      prev ? this.actual(prev) : Promise.resolve(null),
      this.prisma.project.findMany({
        where: {
          archivedAt: null,
          status: { in: ['APPROVED', 'IN_PROGRESS', 'DONE'] },
          OR: [{ seasonId }, { seasonId: null, targetDate: { gte: season.startDate, lte: season.endDate } }],
        },
        select: { id: true, title: true, status: true, chosenQuote: { select: { amount: true } }, estimatedAmount: true, expenses: { where: { archivedAt: null, paidAt: { not: null } }, select: { amount: true } } },
      }),
    ]);
    const planned = (kind: HistoricalKind, category: string) => {
      const l = lines.find((x) => x.kind === kind && x.category === category);
      return l ? { amount: num(l.amount), note: l.note } : null;
    };
    const row = (kind: HistoricalKind, category: string) => ({
      category,
      planned: planned(kind, category)?.amount ?? null,
      note: planned(kind, category)?.note ?? null,
      actual: actual[kind][category] ?? 0,
      previous: previous ? previous[kind][category] ?? 0 : null,
    });
    const income = INCOME_POSTS.map((c) => row('INCOME', c));
    const expenses = EXPENSE_POSTS.map((c) => row('EXPENSE', c));
    const projectRows = projects.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      planned: p.chosenQuote ? num(p.chosenQuote.amount) : p.estimatedAmount !== null ? num(p.estimatedAmount) : 0,
      actual: r3(p.expenses.reduce((t, e) => t + num(e.amount), 0)),
    }));
    const sum = (rows: { planned: number | null }[]) => r3(rows.reduce((t, x) => t + (x.planned ?? 0), 0));
    const sumA = (rows: { actual: number }[]) => r3(rows.reduce((t, x) => t + x.actual, 0));
    const plannedIncome = sum(income);
    const plannedExpenses = r3(sum(expenses) + sum(projectRows));
    const actualIncome = sumA(income);
    const actualExpenses = r3(sumA(expenses) + sumA(projectRows));
    return {
      season: { id: season.id, label: season.label, status: season.status, startDate: isoDay(season.startDate), endDate: isoDay(season.endDate) },
      previous: prev ? { id: prev.id, label: prev.label } : null,
      locked: LOCKED_SEASON.includes(season.status as never),
      income,
      expenses,
      projects: projectRows,
      totals: {
        plannedIncome,
        plannedExpenses,
        plannedResult: r3(plannedIncome - plannedExpenses),
        actualIncome,
        actualExpenses,
        actualResult: r3(actualIncome - actualExpenses),
      },
      updatedAt: lines.reduce<Date | null>((m, l) => (!m || l.updatedAt > m ? l.updatedAt : m), null),
    };
  }

  /**
   * Réel d'une saison par poste : recettes (cotisations, terrains, tournois, autres recettes importées) et dépenses
   * (salaires versés, dépenses payées par catégorie hors projets ; les dépenses d'un projet sont comptées avec le projet).
   */
  private async actual(s: Awaited<ReturnType<SeasonReportsService['season']>>) {
    const m = await this.reports.money(s);
    const range = { gte: localInstant(isoDay(s.startDate), 0), lt: localInstant(addDaysIso(isoDay(s.endDate), 1), 0) };
    const projectSpent = await this.prisma.expense.groupBy({ by: ['category'], where: { archivedAt: null, projectId: { not: null }, paidAt: range }, _sum: { amount: true } });
    const income: Record<string, number> = { FEES: m.income.fees, COURTS: m.income.courts, TOURNAMENTS: m.income.tournaments };
    for (const o of m.income.other) income[o.category] = r3((income[o.category] ?? 0) + o.amount);
    const expenses: Record<string, number> = { SALARY: m.expenses.salaries };
    for (const c of m.expenses.categories) {
      const inProjects = num(projectSpent.find((p) => p.category === c.category)?._sum.amount ?? 0);
      expenses[c.category] = r3(Math.max(0, c.amount - inProjects));
    }
    return { INCOME: income, EXPENSE: expenses } as Record<HistoricalKind, Record<string, number>>;
  }

  /** Budget prévu de la saison (toutes les lignes remplacées) ; saison clôturée ou historique : lecture seule (R1). */
  @Put(':seasonId')
  @Perm('budget.manage')
  async save(@CurrentUser() actor: AuthUser, @Param('seasonId', ParseUUIDPipe) seasonId: string, @Body() dto: LinesDto) {
    const season = await this.reports.season(seasonId);
    if (LOCKED_SEASON.includes(season.status as never)) throw new BadRequestException(`R1 · La saison ${season.label} est verrouillée : son budget ne se modifie plus.`);
    for (const l of dto.lines) {
      const allowed = l.kind === 'INCOME' ? (INCOME_POSTS as readonly string[]) : EXPENSE_POSTS;
      if (!allowed.includes(l.category)) throw new BadRequestException(`Poste inconnu : ${l.category}.`);
    }
    const before = await this.prisma.budgetLine.findMany({ where: { seasonId } });
    const total = (rows: { kind: string; amount: unknown }[], k: string) => r3(rows.filter((r) => r.kind === k).reduce((t, r) => t + num(r.amount as number), 0));
    await this.prisma.$transaction([
      this.prisma.budgetLine.deleteMany({ where: { seasonId } }),
      this.prisma.budgetLine.createMany({
        data: dto.lines.filter((l) => l.amount > 0 || l.note?.trim()).map((l) => ({ seasonId, kind: l.kind, category: l.category, amount: l.amount, note: l.note?.trim() || null, updatedById: actor.id })),
      }),
    ]);
    await this.audit.log(actor.id, {
      action: 'Budget de la saison modifié',
      entity: 'BudgetLine',
      entityId: seasonId,
      target: `Saison ${season.label}`,
      before: before.length ? `Recettes ${dt(total(before, 'INCOME'))}, dépenses ${dt(total(before, 'EXPENSE'))}` : null,
      after: `Recettes ${dt(total(dto.lines, 'INCOME'))}, dépenses ${dt(total(dto.lines, 'EXPENSE'))}`,
    });
    return this.get(seasonId);
  }

  // ───────────────────────── Trésorerie ─────────────────────────

  private async balance(): Promise<{ amount: number; date: string; note: string | null; updatedAt: string | null } | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: BALANCE_KEY } });
    return row ? JSON.parse(row.value) : null;
  }

  /** Solde constaté (caisse + compte du club) à une date : point de départ de la prévision. */
  @Put('treasury/balance')
  @Perm('budget.manage')
  async setBalance(@CurrentUser() actor: AuthUser, @Body() dto: BalanceDto) {
    if (dto.date > todayIso()) throw new BadRequestException('La date du solde ne peut pas être dans le futur.');
    const before = await this.balance();
    const value = { amount: r3(dto.amount), date: dto.date, note: dto.note?.trim() || null, updatedAt: new Date().toISOString() };
    await this.prisma.setting.upsert({ where: { key: BALANCE_KEY }, create: { key: BALANCE_KEY, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
    await this.audit.log(actor.id, {
      action: 'Solde de trésorerie saisi',
      entity: 'Setting',
      entityId: BALANCE_KEY,
      target: 'Trésorerie',
      before: before ? `${dt(before.amount)} au ${before.date}` : null,
      after: `${dt(value.amount)} au ${value.date}`,
    });
    return value;
  }

  /**
   * Prévision sur 12 mois : solde de départ + encaissements et décaissements constatés depuis sa date = solde estimé
   * aujourd'hui ; puis chaque mois : tranches à encaisser (retards comptés au choix : en entier, à moitié ou pas),
   * dépenses non payées (échéance ou date), salaires à verser, reste des projets validés (devis choisi − déjà payé).
   */
  @Get('treasury/forecast')
  @Perm('budget.manage', 'stats.view')
  async forecast(@Query() q: ForecastQuery) {
    const late = q.late ?? 'half';
    const today = todayIso();
    const start = month(today);
    const end = addMonth(start, 11);
    const bal = await this.balance();
    const since = bal ? localInstant(bal.date, 0) : null;
    const [installments, expenses, salaries, projects, paidIn, paidOut, paidSal, courts] = await Promise.all([
      this.prisma.installment.findMany({
        where: { membership: { enrollment: { player: { archivedAt: null } } } },
        select: { amount: true, dueDate: true, payments: { select: { amount: true } } },
      }),
      this.prisma.expense.findMany({ where: { archivedAt: null, paidAt: null }, select: { label: true, amount: true, date: true, dueDate: true, projectId: true } }),
      this.prisma.salary.findMany({ where: { paidAt: null }, select: { month: true, amount: true } }),
      this.prisma.project.findMany({
        where: { archivedAt: null, status: { in: ['APPROVED', 'IN_PROGRESS'] } },
        select: { title: true, targetDate: true, chosenQuote: { select: { amount: true } }, estimatedAmount: true, expenses: { where: { archivedAt: null }, select: { amount: true } } },
      }),
      since ? this.prisma.payment.aggregate({ where: { paidAt: { gte: since } }, _sum: { amount: true } }) : null,
      since ? this.prisma.expense.aggregate({ where: { archivedAt: null, paidAt: { gte: dayFromIso(bal!.date) } }, _sum: { amount: true } }) : null,
      since ? this.prisma.salary.aggregate({ where: { paidAt: { gte: dayFromIso(bal!.date) } }, _sum: { amount: true } }) : null,
      since ? this.prisma.reservation.aggregate({ where: { cancelledAt: null, type: { in: ['LEISURE', 'PRIVATE'] }, startTime: { gte: since, lt: localInstant(today, 0) } }, _sum: { price: true } }) : null,
    ]);

    const months = Array.from({ length: 12 }, (_, i) => addMonth(start, i));
    const bucket = new Map(months.map((m) => [m, { month: m, in: 0, out: 0, items: [] as { label: string; amount: number; kind: 'in' | 'out'; late?: boolean }[] }]));
    const put = (m: string, amount: number, kind: 'in' | 'out', label: string, isLate = false) => {
      if (amount <= 0) return;
      const key = m < start ? start : m;
      const b = bucket.get(key);
      if (!b) return; // au-delà des 12 mois
      b[kind] = r3(b[kind] + amount);
      const same = b.items.find((x) => x.label === label && x.kind === kind);
      if (same) same.amount = r3(same.amount + amount);
      else b.items.push({ label, amount: r3(amount), kind, late: isLate });
    };

    let lateTotal = 0;
    for (const i of installments) {
      const rest = num(i.amount) - i.payments.reduce((t, p) => t + num(p.amount), 0);
      if (rest <= 0.0005) continue;
      const due = isoDay(i.dueDate);
      if (due < today) {
        lateTotal += rest;
        const factor = late === 'include' ? 1 : late === 'half' ? 0.5 : 0;
        put(start, rest * factor, 'in', 'Tranches en retard', true);
      } else put(month(due), rest, 'in', 'Tranches à encaisser');
    }
    for (const e of expenses) {
      const d = isoDay(e.dueDate ?? e.date);
      put(month(d), num(e.amount), 'out', e.projectId ? 'Dépenses de projets à payer' : 'Dépenses à payer');
    }
    for (const s of salaries) put(s.month, num(s.amount), 'out', 'Salaires à verser');
    for (const p of projects) {
      const budget = p.chosenQuote ? num(p.chosenQuote.amount) : num(p.estimatedAmount ?? 0);
      // Le reste du projet, moins les dépenses déjà enregistrées (payées ou non : ces dernières sont déjà comptées).
      const rest = budget - p.expenses.reduce((t, e) => t + num(e.amount), 0);
      put(p.targetDate ? month(isoDay(p.targetDate)) : start, rest, 'out', `Projet : ${p.title}`);
    }

    // Solde estimé aujourd'hui = solde saisi + encaissements − paiements depuis sa date.
    const estimated = bal
      ? r3(bal.amount + num(paidIn?._sum.amount ?? 0) + num(courts?._sum.price ?? 0) - num(paidOut?._sum.amount ?? 0) - num(paidSal?._sum.amount ?? 0))
      : null;
    let running = estimated ?? 0;
    const rows = months.map((m) => {
      const b = bucket.get(m)!;
      running = r3(running + b.in - b.out);
      return { ...b, items: b.items.sort((x, y) => y.amount - x.amount), balance: running };
    });
    const negative = rows.find((r) => r.balance < 0);
    return {
      balance: bal,
      estimated,
      since: bal
        ? {
            received: r3(num(paidIn?._sum.amount ?? 0) + num(courts?._sum.price ?? 0)),
            paid: r3(num(paidOut?._sum.amount ?? 0) + num(paidSal?._sum.amount ?? 0)),
          }
        : null,
      late,
      lateTotal: r3(lateTotal),
      months: rows,
      end,
      firstNegative: bal && negative ? negative.month : null,
      lowest: rows.length ? rows.reduce((m, r) => (r.balance < m.balance ? r : m), rows[0]) : null,
    };
  }
}
