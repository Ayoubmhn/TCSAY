import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardRow } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { api } from '../../lib/api';

type HistoryRow = { id: string; at: string; who: string; action: string; target: string; before: string | null; after: string | null; reason: string | null };

/** Historique des actions de l'emploi affiché (qui, quand, quoi) : brouillon, vacances, ou emploi publié. */
export function ScheduleHistory({ draftId, vacId }: { draftId?: string; vacId?: string }) {
  const [open, setOpen] = useState(false);
  const query = vacId ? { vacances: vacId } : draftId ? { draft: draftId } : {};
  const h = useQuery({ queryKey: ['timetable', 'history', vacId ?? draftId ?? 'publie'], queryFn: () => api.get<HistoryRow[]>('/timetable/history', query) });
  const rows = h.data ?? [];
  const shown = open ? rows : rows.slice(0, 5);
  const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' });
  return (
    <Card>
      <CardRow>
        <h3>{vacId ? 'Historique des vacances' : draftId ? 'Historique du brouillon' : 'Historique de l’emploi publié'}</h3>
        <Pill tone="b">{`${rows.length} action${rows.length > 1 ? 's' : ''}`}</Pill>
      </CardRow>
      {rows.length ? (
        <div className="flex flex-col">
          {shown.map((r) => (
            <div key={r.id} className="flex flex-col gap-0.5 border-t border-line py-2.5 text-[13.5px] first:border-t-0">
              <div className="flex flex-wrap items-center gap-x-2">
                <b className="font-semibold">{r.action}</b>
                <span className="text-mut">· {r.target}</span>
              </div>
              <span className="text-[12.5px] text-mut">{`${when(r.at)} · par ${r.who}`}</span>
              {(r.before || r.after) && (
                <span className="text-[12.5px]">
                  {r.before && <span className="text-mut line-through">{r.before}</span>}
                  {r.before && r.after && ' → '}
                  {r.after}
                </span>
              )}
              {r.reason && <span className="text-[12.5px] text-mut">{`Motif : ${r.reason}`}</span>}
            </div>
          ))}
          {rows.length > 5 && (
            <button type="button" onClick={() => setOpen(!open)} className="pt-1 text-start text-[13px] text-pri">
              {open ? 'Voir moins' : `Voir tout (${rows.length})`}
            </button>
          )}
        </div>
      ) : (
        <span className="text-[13.5px] text-mut">Aucune action pour le moment.</span>
      )}
    </Card>
  );
}
