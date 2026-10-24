import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { addDays, fD, todayIso, weekdayOf } from '../lib/format';
import type { Planning } from '../lib/types';
import { PlanningBoard, PlanningLegend } from './PlanningBoard';
import { PlanningDetail } from './PlanningDetail';
import { busyMinutes, coachLine, courtItems, freeRanges, itemColor, nowTunis, rangesText, reservationLabel, toMin, type PItem } from './planningUtils';
import { Card, EmptyState } from './ui/Card';
import { FilterSelect } from './ui/Field';
import { QueryState } from './ui/Loading';
import { Pill } from './ui/Pill';
import { Segmented } from './ui/Segmented';

type View = 'list' | 'grid' | 'week';
const VIEW_KEY = 'tcsay.planning.view';

function initialView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'list' || v === 'grid' || v === 'week') return v;
  } catch {
    /* stockage indisponible */
  }
  return window.matchMedia('(max-width: 860px)').matches ? 'list' : 'grid';
}

const chip = (on: boolean) => `flex-none rounded-full px-3.5 py-[7px] text-[13px] font-medium ${on ? 'bg-toggle text-bg' : 'bg-fld text-fg'}`;

/** Une ligne de la liste : horaire, groupe ou réservation, entraîneur ; toucher ouvre la fiche. */
function ListRow({ item, date, onSelect }: { item: PItem; date: string; onSelect: (i: PItem) => void }) {
  const start = item.kind === 'session' ? item.s.startTime : item.r.startTime;
  const end = item.kind === 'session' ? item.s.endTime : item.r.endTime;
  const now = nowTunis();
  const live = now.day === date && now.min >= toMin(start) && now.min < toMin(end);
  const cancelled = item.kind === 'session' && item.s.resolution === 'CANCELLED';
  const noCoach = item.kind === 'session' && !item.s.coaches.length && !item.s.replacement;
  return (
    <button type="button" onClick={() => onSelect(item)} className="flex w-full items-stretch gap-3 rounded-[16px] bg-fld px-3 py-2.5 text-start hover:bg-btn">
      <span aria-hidden="true" className="w-[5px] flex-none rounded-full" style={{ background: itemColor(item) }} />
      <span className="w-[62px] flex-none text-[12.5px] leading-snug text-mut" dir="ltr">
        <b className="block text-[15px] font-semibold text-fg">{start}</b>
        {end}
      </span>
      <span className={`min-w-0 flex-1 ${cancelled ? 'line-through opacity-60' : ''}`}>
        <b className="block truncate text-[15px] font-semibold">{item.kind === 'session' ? item.s.group.name : reservationLabel(item.r)}</b>
        <span className={`block truncate text-[13px] ${noCoach ? 'font-semibold text-fg' : 'text-mut'}`}>
          {item.kind === 'session'
            ? `${noCoach ? '⚠ ' : ''}${coachLine(item.s)}${item.s.members ? ` · ${item.s.members} joueur${item.s.members > 1 ? 's' : ''}` : ''}${item.s.kind === 'PHYSICAL' ? ' · séance physique' : ''}${item.s.holiday ? ` · ${item.s.holiday}` : ''}`
            : item.r.match
              ? item.r.match.players
              : (item.r.player ?? item.r.coach?.name ?? '—')}
        </span>
      </span>
      {live && !cancelled && <span className="self-center text-[11.5px] font-bold text-[#e5484d]">EN COURS</span>}
    </button>
  );
}

/**
 * Planning des terrains : jours de la semaine sur une ligne, vues Liste (défaut sur téléphone), Grille et Semaine,
 * résumé du jour avec alertes, filtres (terrain, entraîneur, libres), créneaux libres et fiche de chaque séance.
 */
