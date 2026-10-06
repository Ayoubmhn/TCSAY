import type { HTMLAttributes, ReactNode } from 'react';

/** Carte : fond --card, bordure 1,5px --line, rayon 24px, sans ombre. */
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-[24px] border-[1.5px] border-line bg-card p-5 ${className}`} {...props} />;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-base font-medium">{children}</h3>;
}

export function CardSubtitle({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-semibold text-mut">{children}</p>;
}

/** Grille de cartes : repeat(auto-fill, minmax(250px, 1fr)), une colonne sur mobile. */
export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">{children}</div>;
}
