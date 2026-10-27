import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Segmented } from '../../components/ui/Segmented';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { fD, todayIso } from '../../lib/format';
import { hm, toMin, toTime } from '../../lib/timetable';
import type { MissedSession, OneOffOptions, OneOffType, SlotKind, Timetable } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const TYPES: { v: OneOffType; label: string }[] = [
  { v: 'MAKEUP', label: 'Rattrapage' },
  { v: 'EXTRA', label: 'Séance en plus (avance)' },
  { v: 'SPECIAL', label: 'Séance spéciale' },
];
const DURATIONS = [60, 90, 120];
const KEYS = [['session-counter'], ['planning'], ['sessions'], ['timetable'], ['extra-missed']];

const tomorrow = () => {
  const d = new Date(`${todayIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const chip = (on: boolean, disabled = false) =>
  `inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13.5px] font-medium ${disabled ? 'cursor-not-allowed opacity-45' : ''} ${on ? 'bg-toggle text-bg' : 'bg-btn text-fg'}`;

export type ProgramInit = { groupId?: string; makeup?: { slotId: string; date: string }; date?: string; startTime?: string; type?: OneOffType };

/**
 * « Programmer une séance » : rattrapage d'une séance manquée, séance en plus (avance) ou séance spéciale, un seul jour.
 * Terrains et entraîneurs libres affichés pour la date et les heures choisies ; l'API refait tous les contrôles (R5, R10).
 */
/** Tennis : jamais un terrain réservé aux séances physiques ; physique : ces terrains d'abord. */
const courtsFor = <C extends { physicalOnly?: boolean }>(courts: C[], kind: SlotKind) =>
  kind === 'TENNIS' ? courts.filter((c) => !c.physicalOnly) : [...courts.filter((c) => c.physicalOnly), ...courts.filter((c) => !c.physicalOnly)];

export function ProgramSessionModal({ init = {}, onClose }: { init?: ProgramInit; onClose: () => void }) {
  const toast = useToast();
  const t = useQuery({ queryKey: ['timetable', null], queryFn: () => api.get<Timetable>('/timetable') });
  const [type, setType] = useState<OneOffType>(init.type ?? (init.makeup ? 'MAKEUP' : 'EXTRA'));
  const [groupId, setGroupId] = useState(init.groupId ?? '');
  const [makeupKey, setMakeupKey] = useState(init.makeup ? `${init.makeup.slotId}|${init.makeup.date}` : '');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(init.date && init.date > todayIso() ? init.date : tomorrow());
  const [start, setStart] = useState(init.startTime ?? '10:00');
  const [duration, setDuration] = useState(90);
  const [kind, setKind] = useState<SlotKind>('TENNIS');
  const [courtId, setCourtId] = useState('');
  const [coachIds, setCoachIds] = useState<string[]>([]);
  const [notify, setNotify] = useState(true);

  const group = t.data?.groups.find((g) => g.id === groupId);
  // Durée habituelle du groupe par défaut.
  useEffect(() => {
    if (group?.sessionMinutes) setDuration(group.sessionMinutes);
  }, [group?.id, group?.sessionMinutes]);

  const end = toMin(start) + duration < 24 * 60 ? toTime(toMin(start) + duration) : '23:59';
  // Rattrapage : seulement une séance annulée ou reportée du groupe (passée ou à venir), pas encore rattrapée.
  const missedQ = useQuery({
    queryKey: ['extra-missed', groupId],
    queryFn: () => api.get<MissedSession[]>('/extra-sessions/missed', { groupId }),
    enabled: Boolean(groupId) && type === 'MAKEUP',
  });
  const missed = missedQ.data ?? [];
  const ready = Boolean(groupId && date && /^\d\d:\d\d$/.test(start));
  const opts = useQuery({
    queryKey: ['extra-options', groupId, date, start, end],
    queryFn: () => api.get<OneOffOptions>('/extra-sessions/options', { groupId, date, startTime: start, endTime: end }),
    enabled: ready,
  });

  // Terrain et entraîneur proposés : ceux du groupe s'ils sont libres, sinon le premier terrain libre.
  useEffect(() => {
    const o = opts.data;
    if (!o) return;
    const usable = courtsFor(o.courts, kind);
    const free = (id: string) => usable.some((c) => c.id === id && !c.busy);
    if (kind === 'PHYSICAL') {
      // Physique : terrain réservé aux séances physiques s'il est libre, sinon hors terrain.
      if (courtId && !free(courtId)) setCourtId('');
      if (!courtId) setCourtId(usable.find((c) => c.physicalOnly && !c.busy)?.id ?? '');
    } else if (!courtId || !free(courtId)) {
      setCourtId(group?.preferredCourtId && free(group.preferredCourtId) ? group.preferredCourtId : (usable.find((c) => !c.busy)?.id ?? ''));
    }
    setCoachIds((ids) => {
      const kept = ids.filter((id) => o.coaches.some((c) => c.id === id && !c.busy));
      if (kept.length || ids.length) return kept;
      const main = group?.mainCoachId;
      return main && o.coaches.some((c) => c.id === main && !c.busy) ? [main] : [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.data, kind]);

  const save = useAction(
    () => {
      const [slotId, mdate] = makeupKey.split('|');
      return api.post<{ name: string; notified: number }>('/extra-sessions', {
        groupId,
        type,
        title: type === 'SPECIAL' ? title : undefined,
        date,
        startTime: start,
        endTime: end,
        kind,
        courtId: courtId || undefined,
        coachIds,
        notify,
        ...(type === 'MAKEUP' ? { makeupSlotId: slotId, makeupDate: mdate } : {}),
      });
    },
    {
      invalidate: KEYS,
      success: (r) => `${r.name} programmé le ${fD(date, { weekday: 'long', day: 'numeric', month: 'long' })}${r.notified ? ` · ${r.notified} personne${r.notified > 1 ? 's' : ''} prévenue${r.notified > 1 ? 's' : ''}` : ''}.`,
      onSuccess: onClose,
    },
  );
  const submit = () => {
    if (!groupId) return toast('Choisissez le groupe.');
    if (type === 'MAKEUP' && !makeupKey) return toast('Rattrapage : choisissez la séance annulée ou reportée.');
    if (type === 'SPECIAL' && !title.trim()) return toast('Donnez un titre à la séance spéciale.');
    if (kind === 'TENNIS' && !courtId) return toast('Choisissez un terrain libre.');
    if (opts.data?.groupBusy) return toast(`Le groupe a déjà une séance ${opts.data.groupBusy}.`);
    save.mutate();
  };

  return (
    <Modal
      open
      size="lg"
      title="Programmer une séance"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending}>
            Programmer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div role="radiogroup" aria-label="Type de séance" className="flex flex-wrap gap-1.5">
          {TYPES.map((x) => (
            <button key={x.v} type="button" aria-pressed={type === x.v} className={chip(type === x.v)} onClick={() => setType(x.v)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 min-[521px]:grid-cols-2">
          <SelectField label="Groupe *" value={groupId} onChange={(e) => (setGroupId(e.target.value), setMakeupKey(''))}>
            <option value="">Choisir…</option>
            {t.data?.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </SelectField>
          {type === 'MAKEUP' && (
            <SelectField label="Séance annulée ou reportée *" value={makeupKey} onChange={(e) => setMakeupKey(e.target.value)}>
              <option value="">{groupId ? (missedQ.isPending ? 'Chargement…' : missed.length ? 'Choisir…' : 'Aucune séance annulée ou reportée') : 'Choisissez d’abord le groupe'}</option>
              {missed.map((m) => (
                <option key={`${m.slotId}|${m.date}`} value={`${m.slotId}|${m.date}`}>
                  {`${fD(m.date, { day: 'numeric', month: 'short' })} · ${m.startTime} · ${m.reason}`}
                </option>
              ))}
            </SelectField>
          )}
          {type === 'SPECIAL' && <TextField label="Titre *" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Préparation du tournoi" />}
        </div>
        <div className="grid grid-cols-2 gap-3 min-[521px]:grid-cols-[1.3fr_1fr_1.4fr]">
          <TextField label="Date *" type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Début *" type="time" step={1800} value={start} onChange={(e) => setStart(e.target.value)} />
          <div className="col-span-2 flex flex-col gap-1.5 min-[521px]:col-span-1">
            <span className="text-xs font-medium text-mut">Durée</span>
            <Segmented label="Durée" value={String(duration)} onChange={(v) => setDuration(Number(v))} options={DURATIONS.map((d) => ({ value: String(d), label: hm(d) }))} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-mut">Séance</span>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={kind === 'TENNIS'} className={chip(kind === 'TENNIS')} onClick={() => setKind('TENNIS')}>
              Tennis
            </button>
            <button type="button" aria-pressed={kind === 'PHYSICAL'} className={chip(kind === 'PHYSICAL')} onClick={() => setKind('PHYSICAL')}>
              Physique
            </button>
          </div>
        </div>
        {ready && opts.data?.groupBusy && <p className="m-0 rounded-[16px] bg-[#fdb3b0] px-3.5 py-2.5 text-[13.5px] text-[#111]">{`Le groupe a déjà une séance ${opts.data.groupBusy}.`}</p>}
        {ready && opts.data && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-mut">{`Terrain ${kind === 'PHYSICAL' ? '(facultatif) ' : ''}· ${fD(date, { weekday: 'short', day: 'numeric', month: 'short' })} de ${start} à ${end}`}</span>
              <div className="flex flex-wrap gap-1.5">
                {kind === 'PHYSICAL' && (
                  <button type="button" aria-pressed={!courtId} className={chip(!courtId)} onClick={() => setCourtId('')}>
                    Hors terrain
                  </button>
                )}
                {courtsFor(opts.data.courts, kind).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={c.busy ?? 'Libre'}
                    disabled={Boolean(c.busy)}
                    aria-pressed={courtId === c.id}
                    onClick={() => setCourtId(c.id)}
                    className={`inline-flex items-center rounded-full px-3.5 py-2 text-[13px] font-semibold ${
                      courtId === c.id ? 'bg-sel text-white' : c.busy ? 'cursor-not-allowed bg-[#fdb3b0] text-[#111] opacity-80' : 'bg-[#dff3a8] text-[#111]'
                    }`}
                  >
                    {`${c.name}${c.lit ? ' ☀' : ''}${c.physicalOnly ? ' (physique)' : ''} · ${c.busy ? 'pris' : 'libre'}`}
                  </button>
                ))}
              </div>
              {opts.data.courts.some((c) => c.busy) && (
                <span className="text-[12px] text-mut">{opts.data.courts.filter((c) => c.busy).map((c) => `${c.name} : ${c.busy}`).join(' · ')}</span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-mut">Entraîneurs</span>
              <div className="flex flex-wrap gap-1.5">
                {opts.data.coaches.map((c) => {
                  const on = coachIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      title={c.busy ?? 'Libre'}
                      disabled={Boolean(c.busy) && !on}
                      aria-pressed={on}
                      onClick={() => setCoachIds(on ? coachIds.filter((x) => x !== c.id) : [...coachIds, c.id])}
                      className={chip(on, Boolean(c.busy) && !on)}
                    >
                      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                      {`${c.name}${c.busy ? ' · occupé' : ''}`}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
        <label className="flex items-center gap-2.5 text-[14px]">
          <input type="checkbox" className="h-4 w-4 accent-pri" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Prévenir les familles et les entraîneurs du groupe
        </label>
        <p className="m-0 text-[12.5px] text-mut">
          La séance apparaît dans le planning, « Mes séances », les présences et les salaires ; le terrain est bloqué à la réservation.
          {type === 'MAKEUP' ? ' Dans le compteur, la séance manquée passe « Rattrapage prévu », puis « Rattrapée ».' : ' Dans le compteur, elle compte « en avance ».'}
        </p>
      </div>
    </Modal>
  );
}
