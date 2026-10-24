import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { DAY_FULL, WEEK } from '../../components/SlotsEditor';
import { Button } from '../../components/ui/Button';
import { Card, CardRow } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { SelectField, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill } from '../../components/ui/Pill';
import { Segmented } from '../../components/ui/Segmented';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { DAY_NAMES } from '../../lib/format';
import { durationOf, hm, ink, placementProblem, toMin, toTime, type Placed } from '../../lib/timetable';
import type { RawSlot, SlotKind, TempScheduleDetail, Timetable, TimetableGroup } from '../../lib/types';
import { useAction } from '../../lib/useAction';

/** Hauteur d'une demi-heure sur la grille (px). */
const ROW = 28;
const PHYSICAL = 'PHYSICAL';
const KEYS = [['timetable'], ['temp-schedule'], ['temp-schedules'], ['groups'], ['planning'], ['sessions']];

/** Séance prise (bouton « placer ») ou déplacée : groupe, type, durée, entraîneurs, et sa place si elle existe déjà. */
type Picked = { groupId: string; kind: SlotKind; dur: number; coachIds: string[]; fromIdx?: number; id?: string; courtId?: string | null };
type Target = { day: number; courtId: string | null; start: number };
type Drag = Picked & { x: number; y: number; grab: number; active: boolean; sx: number; sy: number; target?: Target; problem?: string | null; kindOfSource: 'chip' | 'block' };
/** Créneau affiché : modifiable (habituel ou de l'emploi des vacances) ou seulement montré (horaire habituel gardé). */
type Row = Placed & { key: string; editable: boolean; changed: boolean; idx: number };

/** « Court 2 » → « C2 » (colonnes étroites de la vue « Toute la semaine »). */
const shortCourt = (name: string) => name.replace(/^court\s*/i, 'C').slice(0, 6);

const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches;

