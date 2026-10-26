import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardRow, Kpi } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { fD } from '../../lib/format';
import type { PlayerCounter } from '../../lib/types';
import { CounterBar, CounterLines, PERIODS, periodRange } from './SessionCounter';

const short = (iso: string) => fD(iso, { day: 'numeric', month: 'short' });

/**
 * Joueur / parent : compteur des séances de l'enfant (prévues par le club, données, à rattraper par le club) et ses
 * propres absences, jamais dues par le club. Aucun montant.
 */
export function PlayerCounterCard({ playerId }: { playerId?: string | null }) {
  const [period, setPeriod] = useState('month');
  const range = periodRange(period);
  const q = useQuery({
    queryKey: ['session-counter', 'player', playerId, period],
    queryFn: () => api.get<PlayerCounter>('/session-counter/player', { playerId: playerId ?? undefined, from: range.from, to: range.to }),
    enabled: Boolean(playerId),
  });
  if (!q.data?.groups.length) return null;
  return (
    <div className="flex flex-col gap-3">
      {q.data.groups.map((c) => (
        <Card key={c.group.id}>
          <CardRow>
            <h3>Compteur des séances</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="b">{c.group.name}</Pill>
              <select aria-label="Période" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-full border-0 bg-fld px-3 py-1.5 text-[13px]">
                {PERIODS.map((p) => (
                  <option key={p.v} value={p.v}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </CardRow>
          <div className="grid grid-cols-2 gap-2.5 min-[761px]:grid-cols-4">
            {[
              { n: c.planned.sessions, label: 'prévues par le club' },
              { n: c.given.sessions, label: 'données' },
              { n: c.owed, label: 'à rattraper par le club', color: c.owed ? 'text-[#c2410c]' : '' },
              { n: c.absences.length, label: 'absences du joueur' },
            ].map((k) => (
              <div key={k.label} className="flex flex-col gap-1 rounded-[18px] bg-fld px-3.5 py-3">
                <span className={k.color}>
                  <Kpi>{k.n}</Kpi>
                </span>
                <span className="text-[12.5px] text-mut">{k.label}</span>
              </div>
            ))}
          </div>
          <CounterBar c={c} />
          <CounterLines c={c} limit={4} />
          {c.absences.length > 0 && (
            <div className="flex flex-col">
              {c.absences.slice(0, 4).map((a) => (
                <div key={a.date + a.startTime} className="flex items-center justify-between gap-2 border-t border-line py-2 text-[13.5px]">
                  <span>{`${short(a.date)} · absent`}</span>
                  <Pill tone="r">Absence du joueur</Pill>
                </div>
              ))}
            </div>
          )}
          <span className="text-[12.5px] text-mut">
            Les séances annulées par le club sont rattrapées ; les séances manquées par le joueur ne le sont pas. Une question : « Réclamations ».
          </span>
        </Card>
      ))}
    </div>
  );
}
