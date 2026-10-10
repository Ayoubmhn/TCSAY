import type { CSSProperties } from 'react';
import { fullName, pad } from '../lib/format';
import type { Planning } from '../lib/types';

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Planning des terrains d'un jour (comme le tableau papier du club) :
 * lignes = terrains, colonnes = demi-heures ; séances colorées par entraîneur, réservations en rose,
 * séance d'un entraîneur absent barrée. Grille CSS (pas de tableau HTML).
 */
export function PlanningBoard({ planning }: { planning: Planning }) {
  const start = planning.openingHour * 60;
  const end = planning.closingHour * 60;
  const cols = (end - start) / 30;
  const col = (t: string) => Math.max(1, Math.min(cols + 1, (toMin(t) - start) / 30 + 1)) + 1; // +1 : colonne des terrains
  const hours = Array.from({ length: planning.closingHour - planning.openingHour }, (_, i) => planning.openingHour + i);
  const grid: CSSProperties = { gridTemplateColumns: `88px repeat(${cols}, minmax(34px, 1fr))` };

  return (
    <div className="overflow-x-auto rounded-[26px] border-[1.5px] border-line bg-card p-3.5">
      <div role="grid" aria-label={`Planning des terrains du ${planning.date}`} className="grid min-w-[900px] gap-y-1.5" style={grid}>
        {/* En-tête des heures */}
        <div />
        {hours.map((h) => (
          <div key={h} className="col-span-2 border-s-[1.5px] border-line ps-1 text-[12px] font-semibold tabular-nums text-mut">
            {pad(h)}h{h >= planning.nightStartHour ? ' ☾' : ''}
          </div>
        ))}

        {planning.courts.map((court, r) => {
          const row = r + 2;
          const sessions = planning.sessions.filter((s) => s.court?.id === court.id);
          const reservations = planning.reservations.filter((x) => x.courtId === court.id);
          return (
            <div key={court.id} role="row" className="contents">
              <div className="flex items-center text-[13px] font-semibold" style={{ gridRow: row, gridColumn: 1 }}>
                {court.name}
                {court.lit ? ' ☀' : ''}
              </div>
              {/* Fond : demi-heures */}
              {Array.from({ length: cols }, (_, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className={`h-[46px] ${i % 2 === 0 ? 'border-s-[1.5px] border-line' : ''} ${court.maintenance || !court.active ? 'bg-ps/40' : 'bg-fld/60'}`}
                  style={{ gridRow: row, gridColumn: i + 2 }}
                />
              ))}
              {sessions.map((s) => {
                // Absence d'entraîneur validée : remplaçant (sa couleur), séance physique, ou séance annulée (barrée).
                const lead = s.resolution === 'REPLACED' && s.replacement ? s.replacement : s.coaches[0];
                const absent = s.resolution === 'CANCELLED';
                const note =
                  s.resolution === 'REPLACED' && s.replacement
                    ? ` · remplacé par ${fullName(s.replacement).trim()}`
                    : s.resolution === 'PHYSICAL'
                      ? ' · séance physique'
                      : absent
                        ? ' · annulée (entraîneur absent)'
                        : '';
                return (
                  <div
                    key={s.id}
                    role="gridcell"
                    title={`${s.group.name} · ${s.startTime}–${s.endTime} · ${s.coaches.map((c) => fullName(c).trim()).join(', ') || 'entraîneur à affecter'}${note}`}
                    className={`z-[1] mx-px flex h-[46px] flex-col justify-center overflow-hidden rounded-[10px] px-2 text-ink ${absent ? 'opacity-50 line-through' : ''}`}
                    style={{
                      gridRow: row,
                      gridColumn: `${col(s.startTime)} / ${col(s.endTime)}`,
                      background: s.resolution === 'PHYSICAL' ? 'var(--ps)' : lead ? lead.color : 'var(--ps)',
                    }}
                  >
                    <b className="truncate text-[12.5px] font-semibold leading-tight">
                      {s.resolution === 'REPLACED' ? '⇄ ' : s.resolution === 'PHYSICAL' ? '◆ ' : ''}
                      {s.group.name}
                    </b>
                    <span className="flex items-center gap-1 truncate text-[11px] leading-tight">
                      {s.coaches.length > 1 &&
                        s.coaches.slice(1).map((c) => (
                          <span key={c.id} aria-hidden="true" className="h-2 w-2 flex-none rounded-full ring-1 ring-black/30" style={{ background: c.color }} />
                        ))}
                      <span dir="ltr">
                        {s.startTime}–{s.endTime}
                      </span>
                    </span>
                  </div>
                );
              })}
              {reservations.map((x) => (
                <div
                  key={x.id}
                  role="gridcell"
                  title={`Réservation ${x.type === 'PRIVATE' ? 'séance privée' : 'loisir'} · ${x.startTime}–${x.endTime}${x.player ? ' · ' + x.player : ''}`}
                  className="z-[1] mx-px flex h-[46px] flex-col justify-center overflow-hidden rounded-[10px] border-[1.5px] border-dashed border-ink/40 bg-pr px-2 text-ink"
                  style={{ gridRow: row, gridColumn: `${col(x.startTime)} / ${col(x.endTime)}` }}
                >
                  <b className="truncate text-[12px] font-semibold leading-tight">{x.type === 'PRIVATE' ? 'Séance privée' : 'Réservé'}</b>
                  <span dir="ltr" className="truncate text-[11px] leading-tight">{x.player ?? x.coach?.name ?? '—'}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Légende : couleur de chaque entraîneur, réservations, entraîneur à affecter. */
export function PlanningLegend({ planning }: { planning: Planning }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      {planning.legend.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-fld px-[11px] py-[5px] font-medium">
          <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: c.color }} />
          {c.name}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 rounded-full bg-fld px-[11px] py-[5px] font-medium">
        <span aria-hidden="true" className="h-3 w-3 rounded-full bg-ps" />
        Entraîneur à affecter
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-fld px-[11px] py-[5px] font-medium">
        <span aria-hidden="true" className="h-3 w-3 rounded-full border-[1.5px] border-dashed border-ink/40 bg-pr" />
        Réservation
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-fld px-[11px] py-[5px] font-medium">⇄ Remplacement</span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-fld px-[11px] py-[5px] font-medium">◆ Séance physique</span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-fld px-[11px] py-[5px] font-medium line-through opacity-70">Séance annulée</span>
    </div>
  );
}
