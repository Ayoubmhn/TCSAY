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

/** Sélection : demi-heures consécutives d'un même terrain, en minutes depuis minuit ([start, end[). */
export type Pick = { courtId: string; start: number; end: number };

/** « 17:30 » → minutes depuis minuit. */
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** 1050 → « 17:30 ». */
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Heure de fin d'une réservation (« 17:30 » + 60 min → « 18:30 »). */
export const endOf = (t: string, minutes = 60) => hhmm(toMinutes(t) + minutes);
/** 90 → « 1 h 30 ». */
export const durationText = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}`;

/**
 * Grille de réservation heures × terrains (.gwrap / .grid / .slot), une ligne par demi-heure, créneau libre en vert « Libre ».
 * Premier clic : 1 h à partir de la demi-heure choisie ; clic sur une autre demi-heure du même terrain : la réservation
 * s'étend jusqu'à elle (demi-heures consécutives et libres, 4 h au plus) ; clic dans la sélection : on l'efface.
 * Clavier : flèches pour se déplacer (tabindex itinérant), Entrée / Espace pour choisir.
 */
export function BookingGrid({
  grid,
  pick,
  onPick,
  onBlocked,
  onNotice,
}: {
  grid: Grid;
  pick: Pick | null;
  onPick: (pick: Pick | null) => void;
  onBlocked: (state: SlotState) => void;
  /** Message d'aide (prolongation impossible…). */
  onNotice: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cols = grid.courts.length;
  const step = 30;
  const minDuration = grid.durationMinutes;
  const maxDuration = grid.maxDurationMinutes;

  /** Demi-heure libre (« 30 min » = libre mais trop courte seule) sur le terrain c. */
  const blockFree = (c: number, m: number) => {
    const i = grid.times.indexOf(hhmm(m));
    return i >= 0 && ['free', 'short'].includes(grid.slots[c].times[i].state);
  };
  const rangeFree = (c: number, from: number, to: number) => {
    for (let m = from; m < to; m += step) if (!blockFree(c, m)) return false;
    return true;
  };

  const choose = (c: number, courtId: string, time: string, base: SlotState) => {
    const t = toMinutes(time);
    if (pick && pick.courtId === courtId) {
      if (t >= pick.start && t < pick.end) return onPick(null);
      const start = Math.min(pick.start, t);
      const end = Math.max(pick.end, t + step);
      if (end - start > maxDuration) return onNotice(`Réservation de ${durationText(maxDuration)} au plus.`);
      if (!rangeFree(c, start, end)) return onNotice('Pour prolonger, toutes les demi-heures entre les deux doivent être libres.');
      return onPick({ courtId, start, end });
    }
    if (base !== 'free') return onBlocked(base);
    onPick({ courtId, start: t, end: t + minDuration });
  };

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
              const t = toMinutes(time);
              const chosen = pick?.courtId === court.id && t >= pick.start && t < pick.end;
              const state = chosen ? 'chosen' : base;
              // Une demi-heure occupée reste cliquable seulement pour une prolongation (vérifiée dans choose).
              const blocked = base !== 'free' && !(pick?.courtId === court.id && base === 'short');
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
                  aria-label={`${court.name}, ${time}, ${LABEL[state]}`}
                  onKeyDown={(e) => onKey(e, r, c)}
                  onClick={() => choose(c, court.id, time, base)}
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
