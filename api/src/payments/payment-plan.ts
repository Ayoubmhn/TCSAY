import { DiscountKind, PaymentPlan } from '@prisma/client';
import { isoDay } from '../common/dates';
import { DEFAULT_PAYMENT_CONFIG, type PaymentConfig } from './payment-config';

export const PLAN_LABEL: Record<PaymentPlan, string> = {
  FULL: 'Comptant',
  SEMESTER: 'Par semestre',
  QUARTER: 'Par trimestre',
  CUSTOM: 'Modèle du club',
  MONTHLY: 'Par mois',
};

export const DISCOUNT_LABEL: Record<DiscountKind, string> = {
  SIBLING: 'Réduction fratrie',
  SPECIAL: 'Réduction spéciale',
  EXEMPT: 'Exonération',
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

const UNIT = { MILLIME: 0.001, DINAR: 1, FIVE: 5 } as const;

/** Répartit un montant selon des poids, arrondi à l'unité choisie ; la dernière part absorbe l'arrondi. */
function splitWeighted(total: number, weights: number[], unit: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w, i) => (i === weights.length - 1 ? 0 : round3(Math.floor(((total * w) / sum) / unit) * unit)));
  // Montant trop petit pour l'arrondi choisi : répartition au millime.
  if (unit > 0.001 && parts.slice(0, -1).some((x) => x <= 0)) return splitWeighted(total, weights, 0.001);
  parts[parts.length - 1] = round3(total - parts.slice(0, -1).reduce((a, b) => a + b, 0));
  return parts;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(d, last))}`;
};

/** Prochaine date « MM-JJ » strictement après `after` et au plus tard `end` (années de la période). */
function nextOccurrence(mmdd: string, after: string, end: string): string | null {
  const [m, d] = mmdd.split('-').map(Number);
  const y0 = Number(after.slice(0, 4));
  for (const y of [y0, y0 + 1, y0 + 2]) {
    const c = ymd(y, m, d);
    if (c > after && c <= end) return c;
  }
  return null;
}

/**
 * Échéancier d'une cotisation selon le mode choisi et la configuration du club (Réglages › Configuration des paiements) :
 * - comptant : une tranche, aujourd'hui ;
 * - par semestre : début de saison (ou aujourd'hui) puis la date réglée (ex. 1er février), répartition réglée ;
 * - par trimestre : début de saison (ou aujourd'hui) puis les deux dates réglées (ex. 5 janvier, 5 avril) ;
 * - par mois : une tranche le jour réglé de chaque mois, du premier au dernier mois réglés (sinon la période de la saison).
 * Acompte (montant du tarif ou pourcentage) : tranche à part aujourd'hui, ou compris dans la 1re tranche.
 * Les dates déjà passées sont ramenées à aujourd'hui ; arrondi réglable, l'écart va sur la dernière tranche.
 */
export function planInstallments(
  plan: PaymentPlan,
  total: number,
  feeDeposit: number,
  season: { startDate: Date; endDate: Date },
  today: string,
  cfg: PaymentConfig = DEFAULT_PAYMENT_CONFIG,
): { dueDate: string; amount: number }[] {
  if (plan === PaymentPlan.FULL || total <= 0) return [{ dueDate: today, amount: round3(total) }];
  const unit = UNIT[cfg.collect.rounding];

  const dep = depositOf(total, feeDeposit, cfg);

  const periodStart = isoDay(season.startDate);
  const end = isoDay(season.endDate);
  const start = periodStart > today ? periodStart : today;

  // Échéances et poids selon le mode.
  let dues: string[];
  let weights: number[];
  if (plan === PaymentPlan.SEMESTER) {
    const second = nextOccurrence(cfg.semester.second, start, end);
    dues = second ? [start, second] : [start];
    weights = second ? [cfg.semester.firstPercent, 100 - cfg.semester.firstPercent] : [1];
  } else if (plan === PaymentPlan.QUARTER) {
    const q2 = nextOccurrence(cfg.quarter.second, start, end);
    const q3 = q2 ? nextOccurrence(cfg.quarter.third, q2, end) : nextOccurrence(cfg.quarter.third, start, end);
    dues = [start, ...[q2, q3].filter((x): x is string => Boolean(x))];
    weights = dues.map(() => 1);
  } else {
    // Par mois : du premier mois réglé (ou début de la période) au dernier mois réglé (ou fin de la période).
    const [py, pm] = periodStart.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    const fm = cfg.monthly.firstMonth;
    const lm = cfg.monthly.lastMonth;
    let [y, m] = fm ? [fm >= pm ? py : py + 1, fm] : [py, pm];
    const [ly, lmo] = lm ? [lm <= em ? ey : ey - 1, lm] : [ey, em];
    const [ty, tm] = today.split('-').map(Number);
    dues = [];
    while (y < ly || (y === ly && m <= lmo)) {
      // Mois déjà écoulés : pas de tranche (l'inscription en cours d'année ne paie que les mois restants).
      if (y > ty || (y === ty && m >= tm)) {
        const due = ymd(y, m, cfg.monthly.day);
        dues.push(due < today ? today : due);
      }
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    if (!dues.length) dues = [start];
    weights = dues.map(() => 1);
  }

  return finish(total, dep, dues, weights, today, unit, cfg.deposit.inFirst);
}

/** Acompte selon la configuration (montant du tarif ou pourcentage), arrondi comme les tranches. */
function depositOf(total: number, feeDeposit: number, cfg: PaymentConfig) {
  const unit = UNIT[cfg.collect.rounding];
  const raw = !cfg.deposit.enabled ? 0 : cfg.deposit.mode === 'PERCENT' ? (total * cfg.deposit.percent) / 100 : feeDeposit;
  return Math.min(Math.max(round3(unit > 0.001 ? Math.round(raw / unit) * unit : raw), 0), total);
}

/** Acompte (tranche à part aujourd'hui ou compris dans la 1re) puis répartition du reste sur les échéances. */
function finish(total: number, dep: number, dues: string[], weights: number[], today: string, unit: number, inFirst: boolean) {
  const out: { dueDate: string; amount: number }[] = [];
  if (dep > 0 && inFirst) {
    // Acompte compris dans la 1re tranche, payée à l'inscription : au moins le montant de l'acompte.
    let parts = splitWeighted(total, weights, unit);
    if (parts[0] < dep && parts.length > 1) parts = [dep, ...splitWeighted(round3(total - dep), weights.slice(1), unit)];
    parts.forEach((amount, i) => out.push({ dueDate: i === 0 ? today : dues[i], amount }));
    return out;
  }
  if (dep > 0) out.push({ dueDate: today, amount: dep });
  const rest = round3(total - dep);
  if (rest <= 0) return out;
  splitWeighted(rest, weights, unit).forEach((amount, i) => out.push({ dueDate: dues[i], amount }));
  return out;
}

export type TemplateLine = { date: string; mode: 'PERCENT' | 'AMOUNT' | 'REST'; value: number };
export type TemplateSpec = {
  kind: string;
  lines: TemplateLine[];
  monthlyDay: number;
  months: number[];
  deposit: boolean;
  lateMode: string;
};

/**
 * Échéancier d'un modèle du club :
 * - dates fixes : chaque tranche « À l'inscription » (aujourd'hui) ou à une date « MM-JJ » de la saison, part en %,
 *   montant fixe ou « le reste » ; tranches déjà passées regroupées dans une tranche aujourd'hui (MERGE) ou réparties
 *   sur les suivantes (SPREAD) ;
 * - mensuel : le jour réglé des mois cochés de la saison (mois écoulés non comptés), acompte de la configuration au choix.
 */
export function templateInstallments(
  tpl: TemplateSpec,
  total: number,
  feeDeposit: number,
  season: { startDate: Date; endDate: Date },
  today: string,
  cfg: PaymentConfig = DEFAULT_PAYMENT_CONFIG,
): { dueDate: string; amount: number }[] {
  if (total <= 0) return [{ dueDate: today, amount: round3(total) }];
  const unit = UNIT[cfg.collect.rounding];
  const periodStart = isoDay(season.startDate);
  const end = isoDay(season.endDate);

  if (tpl.kind === 'MONTHLY') {
    const [py, pm] = periodStart.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    const [ty, tm] = today.split('-').map(Number);
    const dues: string[] = [];
    let [y, m] = [py, pm];
    while (y < ey || (y === ey && m <= em)) {
      if (tpl.months.includes(m) && (y > ty || (y === ty && m >= tm))) {
        const due = ymd(y, m, tpl.monthlyDay);
        dues.push(due < today ? today : due);
      }
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    if (!dues.length) dues.push(periodStart > today ? periodStart : today);
    const dep = tpl.deposit ? depositOf(total, feeDeposit, cfg) : 0;
    return finish(total, dep, dues, dues.map(() => 1), today, unit, cfg.deposit.inFirst);
  }

  // Dates fixes : date de chaque tranche dans la saison, puis montant.
  const dayBefore = new Date(Date.parse(periodStart + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
  const lines = tpl.lines.map((l) => ({
    ...l,
    due: l.date === 'ENROLL' ? today : (nextOccurrence(l.date, dayBefore, end) ?? nextOccurrence(l.date, dayBefore, '9999-12-31')!),
  }));
  const floorU = (n: number) => round3(Math.floor(n / unit) * unit);
  const amounts = lines.map((l) => (l.mode === 'PERCENT' ? floorU((total * l.value) / 100) : l.mode === 'AMOUNT' ? Math.min(l.value, total) : 0));
  const restIndex = lines.findIndex((l) => l.mode === 'REST');
  const fixedSum = amounts.reduce((a, b) => a + b, 0);
  const absorb = restIndex >= 0 ? restIndex : lines.length - 1;
  amounts[absorb] = round3(Math.max(0, total - (fixedSum - (restIndex >= 0 ? 0 : amounts[absorb]))));
  // Total dépassé (montants fixes trop grands) : on tronque dans l'ordre.
  let left = total;
  const parts = lines.map((l, i) => {
    const a = round3(Math.min(amounts[i], left));
    left = round3(left - a);
    return { due: l.due, amount: a };
  });
  if (left > 0) parts[parts.length - 1].amount = round3(parts[parts.length - 1].amount + left);
  const sorted = parts.filter((p) => p.amount > 0).sort((a, b) => a.due.localeCompare(b.due));

  // Tranches déjà passées (inscription tardive).
  const past = sorted.filter((p) => p.due < today);
  const now = sorted.filter((p) => p.due === today);
  const future = sorted.filter((p) => p.due > today);
  const pastSum = round3(past.reduce((t, p) => t + p.amount, 0) );
  const out: { dueDate: string; amount: number }[] = [];
  if (tpl.lateMode === 'SPREAD' && future.length) {
    const nowSum = round3(now.reduce((t, p) => t + p.amount, 0));
    if (nowSum > 0) out.push({ dueDate: today, amount: nowSum });
    const extra = splitWeighted(pastSum, future.map(() => 1), unit);
    future.forEach((p, i) => out.push({ dueDate: p.due, amount: round3(p.amount + (pastSum > 0 ? extra[i] : 0)) }));
  } else {
    const first = round3(pastSum + now.reduce((t, p) => t + p.amount, 0));
    if (first > 0) out.push({ dueDate: today, amount: first });
    future.forEach((p) => out.push({ dueDate: p.due, amount: p.amount }));
  }
  return out.length ? out : [{ dueDate: today, amount: round3(total) }];
}

/** Contrôle d'un modèle avant enregistrement ; renvoie le message d'erreur ou null. */
export function templateError(tpl: TemplateSpec): string | null {
  if (tpl.kind === 'MONTHLY') return tpl.months.length ? null : 'Cochez au moins un mois.';
  if (!tpl.lines.length) return 'Ajoutez au moins une tranche.';
  if (tpl.lines.length > 12) return '12 tranches au plus.';
  const rests = tpl.lines.filter((l) => l.mode === 'REST').length;
  if (rests > 1) return 'Une seule tranche « Le reste ».';
  const pct = tpl.lines.filter((l) => l.mode === 'PERCENT').reduce((t, l) => t + l.value, 0);
  if (pct > 100.0001) return `Total des pourcentages ${pct} % : 100 % au plus.`;
  if (!rests && tpl.lines.some((l) => l.mode === 'AMOUNT')) return 'Avec un montant fixe, ajoutez une tranche « Le reste ».';
  if (!rests && Math.abs(pct - 100) > 0.0001) return `Total ${pct} % : il faut 100 %, ou une tranche « Le reste ».`;
  return null;
}
