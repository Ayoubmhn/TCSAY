import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { pad } from '../lib/format';
import type { Planning } from '../lib/types';
import { coachNames, leadCoach, nowTunis, reservationLabel, toMin, type PItem } from './planningUtils';

/**
 * Planning des terrains d'un jour (comme le tableau papier du club) : lignes = terrains, colonnes = demi-heures.
 * Terrains fixes à gauche pendant le défilement, trait « maintenant », heures de nuit grisées (hachurées sur un terrain
 * sans éclairage), groupe et entraîneur écrits sur chaque case ; toucher une case ouvre sa fiche. Grille CSS.
 */
export function PlanningBoard({ planning, onSelect, isVisible = () => true }: { planning: Planning; onSelect?: (i: PItem) => void; isVisible?: (i: PItem) => boolean }) {
  const start = planning.openingHour * 60;
  const end = planning.closingHour * 60;
  const cols = (end - start) / 30;
  const col = (t: string) => Math.max(1, Math.min(cols + 1, (toMin(t) - start) / 30 + 1)) + 1; // +1 : colonne des terrains
  const hours = Array.from({ length: planning.closingHour - planning.openingHour }, (_, i) => planning.openingHour + i);
  const grid: CSSProperties = { gridTemplateColumns: `106px repeat(${cols}, minmax(38px, 1fr))` };
  const nightCol = (planning.nightStartHour * 60 - start) / 30;
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(nowTunis());
  useEffect(() => {
    const t = setInterval(() => setNow(nowTunis()), 60_000);
    return () => clearInterval(t);
  }, []);
  const today = now.day === planning.date && now.min >= start && now.min <= end;
  const nowPct = ((now.min - start) / (end - start)) * 100;

  // Ouvre la grille sur l'heure actuelle (une heure avant), sinon au début de la journée.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const inner = el.firstElementChild as HTMLElement | null;
    if (!inner || !today) {
      el.scrollLeft = 0;
      return;
    }
    const w = inner.scrollWidth - 14 - 106;
    el.scrollLeft = Math.max(0, (w * nowPct) / 100 - (el.clientWidth - 106) / 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planning.date]);

  const cell = 'z-[1] mx-px flex h-[52px] flex-col justify-center overflow-hidden rounded-[11px] px-2 text-start text-ink focus-visible:outline-2 focus-visible:outline-offset-1';
  return (
    <div ref={scroller} className="overflow-x-auto rounded-[26px] border-[1.5px] border-line bg-card [scrollbar-width:thin]">
      <div role="grid" aria-label={`Planning des terrains du ${planning.date}`} className="relative grid min-w-[980px] gap-y-1.5 py-3.5 pe-3.5" style={grid}>
        {/* En-tête des heures */}
        <div className="sticky start-0 z-[3] self-stretch bg-card" />
        {hours.map((h) => (
          <div key={h} className="col-span-2 border-s-[1.5px] border-line ps-1 text-[12px] font-semibold tabular-nums text-mut">
            {pad(h)}h{h >= planning.nightStartHour ? ' ☾' : ''}
          </div>
        ))}

        {planning.courts.map((court, r) => {
          const row = r + 2;
          const sessions = planning.sessions.filter((s) => s.court?.id === court.id);
          const reservations = planning.reservations.filter((x) => x.courtId === court.id);
          const off = court.maintenance || !court.active;
          return (
            <div key={court.id} role="row" className="contents">
              <div className="sticky start-0 z-[3] flex flex-col justify-center bg-card pe-2 ps-3.5 text-[13.5px] font-semibold" style={{ gridRow: row, gridColumn: 1 }}>
                <span>
                  {court.name}
                  {court.lit ? ' ☀' : ''}
                </span>
                <small className="text-[11px] font-normal text-mut">{off ? 'Indisponible' : court.lit ? 'éclairé' : 'sans éclairage'}</small>
              </div>
              {/* Fond : demi-heures (nuit grisée ; hachurée sur un terrain sans éclairage). */}
              {Array.from({ length: cols }, (_, i) => {
                const night = i >= nightCol;
                return (
                  <div
                    key={i}
                    aria-hidden="true"
                    className={`h-[52px] ${i % 2 === 0 ? 'border-s-[1.5px] border-line' : ''} ${off ? 'bg-ps/40' : night ? (court.lit ? 'bg-fld/30' : 'bg-[repeating-linear-gradient(135deg,var(--fld)_0_6px,transparent_6px_12px)]') : 'bg-fld/60'}`}
                    style={{ gridRow: row, gridColumn: i + 2 }}
                  />
                );
              })}
              {sessions.map((s) => {
                if (!isVisible({ kind: 'session', s })) return null;
                const lead = leadCoach(s);
                const cancelled = s.resolution === 'CANCELLED';
                const who = s.resolution === 'REPLACED' && s.replacement ? `⇄ ${s.replacement.firstName}` : s.resolution === 'PHYSICAL' ? '◆ Physique' : coachNames(s) || 'À affecter';
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="gridcell"
                    onClick={() => onSelect?.({ kind: 'session', s })}
                    aria-label={`${s.group.name}, ${s.startTime} à ${s.endTime}, ${who}`}
                    className={`${cell} ${cancelled ? 'opacity-50 line-through' : ''}`}
                    style={{
                      gridRow: row,
                      gridColumn: `${col(s.startTime)} / ${col(s.endTime)}`,
                      background: s.resolution === 'PHYSICAL' || !lead ? 'var(--ps)' : lead.color,
                    }}
                  >
                    <b className="truncate text-[13px] font-semibold leading-tight">{s.group.name}</b>
                    <span className="truncate text-[11.5px] leading-tight">
                      {who} · <span dir="ltr">{s.startTime}</span>
                    </span>
                  </button>
                );
              })}
              {reservations.map((x) => {
                if (!isVisible({ kind: 'reservation', r: x })) return null;
                return (
                  <button
                    key={x.id}
                    type="button"
                    role="gridcell"
                    onClick={() => onSelect?.({ kind: 'reservation', r: x })}
                    aria-label={`${reservationLabel(x)}, ${x.startTime} à ${x.endTime}`}
                    className={`${cell} border-[1.5px] ${x.match ? 'border-ink/30 bg-pb' : 'border-dashed border-ink/40 bg-pr'}`}
                    style={{ gridRow: row, gridColumn: `${col(x.startTime)} / ${col(x.endTime)}` }}
                  >
                    <b className="truncate text-[12.5px] font-semibold leading-tight">
                      {x.match ? (x.type === 'TOURNAMENT' ? '🏆 ' : '🎾 ') : ''}
                      {x.match ? reservationLabel(x) : x.type === 'PRIVATE' ? 'Séance privée' : 'Réservé'}
                    </b>
                    <span dir="ltr" className="truncate text-[11.5px] leading-tight">
                      {x.match ? x.match.players : (x.player ?? x.coach?.name ?? '—')}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {/* Trait « maintenant » (aujourd'hui seulement). */}
        {today && (
          <div aria-hidden="true" className="pointer-events-none absolute bottom-4 top-9 z-[2] w-0.5 bg-[#e5484d]" style={{ left: `calc(106px + (100% - 14px - 106px) * ${nowPct / 100})` }}>
            <span className="absolute -bottom-[15px] start-[-20px] rounded-full bg-[#e5484d] px-1.5 text-[10.5px] font-semibold text-white">
              {pad(Math.floor(now.min / 60))}:{pad(now.min % 60)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Légende : couleur de chaque entraîneur du jour, réservations, entraîneur à affecter. */
export function PlanningLegend({ planning }: { planning: Planning }) {
  const present = new Set(planning.sessions.flatMap((s) => [...s.coaches.map((c) => c.id), ...(s.replacement ? [s.replacement.id] : [])]));
  const chip = 'inline-flex items-center gap-1.5 rounded-full bg-fld px-[11px] py-[5px] font-medium';
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      {planning.legend
        .filter((c) => present.has(c.id))
        .map((c) => (
          <span key={c.id} className={chip}>
            <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: c.color }} />
            {c.name}
          </span>
        ))}
      <span className={chip}>
        <span aria-hidden="true" className="h-3 w-3 rounded-full bg-ps" />
        Entraîneur à affecter
      </span>
      <span className={chip}>
        <span aria-hidden="true" className="h-3 w-3 rounded-full border-[1.5px] border-dashed border-ink/40 bg-pr" />
        Réservation
      </span>
      <span className={chip}>
        <span aria-hidden="true" className="h-3 w-3 rounded-full border-[1.5px] border-ink/30 bg-pb" />
        Match ou tournoi
      </span>
      <span className={chip}>⇄ Remplacement</span>
      <span className={chip}>◆ Séance physique</span>
      <span className={`${chip} line-through opacity-70`}>Séance annulée</span>
      <span className={chip}>☾ Nuit (dès {planning.nightStartHour}h)</span>
    </div>
  );
}
