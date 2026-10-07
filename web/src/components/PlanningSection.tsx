import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { addDays, fD, todayIso, weekdayOf } from '../lib/format';
import type { Planning } from '../lib/types';
import { PlanningBoard, PlanningLegend } from './PlanningBoard';
import { Button, IconButton } from './ui/Button';
import { QueryState } from './ui/Loading';

/** Planning des terrains : semaine du lundi au dimanche, jour choisi, tableau coloré par entraîneur. */
export function PlanningSection() {
  const [day, setDay] = useState(todayIso());
  const monday = addDays(day, -((weekdayOf(day) + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const q = useQuery({ queryKey: ['planning', day], queryFn: () => api.get<Planning>('/planning', { date: day }) });

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton aria-label="Semaine précédente" onClick={() => setDay(addDays(day, -7))}>
          ‹
        </IconButton>
        <div role="listbox" aria-label="Jours de la semaine" className="flex flex-wrap gap-1.5">
          {week.map((d) => {
            const on = d === day;
            return (
              <button
                key={d}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => setDay(d)}
                className={`flex min-w-[58px] flex-col items-center rounded-[18px] px-2 py-1.5 ${on ? 'bg-sel text-white' : 'bg-day'}`}
              >
                <small className={`text-xs capitalize ${on ? 'text-[#dfe0ff]' : 'text-mut'}`}>{fD(d, { weekday: 'short' })}</small>
                <b className="text-[15px] font-semibold">{Number(d.slice(8))}</b>
              </button>
            );
          })}
        </div>
        <IconButton aria-label="Semaine suivante" onClick={() => setDay(addDays(day, 7))}>
          ›
        </IconButton>
        {day !== todayIso() && <Button onClick={() => setDay(todayIso())}>Aujourd’hui</Button>}
        <span className="ms-auto text-sm font-medium capitalize text-mut">{fD(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </div>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {q.data && (
          <>
            <PlanningBoard planning={q.data} />
            <PlanningLegend planning={q.data} />
          </>
        )}
      </QueryState>
    </div>
  );
}