export function TimetablePage() {
  const { me } = useAuth();
  const toast = useToast();
  const canManage = Boolean(me?.permissions.includes('groups.manage'));
  const [params, setParams] = useSearchParams();
  const mode = params.get('vacances') ?? '';
  const q = useQuery({ queryKey: ['timetable'], queryFn: () => api.get<Timetable>('/timetable') });
  const tq = useQuery({ queryKey: ['temp-schedule', mode], queryFn: () => api.get<TempScheduleDetail>(`/temp-schedules/${mode}`), enabled: Boolean(mode) });
  const t = q.data;
  const temp = mode ? tq.data : undefined;

  const [view, setView] = useState<'all' | 'week' | 'day'>(isPhone() ? 'day' : 'all');
  const [courtTab, setCourtTab] = useState<string>('');
  const [day, setDay] = useState(1);
  const [search, setSearch] = useState('');
  const [todoOnly, setTodoOnly] = useState(false);
  const [picked, setPicked] = useState<Picked>();
  const [drag, setDragState] = useState<Drag>();
  // Copie lue par les gestionnaires du pointeur (aucun effet dans une mise à jour d'état).
  const dragRef = useRef<Drag | undefined>(undefined);
  const setDrag = (d: Drag | undefined) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [editing, setEditing] = useState<Row>();
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [panelOpen, setPanelOpen] = useState(!isPhone());
  const undo = useRef<{ groupId: string; slots: RawSlot[] }[]>([]);
  const [, bump] = useState(0);
  const focusGroup = params.get('groupe');

  useEffect(() => {
    if (t && !courtTab) setCourtTab(t.courts[0]?.id ?? PHYSICAL);
  }, [t, courtTab]);
  useEffect(() => {
    if (!t || !focusGroup) return;
    const g = t.groups.find((x) => x.id === focusGroup);
    if (g) setSearch(g.name);
  }, [t, focusGroup]);

  // Créneaux modifiables par groupe (brouillon de l'horaire habituel, ou créneaux de l'emploi des vacances).
  const editableOf = (groupId: string): RawSlot[] => {
    if (!t) return [];
    if (temp) {
      const g = temp.groups.find((x) => x.id === groupId);
      return (g?.slots ?? []).map((s) => ({ id: s.id, day: s.day, startTime: s.startTime, endTime: s.endTime, courtId: s.court?.id ?? null, coachIds: s.coaches.map((c) => c.id), kind: s.kind ?? 'TENNIS' }));
    }
    const g = t.groups.find((x) => x.id === groupId);
    return g ? (g.draft ?? g.published) : [];
  };

  const rows: Row[] = useMemo(() => {
    if (!t) return [];
    const out: Row[] = [];
    for (const g of t.groups) {
      const tg = temp?.groups.find((x) => x.id === g.id);
      if (temp && tg) {
        tg.slots.forEach((s, idx) =>
          out.push({
            key: `t${s.id}`,
            groupId: g.id,
            groupName: g.name,
            slot: { id: s.id, day: s.day, startTime: s.startTime, endTime: s.endTime, courtId: s.court?.id ?? null, coachIds: s.coaches.map((c) => c.id), kind: s.kind ?? 'TENNIS' },
            editable: canManage,
            changed: false,
            idx,
          }),
        );
        // Horaire habituel gardé pendant les vacances : séances en plus, ou groupe absent de l'emploi.
        if (tg.mode === 'ADD' || (!tg.mode && tg.usualRuns)) {
          tg.usualSlots.forEach((s, idx) =>
            out.push({
              key: `u${s.id}`,
              groupId: g.id,
              groupName: g.name,
              slot: { id: s.id, day: s.day, startTime: s.startTime, endTime: s.endTime, courtId: s.court?.id ?? null, coachIds: s.coaches.map((c) => c.id), kind: s.kind ?? 'TENNIS' },
              editable: false,
              changed: false,
              idx,
            }),
          );
        }
        continue;
      }
      (g.draft ?? g.published).forEach((s, idx) =>
        out.push({ key: `${g.id}:${s.id ?? idx}:${idx}`, groupId: g.id, groupName: g.name, slot: s, editable: canManage, changed: Boolean(g.draft), idx }),
      );
    }
    return out;
  }, [t, temp, canManage]);

  const saveAction = useAction(
    async ({ groupId, slots, push = true }: { groupId: string; slots: RawSlot[]; push?: boolean }) => {
      const prev = editableOf(groupId);
      if (temp) {
        const g = temp.groups.find((x) => x.id === groupId);
        await api.put(`/temp-schedules/${temp.id}/groups/${groupId}`, {
          mode: g?.mode ?? 'REPLACE',
          version: temp.version,
          slots: slots.map((s) => ({ ...s, courtId: s.courtId ?? undefined })),
        });
      } else {
        await api.put(`/timetable/draft/groups/${groupId}`, { version: t!.draft.version, slots: slots.map((s) => ({ ...s, courtId: s.courtId ?? undefined })) });
      }
      if (push) {
        undo.current.push({ groupId, slots: prev });
        bump((n) => n + 1);
      }
    },
    { invalidate: KEYS },
  );
  const save = (groupId: string, slots: RawSlot[], push = true) => saveAction.mutate({ groupId, slots, push });

  const undoLast = () => {
    const last = undo.current.pop();
    bump((n) => n + 1);
    if (last) save(last.groupId, last.slots, false);
  };

  const auto = useAction((v: { groupId: string; kind: SlotKind }) => api.post<{ placed: number }>(`/timetable/draft/auto/${v.groupId}`, { version: t!.draft.version, kind: v.kind }), {
    invalidate: KEYS,
    success: (r) => `${r.placed} séance${r.placed > 1 ? 's' : ''} placée${r.placed > 1 ? 's' : ''} : vérifiez puis publiez.`,
  });
  const revert = useAction((groupId: string) => api.delete(`/timetable/draft/groups/${groupId}`, { version: t!.draft.version }), {
    invalidate: KEYS,
    success: 'Changements du groupe annulés.',
  });
  const discard = useAction(() => api.delete('/timetable/draft', { version: t!.draft.version }), {
    invalidate: KEYS,
    success: 'Brouillon abandonné.',
    onSuccess: () => {
      undo.current = [];
      setDiscarding(false);
    },
  });

  // Colonnes : jours de la semaine pour un terrain, ou terrains (et hors terrain) pour un jour.
  const columns: { day: number; courtId: string | null; label: string; first?: boolean }[] = useMemo(() => {
    if (!t) return [];
    // Toute la semaine : chaque jour découpé en terrains (et hors terrain).
    if (view === 'all') {
      return WEEK.flatMap((d) => [
        ...t.courts.map((c, i) => ({ day: d, courtId: c.id as string | null, label: shortCourt(c.name), first: i === 0 })),
        { day: d, courtId: null, label: 'Phys.' },
      ]);
    }
    if (view === 'week') return WEEK.map((d) => ({ day: d, courtId: courtTab === PHYSICAL ? null : courtTab, label: DAY_NAMES[d] }));
    return [...t.courts.map((c) => ({ day, courtId: c.id as string | null, label: `${c.name}${c.lit ? ' ☀' : ''}` })), { day, courtId: null, label: 'Physique' }];
  }, [t, view, courtTab, day]);

  const coachColor = (ids: string[]) => t?.coaches.find((c) => c.id === ids[0])?.color ?? '#8a8a8f';
  const othersFor = (p: Picked): Placed[] => rows.filter((r) => !(r.groupId === p.groupId && r.editable && r.idx === p.fromIdx));
  const candidateAt = (p: Picked, target: Target): Placed => {
    const g = t!.groups.find((x) => x.id === p.groupId)!;
    return {
      groupId: p.groupId,
      groupName: g.name,
      slot: {
        id: p.id,
        day: target.day,
        startTime: toTime(target.start),
        endTime: toTime(target.start + p.dur),
        courtId: p.kind === 'TENNIS' ? target.courtId : target.courtId,
        coachIds: p.coachIds,
        kind: p.kind,
      },
    };
  };
  const problemAt = (p: Picked, target: Target) => {
    const g = t!.groups.find((x) => x.id === p.groupId)!;
    if (!temp && p.fromIdx === undefined) {
      const left = remaining(g, editableOf(g.id), p.kind);
      if (left !== null && left < p.dur) return `Volume de « ${g.name} » déjà placé`;
    }
    return placementProblem(t!, candidateAt(p, target), othersFor(p));
  };

  const place = (p: Picked, target: Target) => {
    const problem = problemAt(p, target);
    if (problem) return toast(problem);
    const list = [...editableOf(p.groupId)];
    const next = candidateAt(p, target).slot;
    if (p.fromIdx !== undefined) list[p.fromIdx] = next;
    else list.push(next);
    setPicked(undefined);
    save(p.groupId, list);
  };

  // Glisser-déposer fait main (souris, stylet, doigt) : la case visée est celle sous le pointeur.
  const targetFromPoint = (x: number, y: number, grab: number): Target | undefined => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-col]');
    if (!el || !t) return undefined;
    const rect = el.getBoundingClientRect();
    const steps = Math.round((y - rect.top - grab) / ROW);
    const start = t.hours.opening * 60 + Math.max(0, steps) * 30;
    return { day: Number(el.dataset.day), courtId: el.dataset.court || null, start };
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const active = d.active || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6;
      const target = active ? targetFromPoint(e.clientX, e.clientY, d.grab) : undefined;
      setDrag({ ...d, x: e.clientX, y: e.clientY, active, target, problem: target ? problemAt(d, target) : undefined });
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(undefined);
      if (!d) return;
      if (d.active && d.target) {
        if (d.problem) toast(d.problem);
        else place(d, d.target);
      } else if (!d.active) {
        // Simple toucher : une pastille se prend (puis toucher une case) ; une séance s'ouvre.
        if (d.kindOfSource === 'chip') {
          const same = picked && picked.groupId === d.groupId && picked.kind === d.kind && picked.fromIdx === undefined;
          setPicked(same ? undefined : { groupId: d.groupId, kind: d.kind, dur: d.dur, coachIds: d.coachIds });
        } else {
          const row = rows.find((r) => r.groupId === d.groupId && r.editable && r.idx === d.fromIdx);
          if (row) setEditing(row);
        }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.groupId, drag?.fromIdx, drag?.kind, rows, picked]);

  const startDrag = (e: ReactPointerEvent, p: Picked, source: 'chip' | 'block') => {
    if (!canManage || e.button > 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const grab = source === 'block' ? e.clientY - rect.top : ROW / 2;
    setDrag({ ...p, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, grab, active: false, kindOfSource: source });
  };

  if (!t) {
    return (
      <>
        <PageHeader title="Emploi du temps" subtitle="Découvrez les séances de chaque groupe sur la grille de la semaine." />
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {null}
        </QueryState>
      </>
    );
  }

  const opening = t.hours.opening * 60;
  const closing = t.hours.closing * 60;
  const nRows = (closing - opening) / 30;
  const changes = t.draft.changes;
  const groupsShown = t.groups.filter((g) => {
    if (temp && !temp.groups.find((x) => x.id === g.id)?.mode) return false;
    if (search && !g.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (todoOnly && !temp) {
      const eff = g.draft ?? g.published;
      return (remaining(g, eff, 'TENNIS') ?? 0) > 0 || (remaining(g, eff, 'PHYSICAL') ?? 0) > 0;
    }
    return true;
  });

  // Heures des entraîneurs dans la semaine affichée (salaires).
  const coachMinutes = new Map<string, number>();
  for (const r of rows) for (const c of r.slot.coachIds) coachMinutes.set(c, (coachMinutes.get(c) ?? 0) + durationOf(r.slot));

  const inColumn = (r: Row, col: { day: number; courtId: string | null }) =>
    r.slot.day === col.day && (col.courtId ? r.slot.courtId === col.courtId : !r.slot.courtId && r.slot.kind === 'PHYSICAL');

  return (
    <>
      <PageHeader
        title="Emploi du temps"
        subtitle={canManage ? 'Glissez les séances de chaque groupe sur la grille ; les conflits s’affichent en direct.' : 'Découvrez les séances de chaque groupe sur la grille de la semaine.'}
        action={
          canManage && (
            <div className="no-print flex flex-wrap items-center gap-2">
              {!temp &&
                (changes.length ? (
                  <Pill tone="s">{`Brouillon · ${changes.length} groupe${changes.length > 1 ? 's' : ''} modifié${changes.length > 1 ? 's' : ''}`}</Pill>
                ) : (
                  <Pill tone="g">À jour</Pill>
                ))}
              {temp && <Pill tone={temp.status === 'PUBLISHED' ? 'g' : 's'}>{temp.status === 'PUBLISHED' ? 'Vacances publiées' : 'Vacances en brouillon'}</Pill>}
              <Button onClick={undoLast} disabled={!undo.current.length || saveAction.isPending}>
                ↶ Annuler
              </Button>
              <Button onClick={() => window.print()}>Imprimer</Button>
              {!temp && changes.length > 0 && <Button onClick={() => setDiscarding(true)}>Abandonner</Button>}
              {!temp ? (
                <Button variant="primary" onClick={() => setPublishing(true)} disabled={!changes.length}>
                  Publier…
                </Button>
              ) : (
                <Link to={`/admin/vacances/${temp.id}`} className="inline-flex items-center rounded-full bg-pri px-4 py-[9px] text-sm font-medium text-white">
                  Fiche des vacances
                </Link>
              )}
            </div>
          )
        }
      />

      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        {t.schedules.length > 0 && (
          <Segmented<string>
            label="Horaire affiché"
            value={mode}
            onChange={(v) => {
              setParams(v ? { vacances: v } : {});
              setPicked(undefined);
              undo.current = [];
            }}
            options={[{ value: '', label: 'Horaire habituel' }, ...t.schedules.map((s) => ({ value: s.id, label: s.name }))]}
          />
        )}
        <Segmented<'all' | 'week' | 'day'>
          label="Vue"
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: 'Toute la semaine' },
            { value: 'week', label: 'Semaine par terrain' },
            { value: 'day', label: 'Jour (tous les terrains)' },
          ]}
        />
        {view === 'all' ? null : view === 'week' ? (
          <Segmented<string>
            label="Terrain"
            value={courtTab}
            onChange={setCourtTab}
            options={[...t.courts.map((c) => ({ value: c.id, label: `${c.name}${c.lit ? ' ☀' : ''}` })), { value: PHYSICAL, label: 'Physique (hors terrain)' }]}
          />
        ) : (
          <Segmented<string> label="Jour" value={String(day)} onChange={(v) => setDay(Number(v))} options={WEEK.map((d) => ({ value: String(d), label: DAY_NAMES[d] }))} />
        )}
      </div>

      {picked && (
        <div className="no-print mb-3 flex flex-wrap items-center gap-2 rounded-[18px] bg-fld px-4 py-2.5 text-sm">
          <span>
            {`${t.groups.find((g) => g.id === picked.groupId)?.name} · ${picked.kind === 'PHYSICAL' ? 'physique' : 'tennis'} ${hm(picked.dur)} : touchez une case verte de la grille.`}
          </span>
          <Button onClick={() => setPicked(undefined)}>Annuler</Button>
        </div>
      )}

      {/* Toute la semaine : la grille prend toute la largeur, les séances à placer passent en bandeau au-dessus. */}
      <div className={`grid grid-cols-1 items-start gap-4 ${view === 'all' ? '' : 'min-[1100px]:grid-cols-[300px_1fr]'}`}>
        {/* Séances à placer */}
        <div className="no-print flex flex-col gap-2.5">
          <Card>
            <CardRow>
              <h3>{temp ? `Groupes de « ${temp.name} »` : 'Séances à placer'}</h3>
              <Button className="min-[1100px]:hidden" onClick={() => setPanelOpen(!panelOpen)}>
                {panelOpen ? 'Masquer' : 'Afficher'}
              </Button>
            </CardRow>
            {panelOpen && (
              <>
                <p className="m-0 text-[12.5px] text-mut">
                  {temp
                    ? 'Créneaux des vacances de chaque groupe. Ajoutez un groupe depuis la fiche des vacances.'
                    : 'Volume de chaque groupe réglé dans sa fiche : il ne peut pas être dépassé.'}
                </p>
                <TextField label="Chercher un groupe" value={search} onChange={(e) => setSearch(e.target.value)} />
                {!temp && (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-pri" checked={todoOnly} onChange={(e) => setTodoOnly(e.target.checked)} />
                    Séances à placer seulement
                  </label>
                )}
              </>
            )}
          </Card>
          {panelOpen && (
            <div className={view === 'all' ? 'flex gap-2.5 overflow-x-auto pb-1 [&>*]:w-[280px] [&>*]:flex-none' : 'contents'}>
            {groupsShown.map((g) => (
              <GroupCard
                key={g.id}
                g={g}
                slots={editableOf(g.id)}
                temp={Boolean(temp)}
                canManage={canManage}
                focused={g.id === focusGroup}
                picked={picked}
                coachColor={coachColor}
                onPointerDown={startDrag}
                onPick={(p) => setPicked(picked && picked.groupId === p.groupId && picked.kind === p.kind && picked.fromIdx === undefined ? undefined : p)}
                onAuto={(kind) => auto.mutate({ groupId: g.id, kind })}
                onRevert={() => revert.mutate(g.id)}
              />
            ))}
            </div>
          )}
          {panelOpen && (
            <Note>
              {'Heures des entraîneurs cette semaine : '}
              {[...coachMinutes.entries()]
                .map(([id, m]) => ({ c: t.coaches.find((x) => x.id === id), m }))
                .filter((x) => x.c)
                .sort((a, b) => b.m - a.m)
                .map((x) => `${x.c!.firstName} ${hm(x.m)}`)
                .join(' · ') || '—'}
            </Note>
          )}
        </div>

        {/* Grille */}
        <div className="min-w-0">
          <div className="overflow-x-auto rounded-[20px] border-[1.5px] border-line bg-card">
            <div className="grid" style={{ gridTemplateColumns: `52px repeat(${columns.length}, minmax(${view === 'all' ? 40 : view === 'week' ? 92 : 104}px, 1fr))` }}>
              {view === 'all' && (
                <>
                  <div className="bg-dr" />
                  {WEEK.map((d) => (
                    <div
                      key={d}
                      className="border-s-2 border-line bg-dr pt-2 text-center text-[13px] font-semibold"
                      style={{ gridColumn: `span ${t.courts.length + 1}` }}
                    >
                      {DAY_FULL[d]}
                    </div>
                  ))}
                </>
              )}
              <div className="sticky start-0 border-b-[1.5px] border-line bg-dr" />
              {columns.map((c) => (
                <div
                  key={`${c.day}${c.courtId}`}
                  className={`border-b-[1.5px] border-line bg-dr text-center font-semibold ${view === 'all' ? `py-1 text-[11px] text-mut ${c.first ? 'border-s-2' : ''}` : 'py-2 text-[13px]'}`}
                >
                  {c.label}
                </div>
              ))}
              <div className="border-e-[1.5px] border-line bg-card">
                {Array.from({ length: nRows }, (_, i) => {
                  const m = opening + i * 30;
                  return (
                    <div key={i} className="pe-1.5 pt-0.5 text-end text-[11px] text-mut" style={{ height: ROW }} dir="ltr">
                      {m % 60 === 0 ? `${toTime(m)}${m >= t.hours.nightStart * 60 ? ' ☾' : ''}` : ''}
                    </div>
                  );
                })}
              </div>
              {columns.map((col) => (
                <div
                  key={`${col.day}${col.courtId}`}
                  data-col
                  data-day={col.day}
                  data-court={col.courtId ?? ''}
                  className={`relative border-e border-line last:border-e-0 ${col.first ? 'border-s-2' : ''}`}
                >
                  {Array.from({ length: nRows }, (_, i) => {
                    const start = opening + i * 30;
                    const night = start >= t.hours.nightStart * 60;
                    const target = { day: col.day, courtId: col.courtId, start };
                    const state = picked ? (problemAt(picked, target) ? 'bad' : 'ok') : null;
                    return (
                      <button
                        key={i}
                        type="button"
                        tabIndex={picked ? 0 : -1}
                        aria-label={`${DAY_FULL[col.day]} ${toTime(start)}${col.courtId ? `, ${t.courts.find((c) => c.id === col.courtId)?.name}` : ', hors terrain'} : placer ici`}
                        onClick={() => picked && place(picked, target)}
                        className={`block w-full border-b ${i % 2 ? 'border-line' : 'border-dashed border-line/60'} ${
                          state === 'ok' ? 'bg-[#dff3a8]/60' : state === 'bad' ? 'bg-[#fdb3b0]/25' : night ? 'bg-day' : ''
                        }`}
                        style={{ height: ROW }}
                      />
                    );
                  })}
                  {rows
                    .filter((r) => inColumn(r, col))
                    .map((r) => {
                      const color = coachColor(r.slot.coachIds);
                      const top = ((toMin(r.slot.startTime) - opening) / 30) * ROW;
                      const height = (durationOf(r.slot) / 30) * ROW - 3;
                      const g = t.groups.find((x) => x.id === r.groupId)!;
                      const moving = drag?.active && drag.kindOfSource === 'block' && drag.groupId === r.groupId && drag.fromIdx === r.idx && r.editable;
                      return (
                        <button
                          key={r.key}
                          type="button"
                          onPointerDown={(e) =>
                            r.editable &&
                            startDrag(e, { groupId: r.groupId, kind: r.slot.kind, dur: durationOf(r.slot), coachIds: r.slot.coachIds, fromIdx: r.idx, id: r.slot.id }, 'block')
                          }
                          onClick={() => {
                            if (!r.editable) setEditing(r);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setEditing(r);
                            }
                          }}
                          aria-label={`${g.name}, ${DAY_FULL[r.slot.day]} ${r.slot.startTime}–${r.slot.endTime}${r.slot.kind === 'PHYSICAL' ? ', séance physique' : ''}${r.editable ? '. Modifier' : ''}`}
                          title={`${g.name} · ${DAY_FULL[r.slot.day]} ${r.slot.startTime}–${r.slot.endTime}${r.slot.courtId ? ` · ${t.courts.find((c) => c.id === r.slot.courtId)?.name}` : ''}`}
                          className={`absolute overflow-hidden rounded-[12px] text-start font-semibold leading-tight ${view === 'all' ? 'inset-x-0.5 px-1 py-0.5 text-[10px]' : 'inset-x-1 px-1.5 py-1 text-[11.5px]'} ${r.editable ? 'cursor-grab touch-none' : 'opacity-60'} ${moving ? 'opacity-30' : ''}`}
                          style={{
                            top: top + 1,
                            height,
                            background: color,
                            color: ink(color),
                            outline: r.slot.kind === 'PHYSICAL' ? `2px dashed ${ink(color)}` : r.changed ? '2px solid var(--pri)' : undefined,
                            outlineOffset: r.slot.kind === 'PHYSICAL' ? -4 : 0,
                          }}
                        >
                          <span className="block truncate">{g.name}</span>
                          <span className="block truncate font-medium opacity-90" dir="ltr">
                            {view === 'all' ? r.slot.startTime : `${r.slot.startTime}–${r.slot.endTime}`}
                          </span>
                          {r.slot.kind === 'PHYSICAL' && <span className="block truncate font-medium opacity-90">Physique</span>}
                        </button>
                      );
                    })}
                  {drag?.active && drag.target && drag.target.day === col.day && (drag.target.courtId ?? null) === col.courtId && (
                    <div
                      aria-hidden="true"
                      className={`pointer-events-none absolute inset-x-1 rounded-[12px] border-[2.5px] border-dashed ${drag.problem ? 'border-[#e5484d] bg-[#fdb3b0]/50' : 'border-[#2f9e44] bg-[#dff3a8]/60'}`}
                      style={{ top: ((drag.target.start - opening) / 30) * ROW + 1, height: (drag.dur / 30) * ROW - 3 }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-mut">
            {t.coaches
              .filter((c) => coachMinutes.has(c.id))
              .map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1.5">
                  <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                  {c.firstName}
                </span>
              ))}
            <span>☾ dès {t.hours.nightStart} h (terrain éclairé ☀)</span>
            <span>Bordure pointillée : séance physique</span>
            {!temp && <span>Bordure indigo : modifié, pas encore publié</span>}
          </div>
        </div>
      </div>

      {/* Séance tenue au doigt ou à la souris, avec la raison d'un refus */}
      {drag?.active && (
        <div className="pointer-events-none fixed z-[70] flex flex-col gap-1" style={{ left: drag.x + 14, top: drag.y + 12 }}>
          <span className="rounded-[12px] px-2.5 py-1.5 text-[12px] font-semibold" style={{ background: coachColor(drag.coachIds), color: ink(coachColor(drag.coachIds)) }}>
            {t.groups.find((g) => g.id === drag.groupId)?.name} · {hm(drag.dur)}
          </span>
          {drag.target && (
            <span className={`rounded-[12px] px-2.5 py-1.5 text-[12px] text-white ${drag.problem ? 'bg-[#e5484d]' : 'bg-fg text-bg'}`}>
              {drag.problem ? `✕ ${drag.problem}` : `✓ ${DAY_NAMES[drag.target.day]} ${toTime(drag.target.start)}–${toTime(drag.target.start + drag.dur)}`}
            </span>
          )}
        </div>
      )}

      {editing && (
        <SlotModal
          t={t}
          row={editing}
          onClose={() => setEditing(undefined)}
          onMove={() => {
            setPicked({ groupId: editing.groupId, kind: editing.slot.kind, dur: durationOf(editing.slot), coachIds: editing.slot.coachIds, fromIdx: editing.idx, id: editing.slot.id });
            setEditing(undefined);
          }}
          onSave={(slot) => {
            const others = rows.filter((r) => r.key !== editing.key);
            const problem = placementProblem(t, { groupId: editing.groupId, groupName: editing.groupName, slot }, others);
            if (problem) return toast(problem);
            const list = [...editableOf(editing.groupId)];
            list[editing.idx] = slot;
            save(editing.groupId, list);
            setEditing(undefined);
          }}
          onRemove={() => {
            const list = editableOf(editing.groupId).filter((_, i) => i !== editing.idx);
            save(editing.groupId, list);
            setEditing(undefined);
          }}
        />
      )}
      {publishing && <PublishModal t={t} onClose={() => setPublishing(false)} onDone={() => (undo.current = [])} />}
      <ConfirmModal
        open={discarding}
        title="Abandonner le brouillon ?"
        text="Tous les changements non publiés seront perdus ; l’emploi du temps publié reste tel quel."
        cta="Abandonner"
        pending={discard.isPending}
        onConfirm={() => discard.mutate()}
        onClose={() => setDiscarding(false)}
      />
      {saveAction.isError && <span className="sr-only">{errorMessage(saveAction.error)}</span>}
    </>
  );
}

/** Minutes encore à placer pour un type de séance (null = volume libre). */
function remaining(g: TimetableGroup, slots: RawSlot[], kind: SlotKind): number | null {
  const weekly = kind === 'TENNIS' ? g.weeklyMinutes : g.physicalMinutes;
  if (!weekly) return null;
  return weekly - slots.filter((s) => s.kind === kind).reduce((t, s) => t + durationOf(s), 0);
}

function GroupCard({
  g,
  slots,
  temp,
  canManage,
  focused,
  picked,
  coachColor,
  onPointerDown,
  onPick,
  onAuto,
  onRevert,
}: {
  g: TimetableGroup;
  slots: RawSlot[];
  temp: boolean;
  canManage: boolean;
  focused: boolean;
  picked?: Picked;
  coachColor: (ids: string[]) => string;
  onPointerDown: (e: ReactPointerEvent, p: Picked, source: 'chip') => void;
  onPick: (p: Picked) => void;
  onAuto: (kind: SlotKind) => void;
  onRevert: () => void;
}) {
  const lines: { kind: SlotKind; label: string; weekly: number | null; dur: number; coachIds: string[] }[] = [
    { kind: 'TENNIS', label: 'Tennis', weekly: g.weeklyMinutes, dur: g.sessionMinutes ?? 60, coachIds: g.mainCoachId ? [g.mainCoachId] : [] },
  ];
  if (g.physicalMinutes) {
    const coach = g.physicalCoachId ?? g.mainCoachId;
    lines.push({ kind: 'PHYSICAL', label: 'Physique', weekly: g.physicalMinutes, dur: g.physicalSessionMinutes ?? 60, coachIds: coach ? [coach] : [] });
  }
  return (
    <div className={`rounded-[18px] border-[1.5px] bg-card p-3 ${focused ? 'border-pri' : 'border-line'}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <b className="truncate text-[14.5px] font-semibold">{g.name}</b>
        {g.draft && !temp && <Pill tone="s">Modifié</Pill>}
      </div>
      {lines.map((l) => {
        const used = slots.filter((s) => s.kind === l.kind).reduce((t, s) => t + durationOf(s), 0);
        const left = temp ? null : l.weekly ? l.weekly - used : null;
        const chips = left === null ? 1 : Math.max(0, Math.floor(left / l.dur));
        const done = left !== null && left <= 0;
        return (
          <div key={l.kind} className="mt-1.5">
            <div className="flex items-center justify-between gap-2 text-[12px] text-mut">
              <span>
                {l.label} : {temp ? `${hm(used)} placées` : l.weekly ? `${hm(used)} / ${hm(l.weekly)}` : `volume libre (${hm(used)})`} · séances de {hm(l.dur)}
              </span>
              {done && <span className="text-[#2f9e44]">✓</span>}
            </div>
            {l.weekly && !temp && (
              <div className="mt-1 h-[7px] overflow-hidden rounded-full bg-fld">
                <i className="block h-full rounded-full bg-[#2f9e44]" style={{ width: `${Math.min(100, (used / l.weekly) * 100)}%` }} />
              </div>
            )}
            {canManage && chips > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onPointerDown={(e) => onPointerDown(e, { groupId: g.id, kind: l.kind, dur: l.dur, coachIds: l.coachIds, courtId: g.preferredCourtId }, 'chip')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onPick({ groupId: g.id, kind: l.kind, dur: l.dur, coachIds: l.coachIds });
                    }
                  }}
                  aria-pressed={picked?.groupId === g.id && picked.kind === l.kind && picked.fromIdx === undefined}
                  aria-label={`Placer une séance de ${l.label.toLowerCase()} de ${hm(l.dur)} pour ${g.name}`}
                  className={`inline-flex cursor-grab touch-none items-center gap-1.5 rounded-[12px] px-2.5 py-1.5 text-[12.5px] font-semibold ${
                    picked?.groupId === g.id && picked.kind === l.kind && picked.fromIdx === undefined ? 'outline outline-[3px] outline-sel' : ''
                  }`}
                  style={{ background: coachColor(l.coachIds), color: ink(coachColor(l.coachIds)), border: l.kind === 'PHYSICAL' ? `2px dashed ${ink(coachColor(l.coachIds))}` : undefined }}
                >
                  ⠿ {l.kind === 'PHYSICAL' ? 'Physique ' : ''}
                  {hm(l.dur)}
                  {left !== null && chips > 1 ? ` × ${chips}` : ''}
                </button>
                {!temp && left !== null && (
                  <button type="button" onClick={() => onAuto(l.kind)} className="rounded-full bg-btn px-3 py-1.5 text-[12px] font-medium">
                    Placer automatiquement
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {canManage && g.draft && !temp && (
        <button type="button" onClick={onRevert} className="mt-2 text-[12px] text-mut underline">
          Revenir à l’horaire publié
        </button>
      )}
    </div>
  );
}

/** Fiche d'une séance de la grille : jour, heure, terrain, entraîneurs ; déplacer ou retirer. */
function SlotModal({
  t,
  row,
  onClose,
  onSave,
  onMove,
  onRemove,
}: {
  t: Timetable;
  row: Row;
  onClose: () => void;
  onSave: (slot: RawSlot) => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const g = t.groups.find((x) => x.id === row.groupId)!;
  const [f, setF] = useState(row.slot);
  const fixed = row.slot.kind === 'TENNIS' ? g.sessionMinutes : g.physicalSessionMinutes;
  const dur = durationOf(f);
  const setStart = (v: string) => setF({ ...f, startTime: v, endTime: fixed ? toTime(toMin(v) + fixed) : toTime(toMin(v) + Math.max(30, dur)) });
  return (
    <Modal
      open
      title={`${g.name} · ${row.slot.kind === 'PHYSICAL' ? 'séance physique' : 'tennis'}`}
      onClose={onClose}
      footer={
        row.editable ? (
          <>
            <Button variant="danger" onClick={onRemove}>
              Retirer
            </Button>
            <Button onClick={onMove}>Déplacer sur la grille</Button>
            <Button variant="primary" onClick={() => onSave(f)}>
              Enregistrer
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Fermer</Button>
        )
      }
    >
      {!row.editable && <p className="m-0 mb-2 text-[13px] text-mut">Horaire habituel gardé pendant les vacances : il se modifie dans l’horaire habituel.</p>}
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Jour" value={String(f.day)} disabled={!row.editable} onChange={(e) => setF({ ...f, day: Number(e.target.value) })}>
          {WEEK.map((d) => (
            <option key={d} value={d}>
              {DAY_FULL[d]}
            </option>
          ))}
        </SelectField>
        <TextField label="Début" type="time" step={1800} value={f.startTime} disabled={!row.editable} onChange={(e) => setStart(e.target.value)} />
        <TextField
          label={fixed ? `Fin (séance de ${hm(fixed)})` : 'Fin'}
          type="time"
          step={1800}
          value={f.endTime}
          disabled={!row.editable || Boolean(fixed)}
          onChange={(e) => setF({ ...f, endTime: e.target.value })}
        />
        <SelectField label="Terrain" value={f.courtId ?? ''} disabled={!row.editable} onChange={(e) => setF({ ...f, courtId: e.target.value || null })}>
          {row.slot.kind === 'PHYSICAL' && <option value="">Hors terrain</option>}
          {row.slot.kind === 'TENNIS' && !f.courtId && <option value="">—</option>}
          {t.courts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.lit ? ' ☀' : ''}
            </option>
          ))}
        </SelectField>
      </div>
      <div role="group" aria-label="Entraîneurs de la séance" className="mt-3 flex flex-wrap gap-1.5">
        <span className="me-1 self-center text-xs font-medium text-mut">Entraîneurs :</span>
        {t.coaches.map((c) => {
          const on = f.coachIds.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              disabled={!row.editable}
              aria-pressed={on}
              onClick={() => setF({ ...f, coachIds: on ? f.coachIds.filter((x) => x !== c.id) : [...f.coachIds, c.id] })}
              className={`inline-flex items-center gap-1.5 rounded-full px-[11px] py-[5px] text-[13px] font-medium ${on ? 'bg-toggle text-bg' : 'bg-btn text-fg'}`}
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
              {c.firstName} {c.lastName}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/** Publication du brouillon : résumé des changements, familles et entraîneurs prévenus au choix. */
function PublishModal({ t, onClose, onDone }: { t: Timetable; onClose: () => void; onDone: () => void }) {
  const [notify, setNotify] = useState(true);
  const publish = useAction(() => api.post<{ groups: number; notified: number }>('/timetable/draft/publish', { version: t.draft.version, notify }), {
    invalidate: KEYS,
    success: (r) => `Emploi du temps publié (${r.groups} groupe${r.groups > 1 ? 's' : ''}${r.notified ? `, ${r.notified} personnes prévenues` : ''}).`,
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      open
      size="lg"
      title="Publier le nouvel emploi du temps ?"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={() => publish.mutate()} disabled={publish.isPending}>
            Publier
          </Button>
        </>
      }
    >
      <p className="m-0 text-mut">Le planning, les séances et les présences suivent le nouvel horaire dès la publication.</p>
      <div className="mt-3 flex flex-col gap-2">
        {t.draft.changes.map((c) => (
          <div key={c.groupId} className="rounded-[16px] bg-fld px-3 py-2 text-[13px]">
            <b className="font-semibold">{c.groupName}</b>
            <div className="text-mut">Avant : {c.before}</div>
            <div>Après : {c.after}</div>
          </div>
        ))}
      </div>
      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-pri" />
        Prévenir les familles et les entraîneurs (notification)
      </label>
    </Modal>
  );
}
