import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { DT, fD } from '../lib/format';
import { splitPlan } from '../lib/payment-config';
import type { ScheduleLine } from '../lib/types';
import { Pill } from './ui/Pill';

type Preview = { total: number; enabled: boolean; tranches: ScheduleLine[]; newCount: number };

/**
 * Tranches du mode choisi, calculées par l'API selon la configuration du club (fiche joueur) : tranches déjà payées
 * gardées, nouvelles tranches. `custom` : dates choisies pour ce joueur (une par nouvelle tranche), motif demandé à côté.
 */
export function PlanSchedule({
  plan,
  playerId,
  categoryId,
  custom,
  onCustom,
}: {
  /** Mode ou « CUSTOM:<id> » (modèle du club). */
  plan: string;
  playerId?: string;
  categoryId?: string;
  /** null = dates de la configuration du club ; sinon dates choisies pour ce joueur. */
  custom?: string[] | null;
  onCustom?: (dates: string[] | null) => void;
}) {
  const q = useQuery({
    queryKey: ['plan-preview', plan, playerId ?? null, categoryId ?? null],
    queryFn: () => {
      const { paymentPlan, templateId } = splitPlan(plan);
      return api.get<Preview>('/memberships/preview', { plan: paymentPlan, templateId, playerId, categoryId });
    },
    enabled: Boolean(playerId || categoryId),
  });
  const fresh = q.data?.tranches.filter((t) => !t.paid) ?? [];
  // Nombre de tranches changé (autre mode) : les dates choisies repartent de l'aperçu.
  useEffect(() => {
    if (custom && custom.length !== fresh.length) onCustom?.(fresh.map((t) => t.dueDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh.length]);
  if (!q.data || !q.data.tranches.length) return null;
  let k = -1;
  return (
    <div className="col-span-full flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 min-[521px]:grid-cols-4">
        {q.data.tranches.map((t, i) => {
          if (!t.paid) k++;
          const idx = k;
          return (
            <div key={i} className={`rounded-[18px] px-3 py-2.5 ${t.paid ? 'bg-paid' : 'bg-fld'}`}>
              <small className="block text-[12px] text-mut">
                Tranche {i + 1}/{q.data!.tranches.length}
              </small>
              <b className="block text-[16px] font-semibold">{DT(t.amount)}</b>
              {custom && !t.paid ? (
                <input
                  type="date"
                  aria-label={`Date de la tranche ${i + 1}`}
                  className="mt-1 w-full rounded-[12px] bg-card px-2 py-1 text-[12.5px]"
                  value={custom[idx] ?? t.dueDate}
                  onChange={(e) => onCustom?.(custom.map((d, j) => (j === idx ? e.target.value : d)))}
                />
              ) : (
                <small className="text-[12px]">
                  {fD(t.dueDate, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  {t.paid ? ' · payé' : ''}
                </small>
              )}
            </div>
          );
        })}
      </div>
      {!q.data.enabled && (
        <Pill tone="r" className="self-start whitespace-normal">
          Mode non proposé par le club (Configuration des paiements).
        </Pill>
      )}
      {onCustom && fresh.length > 0 && (
        <div className="flex flex-col gap-1 text-[14px]">
          <label className="flex items-center gap-2">
            <input type="radio" className="accent-[var(--pri)]" checked={!custom} onChange={() => onCustom(null)} />
            Dates de la configuration du club
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" className="accent-[var(--pri)]" checked={Boolean(custom)} onChange={() => onCustom(fresh.map((t) => t.dueDate))} />
            Dates choisies pour ce joueur <small className="text-mut">(motif obligatoire)</small>
          </label>
        </div>
      )}
    </div>
  );
}
