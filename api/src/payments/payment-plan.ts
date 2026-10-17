import { DiscountKind, PaymentPlan } from '@prisma/client';
import { isoDay } from '../common/dates';
import { DEFAULT_PAYMENT_CONFIG, type PaymentConfig } from './payment-config';

export const PLAN_LABEL: Record<PaymentPlan, string> = {
  FULL: 'Comptant',
  SEMESTER: 'Par semestre',
  QUARTER: 'Par trimestre',
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

  const rawDeposit = !cfg.deposit.enabled ? 0 : cfg.deposit.mode === 'PERCENT' ? (total * cfg.deposit.percent) / 100 : feeDeposit;
  const dep = Math.min(Math.max(round3(unit > 0.001 ? Math.round(rawDeposit / unit) * unit : rawDeposit), 0), total);

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

  const out: { dueDate: string; amount: number }[] = [];
  if (dep > 0 && cfg.deposit.inFirst) {
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
