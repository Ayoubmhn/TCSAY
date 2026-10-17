import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { PaymentConfig, PaymentPlan, PaymentTemplate } from './types';

export const PLAN_LABEL: Record<PaymentPlan, string> = { FULL: 'Comptant', SEMESTER: 'Par semestre', QUARTER: 'Par trimestre', MONTHLY: 'Par mois', CUSTOM: 'Modèle du club' };
export const PLAN_HINT: Record<PaymentPlan, string> = {
  FULL: 'Comptant (une seule tranche)',
  SEMESTER: 'Par semestre (2 tranches)',
  QUARTER: 'Par trimestre (3 tranches)',
  MONTHLY: 'Par mois (une tranche par mois)',
  CUSTOM: 'Modèle du club',
};
export const PLANS: PaymentPlan[] = ['FULL', 'SEMESTER', 'QUARTER', 'MONTHLY'];

/** Valeur d'un choix de mode : un mode, ou « CUSTOM:<id> » pour un modèle du club. */
export type PlanValue = PaymentPlan | `CUSTOM:${string}`;
export const planValue = (m?: { paymentPlan: PaymentPlan; templateId?: string | null } | null): PlanValue | '' =>
  !m ? '' : m.paymentPlan === 'CUSTOM' && m.templateId ? `CUSTOM:${m.templateId}` : m.paymentPlan;
export const splitPlan = (v: string): { paymentPlan: PaymentPlan; templateId?: string } =>
  v.startsWith('CUSTOM:') ? { paymentPlan: 'CUSTOM', templateId: v.slice(7) } : { paymentPlan: v as PaymentPlan };

/** Modèles d'échéancier du club (actifs et archivés). */
export function usePaymentTemplates(enabled = true) {
  return useQuery({ queryKey: ['payment-templates'], queryFn: () => api.get<PaymentTemplate[]>('/payments/templates'), enabled, staleTime: 60_000 });
}
export const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Configuration des paiements (modes proposés…), partagée par les écrans d'inscription et d'encaissement. */
export function usePaymentConfig(enabled = true) {
  return useQuery({ queryKey: ['payment-config'], queryFn: () => api.get<PaymentConfig>('/payments/config'), enabled, staleTime: 60_000 });
}

/** Options des modes proposés par le club (tous tant que la configuration n'est pas chargée ; le mode courant reste visible). */
export function PlanOptions({
  prefix = '',
  current,
  short = false,
  templates = false,
  family,
}: {
  prefix?: string;
  current?: string;
  short?: boolean;
  /** Ajoute les modèles du club (fiche joueur). */
  templates?: boolean;
  /** Famille de la catégorie du joueur : seuls les modèles adaptés (compétition / loisirs). */
  family?: string;
}) {
  const cfg = usePaymentConfig();
  const tpl = usePaymentTemplates(templates);
  const fits = (t: PaymentTemplate) => !family || t.scope === 'ALL' || (t.scope === 'LEISURE') === (family === 'LEISURE');
  const list = (tpl.data ?? []).filter((t) => (!t.archivedAt && fits(t)) || `CUSTOM:${t.id}` === current);
  const standard = PLANS.filter((p) => !cfg.data || cfg.data.plans[p] || p === current).map((p) => (
    <option key={p} value={p}>
      {prefix}
      {short ? PLAN_LABEL[p].toLowerCase() : PLAN_HINT[p]}
    </option>
  ));
  if (!templates || !list.length || (cfg.data && !cfg.data.plans.CUSTOM && !current?.startsWith('CUSTOM:'))) return <>{standard}</>;
  return (
    <>
      <optgroup label="Modes">{standard}</optgroup>
      <optgroup label="Modèles du club">
        {list.map((t) => (
          <option key={t.id} value={`CUSTOM:${t.id}`}>
            {t.name}
            {t.visible ? '' : ' (sur accord du bureau)'}
            {t.archivedAt ? ' (archivé)' : ''}
          </option>
        ))}
      </optgroup>
    </>
  );
}
