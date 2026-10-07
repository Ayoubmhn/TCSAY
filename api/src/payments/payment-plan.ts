import { PaymentPlan } from '@prisma/client';
import { isoDay } from '../common/dates';

export const PLAN_LABEL: Record<PaymentPlan, string> = {
  FULL: 'Comptant',
  SEMESTER: 'Par semestre',
  MONTHLY: 'Par mois',
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Répartit un montant en n parts au millime ; la dernière absorbe l'arrondi. */
function split(total: number, n: number): number[] {
  const base = Math.floor((total / n) * 1000) / 1000;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? round3(total - base * (n - 1)) : base));
}

const firstOfMonth = (y: number, m: number, day = 5) => isoDay(new Date(Date.UTC(y, m, day)));

/**
 * Échéancier d'une cotisation selon le mode choisi à l'inscription :
 * - comptant : une tranche, aujourd'hui ;
 * - par semestre : acompte éventuel aujourd'hui, puis 2 tranches (début de saison ou aujourd'hui, puis 5 mois après) ;
 * - par mois : acompte éventuel aujourd'hui, puis une tranche le 5 de chaque mois restant de la saison.
 * L'acompte est défini dans le tarif d'entraînement. Échéances modifiables ensuite par l'admin (R7).
 */
export function planInstallments(
  plan: PaymentPlan,
  total: number,
  deposit: number,
  season: { startDate: Date; endDate: Date },
  today: string,
): { dueDate: string; amount: number }[] {
  if (plan === PaymentPlan.FULL || total <= 0) return [{ dueDate: today, amount: round3(total) }];

  const out: { dueDate: string; amount: number }[] = [];
  const dep = Math.min(Math.max(deposit, 0), total);
  if (dep > 0) out.push({ dueDate: today, amount: round3(dep) });
  const rest = round3(total - dep);
  if (rest <= 0) return out;

  const start = isoDay(season.startDate) > today ? isoDay(season.startDate) : today;
  const [sy, sm] = start.split('-').map(Number);

  if (plan === PaymentPlan.SEMESTER) {
    const s0 = season.startDate;
    const second = firstOfMonth(s0.getUTCFullYear(), s0.getUTCMonth() + 5, 1);
    const dues = second > start ? [start, second] : [start];
    split(rest, dues.length).forEach((amount, i) => out.push({ dueDate: dues[i], amount }));
    return out;
  }

  // Par mois : du mois en cours (ou du début de saison) jusqu'au dernier mois de la saison.
  const end = season.endDate;
  const months: string[] = [];
  const [ey, em] = [end.getUTCFullYear(), end.getUTCMonth()];
  let [y, m] = [sy, sm - 1];
  while (y < ey || (y === ey && m <= em)) {
    const due = firstOfMonth(y, m);
    months.push(due < today ? today : due);
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  const dues = months.length ? months : [start];
  split(rest, dues.length).forEach((amount, i) => out.push({ dueDate: dues[i], amount }));
  return out;
}
