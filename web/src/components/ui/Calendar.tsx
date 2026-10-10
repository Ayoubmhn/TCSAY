import { useState } from 'react';
import { addDays, fD, todayIso, weekdayOf } from '../../lib/format';
import { IconButton } from './Button';
import { Card, CardRow } from './Card';
import { Segmented } from './Segmented';

type Mode = 'Mois' | 'Semaine';

/** Calendrier (.cal) : Lun → Dim, jours en cercles, points = séances, jour choisi en --sel, bascule Mois / Semaine. */
export function Calendar({ dots, value, onChange }: { dots: Set<string>; value: string; onChange: (day: string) => void }) {
  const [mode, setMode] = useState<Mode>('Mois');
  const [month, setMonth] = useState(value.slice(0, 7) + '-01');
  const today = todayIso();

  let days: string[];
  let title: string;
  if (mode === 'Mois') {
    const offset = (weekdayOf(month) + 6) % 7;
    const start = addDays(month, -offset);
    days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    title = fD(month, { month: 'long', year: 'numeric' });
  } else {
    const start = addDays(value, -((weekdayOf(value) + 6) % 7));
    days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    title = 'Semaine du ' + fD(days[0], { day: 'numeric', month: 'long' });
  }

  const move = (dir: 1 | -1) => {
    if (mode === 'Mois') {
      const [y, m] = month.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + dir, 1));
      setMonth(d.toISOString().slice(0, 10));
    } else {
      onChange(addDays(value, 7 * dir));
    }
  };

  return (
    <Card>
      <CardRow>
        <div className="flex flex-wrap items-center gap-2">
          <IconButton aria-label="Période précédente" onClick={() => move(-1)}>
            ‹
          </IconButton>
          <h3 className="min-w-[150px] text-center capitalize">{title}</h3>
          <IconButton aria-label="Période suivante" onClick={() => move(1)}>
            ›
          </IconButton>
        </div>
        <Segmented
          label="Affichage"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'Mois', label: 'Mois' },
            { value: 'Semaine', label: 'Semaine' },
          ]}
        />
      </CardRow>
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((w) => (
          <div key={w} className="py-1 text-xs font-semibold text-mut">
            {w}
          </div>
        ))}
        {days.map((day) => {
          const on = day === value;
          const out = mode === 'Mois' && day.slice(0, 7) !== month.slice(0, 7);
          const dot = dots.has(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => onChange(day)}
              aria-label={`${fD(day, { weekday: 'long', day: 'numeric', month: 'long' })}${dot ? ', séance' : ''}`}
              aria-pressed={on}
              className={`relative m-auto aspect-square w-full max-w-[46px] rounded-full text-sm font-medium ${
                on ? 'bg-sel text-white' : 'bg-day'
              } ${out ? 'opacity-35' : ''} ${day === today ? 'outline-[1.5px] -outline-offset-[1.5px] outline-fg outline' : ''}`}
            >
              {Number(day.slice(8))}
              {dot && (
                <span className={`absolute bottom-1.5 left-1/2 h-[5px] w-[5px] -translate-x-1/2 rounded-full ${on ? 'bg-white' : 'bg-pri'}`} />
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
