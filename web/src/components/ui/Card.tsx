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
  return <div className="card-row flex items-center justify-between gap-2.5">{children}</div>;
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
  return <div className="card-actions mt-auto flex flex-wrap gap-2 pt-1">{children}</div>;
}

/** KPI (.kpi) : 28px 600 chiffres tabulaires. */
export function Kpi({ children }: { children: ReactNode }) {
  return <span className="text-[28px] font-semibold leading-[1.1] tabular-nums">{children}</span>;
}

/**
 * Grille de cartes (.cards) : auto-fill minmax(250px, 1fr), gap 14px, une colonne sous 560px.
 * `list` : mêmes cartes en lignes compactes (une par ligne, contenu à l'horizontale, actions à droite) ; pas de tableau HTML.
 */
export function CardGrid({ children, className = '', list = false }: { children: ReactNode; className?: string; list?: boolean }) {
  const layout = list
    ? [
        'grid-cols-1 gap-2',
        // carte → ligne : contenu à l'horizontale, retour à la ligne seulement si l'écran est étroit
        '[&>*]:flex-row [&>*]:flex-wrap [&>*]:items-center [&>*]:gap-x-4 [&>*]:gap-y-2 [&>*]:rounded-[20px] [&>*]:py-3',
        // nom à gauche, largeur fixe pour aligner les colonnes
        '[&_.card-row]:w-[300px] [&_.card-row]:max-w-full [&_.card-row]:shrink-0',
        // pastilles et texte se partagent la place restante
        '[&>*>div:not(.card-row):not(.card-actions)]:min-w-[180px] [&>*>div:not(.card-row):not(.card-actions)]:flex-1',
        '[&>*>span]:min-w-[140px] [&>*>span]:flex-1',
        // actions à droite, boutons compacts
        '[&_.card-actions]:ms-auto [&_.card-actions]:mt-0 [&_.card-actions]:pt-0 [&_.card-actions]:flex-nowrap',
        '[&_.card-actions>*]:px-3 [&_.card-actions>*]:py-1.5 [&_.card-actions>*]:text-[13px]',
      ].join(' ')
    : 'grid-cols-1 gap-3.5 min-[561px]:grid-cols-[repeat(auto-fill,minmax(250px,1fr))]';
  return <div className={`grid ${layout} ${className}`}>{children}</div>;
}

/** État vide (.empty) : bordure pointillée. */
export function EmptyState({ children }: { children: ReactNode }) {
  const tr = useTr();
  return (
    <div className="rounded-[24px] border-[1.5px] border-dashed border-line p-7 text-center text-mut">{tr(children)}</div>
  );
}
