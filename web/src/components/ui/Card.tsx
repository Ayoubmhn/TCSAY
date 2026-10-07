import type { HTMLAttributes, ReactNode } from 'react';
import { useTr } from '../../lib/i18n';

/** Carte (.card) : fond --card, bordure 1,5px, rayon 26px, padding 18px, colonne gap 10px, sans ombre. */
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-2.5 rounded-[26px] border-[1.5px] border-line bg-card p-[18px] ${className}`}
      {...props}
    />
  );
}

/** Ligne titre + pastille (.row). */
export function CardRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-2.5">{children}</div>;
}

/** Sous-titre de carte (.cs) : 13px 600 gris. */
export function CardSubtitle({ children }: { children: ReactNode }) {
  const tr = useTr();
  return <span className="text-[13px] font-semibold text-mut">{tr(children)}</span>;
}

/** Texte secondaire 13px gris. */
export function CardText({ children }: { children: ReactNode }) {
  return <span className="text-[13px] text-mut">{children}</span>;
}

/** Actions en bas de carte (.acts). */
export function CardActions({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-wrap gap-2 pt-1">{children}</div>;
}

/** KPI (.kpi) : 28px 600 chiffres tabulaires. */
export function Kpi({ children }: { children: ReactNode }) {
  return <span className="text-[28px] font-semibold leading-[1.1] tabular-nums">{children}</span>;
}

/** Grille de cartes (.cards) : auto-fill minmax(250px, 1fr), gap 14px, une colonne sous 560px. */
export function CardGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`grid grid-cols-1 gap-3.5 min-[561px]:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] ${className}`}>
      {children}
    </div>
  );
}

/** État vide (.empty) : bordure pointillée. */
export function EmptyState({ children }: { children: ReactNode }) {
  const tr = useTr();
  return (
    <div className="rounded-[24px] border-[1.5px] border-dashed border-line p-7 text-center text-mut">{tr(children)}</div>
  );
}
