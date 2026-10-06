import type { ReactNode } from 'react';

/** En-tête d'écran de liste : titre, sous-titre « Découvrez vos … », action éventuelle. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="mt-1 text-mut">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
