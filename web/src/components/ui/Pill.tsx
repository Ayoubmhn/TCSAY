import type { ReactNode } from 'react';

/** b = date, heure, info · g = libre, confirmé, payé, lieu · r = pris, à payer, erreur · s = neutre, brouillon, type. */
export type PillTone = 'b' | 'g' | 'r' | 's';

const TONES: Record<PillTone, string> = { b: 'bg-pb', g: 'bg-pg', r: 'bg-pr', s: 'bg-ps' };

/** Pastille (.pill) : rayon 99px, padding 5px 13px, texte toujours #111. */
export function Pill({ tone, children, className = '' }: { tone: PillTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[13px] py-[5px] text-[13px] font-medium text-ink ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Groupe de pastilles (.pills). */
export function Pills({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap gap-1.5 ${className}`}>{children}</div>;
}

/** Badge sable « À venir » du menu (.badge). */
export function Badge({ children }: { children: ReactNode }) {
  return <span className="flex-none whitespace-nowrap rounded-full bg-ps px-[9px] py-[3px] text-[11px] font-semibold text-ink">{children}</span>;
}
