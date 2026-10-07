import { useRef, type KeyboardEvent } from 'react';
import { pad } from '../lib/format';
import type { Grid, SlotState } from '../lib/types';

const LABEL: Record<SlotState | 'chosen', string> = {
  free: 'Libre',
  mine: 'Moi',
  taken: 'Pris',
  group: 'Groupe',
  maintenance: 'Entretien',
  unlit: 'Sans éclairage',
  past: '—',
  chosen: 'Choisi',
};

const STYLE: Record<SlotState | 'chosen', string> = {
  free: 'bg-fld text-fg',
  mine: 'bg-pg text-ink',
  taken: 'bg-pr text-ink',
  group: 'bg-pr text-ink',
  maintenance: 'bg-ps text-ink',
  unlit: 'bg-ps text-ink',
  past: 'bg-fld text-fg opacity-35',
  chosen: 'bg-sel text-white',
};

export type Pick = { courtId: string; hour: number };

/**
 * Grille de réservation heures × terrains (.gwrap / .grid / .slot).
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
    const nr = Math.max(0, Math.min(grid.hours.length - 1, r + move[0]));
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
        {grid.hours.map((hour, r) => (
          <div key={hour} role="row" className="contents">
            <div className="flex items-center gap-1 text-[13px] tabular-nums text-mut">
              {pad(hour)}h{hour >= grid.nightStartHour ? ' ☾' : ''}
            </div>
            {grid.courts.map((court, c) => {
              const base = grid.slots[c].hours[r].state;
              const chosen = pick?.courtId === court.id && pick.hour === hour;
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
                  aria-label={`${court.name}, ${hour}h, ${LABEL[state]}`}
                  onKeyDown={(e) => onKey(e, r, c)}
                  onClick={() => (blocked ? onBlocked(base) : onPick(chosen ? null : { courtId: court.id, hour }))}
                  className={`h-[38px] rounded-[12px] text-xs font-medium ${STYLE[state]} ${blocked ? 'cursor-not-allowed' : ''}`}
                >
                  {state === 'free' ? '' : LABEL[state]}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
