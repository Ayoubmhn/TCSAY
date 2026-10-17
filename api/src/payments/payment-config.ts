import { PaymentMethod, PaymentPlan } from '@prisma/client';

/**
 * Configuration des paiements du club (Setting `payment.config`, réglée par le président) : modes proposés et leurs
 * échéances, acompte, rappels et retards, encaissement. Les valeurs par défaut reproduisent le fonctionnement d'origine.
 * Dates « MM-JJ » (ex. « 02-01 » = 1er février), reportées sur l'année de la saison.
 */
export type PaymentConfig = {
  plans: Record<PaymentPlan, boolean>;
  defaultPlan: PaymentPlan;
  semester: { second: string; firstPercent: number };
  quarter: { second: string; third: string };
  /** Par mois : jour de paiement, premier et dernier mois (1-12, null = période de la saison). */
  monthly: { day: number; firstMonth: number | null; lastMonth: number | null };
  /** Acompte : montant du tarif ou pourcentage ; compris dans la 1re tranche ou tranche à part. */
  deposit: { enabled: boolean; mode: 'FEE' | 'PERCENT'; percent: number; inFirst: boolean };
  reminders: { beforeDays: number; graceDays: number; repeatDays: number; maxRepeats: number; email: boolean };
  collect: { methods: PaymentMethod[]; receiptRequired: boolean; multi: boolean; rounding: 'MILLIME' | 'DINAR' | 'FIVE' };
};

export const PAYMENT_CONFIG_KEY = 'payment.config';
export const PAYMENT_CONFIG = { refreshMs: 5 * 60 * 1000 };

export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
  plans: { FULL: true, SEMESTER: true, QUARTER: false, MONTHLY: true },
  defaultPlan: PaymentPlan.FULL,
  semester: { second: '02-01', firstPercent: 50 },
  quarter: { second: '01-05', third: '04-05' },
  monthly: { day: 5, firstMonth: null, lastMonth: null },
  deposit: { enabled: true, mode: 'FEE', percent: 20, inFirst: false },
  reminders: { beforeDays: 0, graceDays: 0, repeatDays: 0, maxRepeats: 3, email: false },
  collect: { methods: [PaymentMethod.CASH, PaymentMethod.CHEQUE], receiptRequired: false, multi: true, rounding: 'MILLIME' },
};

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const int = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const pick = <T>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const mmdd = (v: unknown, d: string) => (typeof v === 'string' && MMDD.test(v) ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const month = (v: unknown) => (v === null || v === undefined || v === '' ? null : int(v, 1, 12, 1));

/** Fusionne une configuration enregistrée (ou envoyée) avec les valeurs par défaut, bornes comprises. */
export function normalizePaymentConfig(raw: unknown): PaymentConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const d = DEFAULT_PAYMENT_CONFIG;
  const plansSrc = src.plans ?? {};
  const plans = Object.fromEntries((Object.keys(d.plans) as PaymentPlan[]).map((p) => [p, bool(plansSrc[p], d.plans[p])])) as Record<PaymentPlan, boolean>;
  if (!Object.values(plans).some(Boolean)) plans.FULL = true;
  let defaultPlan = pick(src.defaultPlan as unknown, Object.keys(d.plans) as PaymentPlan[], d.defaultPlan);
  if (!plans[defaultPlan]) defaultPlan = (Object.keys(plans) as PaymentPlan[]).find((p) => plans[p])!;
  const s = src.semester ?? {};
  const q = src.quarter ?? {};
  const m = src.monthly ?? {};
  const dep = src.deposit ?? {};
  const r = src.reminders ?? {};
  const c = src.collect ?? {};
  const methods = Array.isArray(c.methods)
    ? [...new Set((c.methods as unknown[]).filter((x): x is PaymentMethod => x === 'CASH' || x === 'CHEQUE' || x === 'TRANSFER'))]
    : d.collect.methods;
  return {
    plans,
    defaultPlan,
    semester: { second: mmdd(s.second, d.semester.second), firstPercent: int(s.firstPercent, 10, 90, d.semester.firstPercent) },
    quarter: { second: mmdd(q.second, d.quarter.second), third: mmdd(q.third, d.quarter.third) },
    monthly: { day: int(m.day, 1, 28, d.monthly.day), firstMonth: month(m.firstMonth), lastMonth: month(m.lastMonth) },
    deposit: {
      enabled: bool(dep.enabled, d.deposit.enabled),
      mode: pick(dep.mode, ['FEE', 'PERCENT'] as const, d.deposit.mode),
      percent: int(dep.percent, 0, 90, d.deposit.percent),
      inFirst: bool(dep.inFirst, d.deposit.inFirst),
    },
    reminders: {
      beforeDays: pick(Number(r.beforeDays), [0, 1, 3, 7], d.reminders.beforeDays),
      graceDays: pick(Number(r.graceDays), [0, 3, 7, 15], d.reminders.graceDays),
      repeatDays: pick(Number(r.repeatDays), [0, 7, 15], d.reminders.repeatDays),
      maxRepeats: int(r.maxRepeats, 0, 10, d.reminders.maxRepeats),
      email: bool(r.email, d.reminders.email),
    },
    collect: {
      methods: methods.length ? methods : [PaymentMethod.CASH],
      receiptRequired: bool(c.receiptRequired, d.collect.receiptRequired),
      multi: bool(c.multi, d.collect.multi),
      rounding: pick(c.rounding, ['MILLIME', 'DINAR', 'FIVE'] as const, d.collect.rounding),
    },
  };
}
