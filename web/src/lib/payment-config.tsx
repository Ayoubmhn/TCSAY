import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { PaymentConfig, PaymentPlan } from './types';

export const PLAN_LABEL: Record<PaymentPlan, string> = { FULL: 'Comptant', SEMESTER: 'Par semestre', QUARTER: 'Par trimestre', MONTHLY: 'Par mois' };
export const PLAN_HINT: Record<PaymentPlan, string> = {
  FULL: 'Comptant (une seule tranche)',
  SEMESTER: 'Par semestre (2 tranches)',
  QUARTER: 'Par trimestre (3 tranches)',
  MONTHLY: 'Par mois (une tranche par mois)',
};
export const PLANS: PaymentPlan[] = ['FULL', 'SEMESTER', 'QUARTER', 'MONTHLY'];
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Configuration des paiements (modes proposés…), partagée par les écrans d'inscription et d'encaissement. */
export function usePaymentConfig(enabled = true) {
  return useQuery({ queryKey: ['payment-config'], queryFn: () => api.get<PaymentConfig>('/payments/config'), enabled, staleTime: 60_000 });
}

/** Options des modes proposés par le club (tous tant que la configuration n'est pas chargée ; le mode courant reste visible). */
export function PlanOptions({ prefix = '', current, short = false }: { prefix?: string; current?: PaymentPlan | ''; short?: boolean }) {
  const cfg = usePaymentConfig();
  return (
    <>
      {PLANS.filter((p) => !cfg.data || cfg.data.plans[p] || p === current).map((p) => (
        <option key={p} value={p}>
          {prefix}
          {short ? PLAN_LABEL[p].toLowerCase() : PLAN_HINT[p]}
        </option>
      ))}
    </>
  );
}