export function PlanningSection() {
  const [day, setDay] = useState(todayIso());
  const [view, setViewState] = useState<View>(initialView);
  const [courtId, setCourtId] = useState('');
  const [coachId, setCoachId] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [legend, setLegend] = useState(false);
  const [selected, setSelected] = useState<PItem>();
  const monday = addDays(day, -((weekdayOf(day) + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const q = useQuery({ queryKey: ['planning', day], queryFn: () => api.get<Planning>('/planning', { date: day }) });
  const weekQ = useQueries({
    queries: week.map((d) => ({ queryKey: ['planning', d], queryFn: () => api.get<Planning>('/planning', { date: d }), enabled: view === 'week' })),
  });
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [day]);

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* stockage indisponible */
    }
  };

  const p = q.data;
  const visible = (i: PItem) => {
    if (!coachId) return true;
    if (i.kind === 'reservation') return false;
    return i.s.coaches.some((c) => c.id === coachId) || i.s.replacement?.id === coachId;
  };
  const courts = p ? p.courts.filter((c) => !courtId || c.id === courtId) : [];
  const live = p ? p.sessions.filter((s) => s.resolution !== 'CANCELLED') : [];
  const alerts = p
    ? [
        ...p.sessions.filter((s) => !s.coaches.length && s.resolution !== 'CANCELLED').map((s) => ({ tone: 'r' as const, text: `${s.group.name} ${s.startTime} : entraîneur à affecter`, item: { kind: 'session' as const, s } })),
        ...p.sessions.filter((s) => s.resolution === 'CANCELLED').map((s) => ({ tone: 'r' as const, text: `${s.group.name} ${s.startTime} : séance annulée (entraîneur absent)`, item: { kind: 'session' as const, s } })),
        ...p.sessions.filter((s) => s.resolution === 'REPLACED').map((s) => ({ tone: 's' as const, text: `${s.group.name} ${s.startTime} : ${coachLine(s)}`, item: { kind: 'session' as const, s } })),
      ]
    : [];
  const coachesToday = p ? p.legend.filter((c) => p.sessions.some((s) => s.coaches.some((x) => x.id === c.id) || s.replacement?.id === c.id)) : [];

  return (
    <div className="flex flex-col gap-3.5">
      {/* Jours : une seule ligne, flèches aux deux bouts */}
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Semaine précédente" onClick={() => setDay(addDays(day, -7))} className="grid h-[54px] w-9 flex-none place-items-center rounded-[14px] bg-btn text-lg">
          ‹
        </button>
        <div ref={strip} role="listbox" aria-label="Jours de la semaine" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {week.map((d) => {
            const on = d === day;
            return (
              <button
                key={d}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => setDay(d)}
                className={`flex h-[54px] min-w-[50px] flex-1 flex-none flex-col items-center justify-center rounded-[16px] px-1 ${on ? 'bg-sel text-white' : d === todayIso() ? 'bg-day ring-[1.5px] ring-pri' : 'bg-day'}`}
              >
                <small className={`text-[11.5px] capitalize ${on ? 'text-[#dfe0ff]' : 'text-mut'}`}>{fD(d, { weekday: 'short' })}</small>
                <b className="text-[16px] font-semibold">{Number(d.slice(8))}</b>
              </button>
            );
          })}
        </div>
        <button type="button" aria-label="Semaine suivante" onClick={() => setDay(addDays(day, 7))} className="grid h-[54px] w-9 flex-none place-items-center rounded-[14px] bg-btn text-lg">
          ›
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Vue"
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: 'Liste' },
            { value: 'grid', label: 'Grille' },
            { value: 'week', label: 'Semaine' },
          ]}
        />
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-medium capitalize text-mut">{fD(day, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          {day !== todayIso() && (
            <button type="button" className={chip(false)} onClick={() => setDay(todayIso())}>
              Aujourd’hui
            </button>
          )}
        </div>
      </div>

      {view === 'week' ? (
        <WeekView week={week} data={weekQ.map((x) => x.data)} loading={weekQ.some((x) => x.isPending)} onPick={(d) => (setDay(d), setView('list'))} />
      ) : (
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {p && (
            <>
              {/* Résumé du jour et alertes */}
              <Card className="gap-2.5 p-3.5">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    [live.length, 'séance'],
                    [p.reservations.filter((r) => !r.match).length, 'réservation'],
                    [p.reservations.filter((r) => r.match).length, 'match'],
                  ].map(([n, label]) => (
                    <div key={label as string} className="rounded-[16px] bg-fld px-3 py-2">
                      <b className="block text-[22px] font-semibold leading-tight">{n}</b>
                      <span className="text-[12px] text-mut">
                        {label}
                        {(n as number) > 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                </div>
                {alerts.slice(0, 4).map((a, i) => (
                  <button key={i} type="button" onClick={() => setSelected(a.item)} className={`flex items-center gap-2 rounded-[14px] px-3 py-2 text-start text-[13px] ${a.tone === 'r' ? 'bg-topay' : 'bg-fld'}`}>
                    <span aria-hidden="true">{a.tone === 'r' ? '⚠️' : '⇄'}</span>
                    {a.text}
                  </button>
                ))}
              </Card>

              {/* Filtres */}
              <div className="flex flex-wrap items-center gap-2">
                <FilterSelect label="Terrain" value={courtId} onChange={(e) => setCourtId(e.target.value)}>
                  <option value="">Tous les terrains</option>
                  {p.courts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </FilterSelect>
                <FilterSelect label="Entraîneur" value={coachId} onChange={(e) => setCoachId(e.target.value)}>
                  <option value="">Tous les entraîneurs</option>
                  {coachesToday.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </FilterSelect>
                {view === 'list' && (
                  <button type="button" aria-pressed={freeOnly} className={chip(freeOnly)} onClick={() => setFreeOnly((v) => !v)}>
                    Libres seulement
                  </button>
                )}
              </div>

              {view === 'list' ? (
                <div className="flex flex-col gap-4">
                  {courts.map((c) => {
                    const items = courtItems(p, c.id).filter(visible);
                    const free = freeRanges(p, c);
                    if (freeOnly && !free.length) return null;
                    if (coachId && !items.length) return null;
                    return (
                      <section key={c.id} className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <h3 className="m-0 text-[16px] font-medium">
                            {c.name}
                            {c.lit ? ' ☀' : ''}
                          </h3>
                          <small className="text-[12px] text-mut">
                            {c.maintenance || !c.active ? 'Indisponible (entretien)' : free.length ? `libre ${rangesText(free)}` : 'complet'}
                          </small>
                        </div>
                        {freeOnly ? (
                          free.map(([a, b]) => (
                            <div key={a} className="rounded-[16px] border-[1.5px] border-dashed border-line px-3 py-2.5 text-[13.5px]">
                              <Pill tone="g">Libre</Pill> <span className="ms-1">{rangesText([[a, b]])}</span>
                            </div>
                          ))
                        ) : items.length ? (
                          items.map((i) => <ListRow key={i.kind === 'session' ? i.s.id : i.r.id} item={i} date={p.date} onSelect={setSelected} />)
                        ) : (
                          <div className="rounded-[16px] border-[1.5px] border-dashed border-line px-3 py-2.5 text-[13.5px] text-mut">
                            {c.maintenance || !c.active ? 'Terrain indisponible' : 'Libre toute la journée'}
                          </div>
                        )}
                      </section>
                    );
                  })}
                  {!courts.length && <EmptyState>Aucun terrain.</EmptyState>}
                </div>
              ) : (
                <>
                  <PlanningBoard planning={{ ...p, courts }} onSelect={setSelected} isVisible={visible} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12.5px] text-mut">Glissez ← → pour les autres heures · touchez une case pour sa fiche</span>
                    <button type="button" aria-expanded={legend} className={chip(legend)} onClick={() => setLegend((v) => !v)}>
                      Légende {legend ? '▴' : '▾'}
                    </button>
                  </div>
                  {legend && <PlanningLegend planning={p} />}
                  <Card className="gap-2 p-3.5">
                    <span className="text-[13px] text-mut">Créneaux libres ce jour</span>
                    <div className="flex flex-wrap gap-1.5">
                      {courts.flatMap((c) => freeRanges(p, c).map(([a, b]) => <Pill key={`${c.id}${a}`} tone="g">{`${c.name} · ${rangesText([[a, b]])}`}</Pill>))}
                      {!courts.some((c) => freeRanges(p, c).length) && <span className="text-[13px] text-mut">Aucun créneau libre.</span>}
                    </div>
                  </Card>
                </>
              )}
              {selected && <PlanningDetail planning={p} item={selected} onClose={() => setSelected(undefined)} />}
            </>
          )}
        </QueryState>
      )}
    </div>
  );
}

/** Vue Semaine : remplissage de chaque terrain jour par jour ; toucher un jour ouvre sa liste. */
function WeekView({ week, data, loading, onPick }: { week: string[]; data: (Planning | undefined)[]; loading: boolean; onPick: (d: string) => void }) {
  const first = data.find(Boolean);
  if (!first) return <EmptyState>{loading ? 'Chargement…' : 'Aucune donnée.'}</EmptyState>;
  const openMin = (first.closingHour - first.openingHour) * 60;
  return (
    <div className="overflow-x-auto rounded-[26px] border-[1.5px] border-line bg-card p-3.5">
      <div className="grid min-w-[560px] gap-1.5" style={{ gridTemplateColumns: `88px repeat(${week.length}, 1fr)` }}>
        <div />
        {week.map((d) => (
          <button key={d} type="button" onClick={() => onPick(d)} className={`rounded-[12px] py-1 text-center text-[12px] font-semibold capitalize ${d === todayIso() ? 'bg-sel text-white' : 'text-mut'}`}>
            {fD(d, { weekday: 'short' })} {Number(d.slice(8))}
          </button>
        ))}
        {first.courts.map((c) => (
          <div key={c.id} className="contents">
            <div className="flex items-center text-[13px] font-semibold">{c.name}</div>
            {week.map((d, i) => {
              const p = data[i];
              const used = p ? busyMinutes(p, c.id) : 0;
              const pct = Math.min(100, Math.round((used / openMin) * 100));
              const n = p ? courtItems(p, c.id).length : 0;
              return (
                <button key={d} type="button" onClick={() => onPick(d)} title={`${c.name} · ${fD(d, { weekday: 'long', day: 'numeric' })} : ${n} créneau${n > 1 ? 'x' : ''}`} className="flex h-[44px] flex-col justify-end gap-1 rounded-[12px] bg-fld p-1.5 hover:bg-btn">
                  <span className="text-[11px] text-mut">{p ? `${n} · ${pct} %` : '…'}</span>
                  <span className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <span className="block h-full rounded-full bg-pri" style={{ width: `${pct}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="m-0 mt-2 text-[12px] text-mut">Nombre de créneaux · part de la journée occupée. Touchez un jour pour sa liste.</p>
    </div>
  );
}

