import { useRef, type KeyboardEvent } from 'react';
import type { Grid, SlotState } from '../lib/types';

const LABEL: Record<SlotState | 'chosen', string> = {
  free: 'Libre',
  short: '30 min',
  mine: 'Moi',
  taken: 'Pris',
  group: 'Groupe',
  maintenance: 'Entretien',
  unlit: 'Sans éclairage',
  past: '—',
  chosen: 'Choisi',
};

const STYLE: Record<SlotState | 'chosen', string> = {
  free: 'bg-pg text-ink',
  short: 'bg-ps text-ink',
  mine: 'bg-pb text-ink',
  taken: 'bg-pr text-ink',
  group: 'bg-pr text-ink',
  maintenance: 'bg-ps text-ink',
  unlit: 'bg-ps text-ink',
  past: 'bg-fld text-fg opacity-35',
  chosen: 'bg-sel text-white',
};

export type Pick = { courtId: string; time: string };

/** « 17:30 » → minutes depuis minuit. */
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Heure de fin d'une réservation d'une heure (« 17:30 » → « 18:30 »). */
export const endOf = (t: string, minutes = 60) => {
  const m = toMinutes(t) + minutes;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Grille de réservation heures × terrains (.gwrap / .grid / .slot), départs toutes les 30 min (ex. 17:30) pour une heure de jeu.
 * Créneau libre en vert avec « Libre ».
 * Clavier : flèches pour se déplacer (tabindex itinérant), Entrée / Espace pour choisir.
 */
export function BookingGrid({
  grid,
  pick,
  onPick,
  onBlocked,
}: {
  grid: Grid;
  pick: Pick | null;
  onPick: (pick: Pick | null) => void;
  onBlocked: (state: SlotState) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cols = grid.courts.length;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, r: number, c: number) => {
    const move = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
    if (!move) return;
    e.preventDefault();
    const nr = Math.max(0, Math.min(grid.times.length - 1, r + move[0]));
    const nc = Math.max(0, Math.min(cols - 1, c + move[1]));
    const next = ref.current?.querySelector<HTMLButtonElement>(`[data-r="${nr}"][data-c="${nc}"]`);
    if (next) {
      ref.current?.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) => (b.tabIndex = -1));
      next.tabIndex = 0;
      next.focus();
    }
  };

  return (
    <div className="overflow-x-auto rounded-[26px] border-[1.5px] border-line bg-card p-3.5">
      <div
        ref={ref}
        role="grid"
        aria-label="Créneaux disponibles"
        className="grid min-w-[520px] gap-1.5"
        style={{ gridTemplateColumns: `64px repeat(${cols}, minmax(84px, 1fr))` }}
      >
        <div />
        {grid.courts.map((c) => (
          <div key={c.id} className="py-1 text-center text-[13px] font-semibold">
            {c.name}
            {c.lit ? ' ☀' : ''}
          </div>
        ))}
        {grid.times.map((time, r) => (
          <div key={time} role="row" className="contents">
            <div className={`flex items-center gap-1 text-[13px] tabular-nums ${time.endsWith(':00') ? 'text-fg' : 'text-mut'}`}>
              {time}
              {toMinutes(time) >= grid.nightStartHour * 60 ? ' ☾' : ''}
            </div>
            {grid.courts.map((court, c) => {
              const base = grid.slots[c].times[r].state;
              const chosen = pick?.courtId === court.id && pick.time === time;
              const state = chosen ? 'chosen' : base;
              const blocked = base !== 'free';
              return (
                <button
                  key={court.id}
                  type="button"
                  role="gridcell"
                  data-r={r}
                  data-c={c}
                  tabIndex={r === 0 && c === 0 ? 0 : -1}
                  aria-disabled={blocked || undefined}
                  aria-selected={chosen}
                  aria-label={`${court.name}, ${time} – ${endOf(time, grid.durationMinutes)}, ${LABEL[state]}`}
                  onKeyDown={(e) => onKey(e, r, c)}
                  onClick={() => (blocked ? onBlocked(base) : onPick(chosen ? null : { courtId: court.id, time }))}
                  className={`h-[34px] rounded-[12px] text-xs font-medium ${STYLE[state]} ${blocked ? 'cursor-not-allowed' : ''}`}
                >
                  {state === 'past' ? '' : LABEL[state]}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
