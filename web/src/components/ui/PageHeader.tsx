import type { ReactNode } from 'react';

/** En-tête d'écran (.head) : titre, sous-titre gris, élément à droite (bouton ou pastille). */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3.5">
      <div>
        <h1>{title}</h1>
        <p className="mt-1 text-mut">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
