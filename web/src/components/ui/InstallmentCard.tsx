import type { ReactNode } from 'react';
import { DT, fD } from '../../lib/format';
import type { Installment } from '../../lib/types';
import { Pill, Pills } from './Pill';

export const INSTALLMENT_STATUS: Record<Installment['status'], { label: string; tone: 'g' | 'r' }> = {
  PAID: { label: 'Payée', tone: 'g' },
  PARTIAL: { label: 'Partiel', tone: 'r' },
  DUE: { label: 'À payer', tone: 'r' },
  LATE: { label: 'En retard', tone: 'r' },
};

/** Carte de tranche (.tr) : fond payé / à payer, « Montant payé / Montant restant », barre de progression. */
export function InstallmentCard({
  installment: i,
  title,
  pills,
  action,
  bar = true,
}: {
  installment: Installment;
  title: string;
  pills?: ReactNode;
  action?: ReactNode;
  bar?: boolean;
}) {
  const st = INSTALLMENT_STATUS[i.status];
  return (
    <div className={`flex flex-col gap-3 rounded-[24px] border-[1.5px] border-line p-[18px] ${i.remaining ? 'bg-topay' : 'bg-paid'}`}>
      <div className="flex items-center justify-between gap-2.5">
        <h3>{title}</h3>
        <Pill tone={st.tone}>{st.label}</Pill>
      </div>
      <Pills>{pills ?? <Pill tone="b">Échéance {fD(i.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })}</Pill>}</Pills>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <small className="block text-xs text-mut">Montant payé</small>
          <b className="text-xl font-semibold tabular-nums">{DT(i.paid)}</b>
        </div>
        <div>
          <small className="block text-xs text-mut">Montant restant</small>
          <b className="text-xl font-semibold tabular-nums">{DT(i.remaining)}</b>
        </div>
      </div>
      {bar && (
        <div className="h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <i className="block h-full rounded-full bg-pri" style={{ width: `${Math.round((i.paid / i.amount) * 100)}%` }} />
        </div>
      )}
      {action}
    </div>
  );
}

/** Barre de remplissage (.bar). */
export function ProgressBar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
      <i className="block h-full rounded-full bg-pri" style={{ width: `${Math.min(100, Math.round((value / max) * 100))}%` }} />
    </div>
  );
}
