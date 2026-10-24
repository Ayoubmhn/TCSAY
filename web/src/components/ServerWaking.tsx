import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';

/** Vrai quand `active` dure plus de `ms` (ex. une requête qui ne répond pas encore). */
export function useSlow(active: boolean, ms = 4000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return slow;
}

/**
 * Serveur endormi (hébergement gratuit : réveil en 30 à 60 s après une période sans visite) : on l'explique au lieu de
 * laisser croire que l'application est bloquée.
 */
export function ServerWaking({ active }: { active: boolean }) {
  const { t } = useI18n();
  if (!useSlow(active)) return null;
  return (
    <p role="status" className="max-w-sm text-center text-[13px] text-mut">
      {t('Le serveur se réveille : la première ouverture peut prendre jusqu’à une minute. Merci de patienter.')}
    </p>
  );
}
