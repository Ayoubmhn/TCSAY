import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fullName } from '../lib/format';
import type { Coach, Court, Slot, SlotKind } from '../lib/types';
import { IconButton } from './ui/Button';
import { SelectField, TextField } from './ui/Field';

export const WEEK = [1, 2, 3, 4, 5, 6, 0]; // lundi → dimanche
export const DAY_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** Créneau en cours de saisie : jour, horaire, terrain, un ou plusieurs entraîneurs. */
export type SlotForm = { key: string; id?: string; day: number; startTime: string; endTime: string; courtId: string; coachIds: string[]; kind: SlotKind };

let seq = 0;
export const newSlot = (day = 1): SlotForm => ({ key: `n${seq++}`, day, startTime: '17:30', endTime: '19:00', courtId: '', coachIds: [], kind: 'TENNIS' });

/** Créneau existant → formulaire (`keepId` : modification ; sinon copie, ex. « Copier l'horaire habituel »). */
export const slotToForm = (s: Slot, keepId = true): SlotForm => ({
  key: keepId ? s.id : `n${seq++}`,
  id: keepId ? s.id : undefined,
  day: s.day,
  startTime: s.startTime,
  endTime: s.endTime,
  courtId: s.court?.id ?? '',
  coachIds: s.coaches.map((c) => c.id),
  kind: s.kind ?? 'TENNIS',
});

export const slotsPayload = (slots: SlotForm[]) =>
  slots.map((s) => ({ id: s.id, day: s.day, startTime: s.startTime, endTime: s.endTime, courtId: s.courtId || undefined, coachIds: s.coachIds, kind: s.kind }));

/** Premier créneau dont la fin ne suit pas le début (message prêt à afficher). */
export function badSlot(slots: SlotForm[]): string | null {
  const bad = slots.find((s) => s.endTime <= s.startTime);
  return bad ? `${DAY_FULL[bad.day]} : l’heure de fin doit suivre l’heure de début.` : null;
}

/**
 * Liste de créneaux modifiables (groupes, emplois temporaires des vacances). `days` limite les jours proposés
 * (ex. jours compris dans les dates des vacances).
 */
export function SlotsEditor({ slots, onChange, days = WEEK }: { slots: SlotForm[]; onChange: (slots: SlotForm[]) => void; days?: number[] }) {
  const coaches = useQuery({ queryKey: ['coaches'], queryFn: () => api.get<Coach[]>('/coaches') });
  const courts = useQuery({ queryKey: ['courts'], queryFn: () => api.get<Court[]>('/courts') });
  const activeCoaches = coaches.data?.filter((c) => c.isActive) ?? [];
  const setSlot = (key: string, patch: Partial<SlotForm>) => onChange(slots.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const ordered = WEEK.filter((d) => days.includes(d));

  return (
    <>
      {slots.map((s, i) => (
        <fieldset key={s.key} className="flex flex-col gap-2.5 rounded-[20px] border-[1.5px] border-line p-3">
          <legend className="sr-only">Créneau {i + 1}</legend>
          <div className="grid grid-cols-2 gap-2.5 min-[521px]:grid-cols-[1fr_1.1fr_1fr_1fr_1.3fr_auto]">
            <SelectField label="Séance" value={s.kind} onChange={(e) => setSlot(s.key, { kind: e.target.value as SlotKind })}>
              <option value="TENNIS">Tennis</option>
              <option value="PHYSICAL">Physique</option>
            </SelectField>
            <SelectField label="Jour" value={String(s.day)} onChange={(e) => setSlot(s.key, { day: Number(e.target.value) })}>
              {(ordered.includes(s.day) ? ordered : [s.day, ...ordered]).map((d) => (
                <option key={d} value={d}>
                  {DAY_FULL[d]}
                </option>
              ))}
            </SelectField>
            <TextField label="Début" type="time" value={s.startTime} onChange={(e) => setSlot(s.key, { startTime: e.target.value })} />
            <TextField label="Fin" type="time" value={s.endTime} onChange={(e) => setSlot(s.key, { endTime: e.target.value })} />
            <SelectField label="Terrain" value={s.courtId} onChange={(e) => setSlot(s.key, { courtId: e.target.value })}>
              <option value="">{s.kind === 'PHYSICAL' ? 'Hors terrain' : '—'}</option>
              {courts.data
                ?.filter((c) => c.active && (s.kind === 'PHYSICAL' || !c.physicalOnly || c.id === s.courtId))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.physicalOnly ? ' (physique)' : ''}
                  </option>
                ))}
            </SelectField>
            <div className="flex items-end">
              <IconButton aria-label={`Retirer le créneau ${i + 1}`} onClick={() => onChange(slots.filter((y) => y.key !== s.key))}>
                ✕
              </IconButton>
            </div>
          </div>
          <div role="group" aria-label="Entraîneurs du créneau" className="flex flex-wrap gap-1.5">
            <span className="me-1 self-center text-xs font-medium text-mut">Entraîneurs :</span>
            {activeCoaches.map((c) => {
              const on = s.coachIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSlot(s.key, { coachIds: on ? s.coachIds.filter((x) => x !== c.id) : [...s.coachIds, c.id] })}
                  className={`inline-flex items-center gap-1.5 rounded-full px-[11px] py-[5px] text-[13px] font-medium ${on ? 'bg-toggle text-bg' : 'bg-btn text-fg'}`}
                >
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                  {fullName(c).trim()}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </>
  );
}
