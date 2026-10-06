import type { ReactNode } from 'react';

/** Bleu = date, heure, info · vert = libre, confirmé, payé · rose = pris, à payer, erreur · sable = neutre, brouillon, « À venir ». */
export type PillTone = 'blue' | 'green' | 'rose' | 'sand';

const TONES: Record<PillTone, string> = {
  blue: 'bg-pill-blue',
  green: 'bg-pill-green',
  rose: 'bg-pill-rose',
  sand: 'bg-pill-sand',
};

export function Pill({ tone, children, small = false }: { tone: PillTone; children: ReactNode; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full font-medium text-pill-ink ${TONES[tone]} ${
        small ? 'px-2.5 py-0.5 text-[11px]' : 'px-[13px] py-[5px] text-[13px]'
      }`}
    >
      {children}
    </span>
  );
}
