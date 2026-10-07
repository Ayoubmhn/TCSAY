import type { ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';

/** En-tête d'écran (.head) : titre, sous-titre gris, élément à droite (bouton ou pastille). */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-end justify-between gap-3.5">
      <div>
        <h1>{t(title)}</h1>
        <p className="mt-1 text-mut">{t(subtitle)}</p>
      </div>
      {action}
    </div>
  );
}
