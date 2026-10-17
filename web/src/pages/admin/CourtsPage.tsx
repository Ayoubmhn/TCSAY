import { useQuery } from '@tanstack/react-query';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { FormGrid, SelectField, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { SURFACE_LABEL, type Court, type CourtSurface } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const KEYS = [['courts'], ['grid']];
const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const HALF_HOURS = Array.from({ length: 31 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

/** Résumé de la réservation en ligne d'un terrain (carte). */
export function bookingSummary(c: Court) {
  if (!c.bookFamilies && !c.bookCoaches) return 'Réservation : club seulement';
  const who = c.bookFamilies && c.bookCoaches ? 'familles et entraîneurs' : c.bookFamilies ? 'familles' : 'entraîneurs';
  const days = c.bookDays.length === 7 ? 'tous les jours' : ORDER.filter((d) => c.bookDays.includes(d)).map((d) => DAYS[d]).join(' ');
  const hours = c.bookFrom || c.bookTo ? ` · ${c.bookFrom ?? 'ouverture'}–${c.bookTo ?? 'fermeture'}` : '';
  return `Réservation : ${who} · ${days}${hours}${c.bookNight ? '' : ' · pas le soir'}`;
}

/** Interrupteur (case à cocher stylée). */
function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 border-b-[1.5px] border-line py-2.5 last:border-0">
      <span className="text-[14px]">
        {label}
        {hint && <small className="block text-[12px] text-mut">{hint}</small>}
      </span>
      <input type="checkbox" className="h-5 w-5 accent-[var(--pri)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function CourtFormModal({ open, court, onClose }: { open: boolean; court?: Court; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [surface, setSurface] = useState<CourtSurface>('CLAY');
  const [lit, setLit] = useState('1');
  const [families, setFamilies] = useState(true);
  const [coaches, setCoaches] = useState(true);
  const [night, setNight] = useState(true);
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [closure, setClosure] = useState({ fromDate: '', toDate: '', reason: '' });
  const courtRef = useRef(court);
  courtRef.current = court;
  useEffect(() => {
    if (!open) return;
    const c = courtRef.current;
    setName(c?.name ?? '');
    setSurface(c?.surface ?? 'CLAY');
    setLit(c ? (c.lit ? '1' : '0') : '1');
    setFamilies(c?.bookFamilies ?? true);
    setCoaches(c?.bookCoaches ?? true);
    setNight(c?.bookNight ?? true);
    setDays(c?.bookDays ?? [0, 1, 2, 3, 4, 5, 6]);
    setFrom(c?.bookFrom ?? '');
    setTo(c?.bookTo ?? '');
    setClosure({ fromDate: '', toDate: '', reason: '' });
  }, [open]);
  const addClosure = useAction(() => api.post(`/courts/${court!.id}/closures`, closure), {
    invalidate: KEYS,
    success: 'Fermeture enregistrée.',
    onSuccess: () => setClosure({ fromDate: '', toDate: '', reason: '' }),
  });
  const removeClosure = useAction((id: string) => api.delete(`/courts/closures/${id}`), { invalidate: KEYS, success: 'Fermeture retirée.' });

  const save = useAction(
    () => {
      const body = { name, surface, lit: lit === '1' };
      return court
        ? api.patch(`/courts/${court.id}`, { ...body, version: court.version, bookFamilies: families, bookCoaches: coaches, bookNight: night, bookDays: days, bookFrom: from || null, bookTo: to || null })
        : api.post('/courts', body);
    },
    { invalidate: KEYS, success: court ? 'Terrain enregistré.' : 'Terrain créé.', onSuccess: onClose },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast('Le nom est obligatoire.');
    save.mutate();
  };

  return (
    <Modal
      open={open}
      title={court ? 'Modifier le terrain' : 'Nouveau terrain'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="court-form" disabled={save.isPending}>
            {court ? 'Enregistrer' : 'Créer le terrain'}
          </Button>
        </>
      }
    >
      <FormGrid id="court-form" onSubmit={submit}>
        <TextField label="Nom" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Court 5" />
        <SelectField label="Surface" value={surface} onChange={(e) => setSurface(e.target.value as CourtSurface)}>
          {(Object.keys(SURFACE_LABEL) as CourtSurface[]).map((k) => (
            <option key={k} value={k}>
              {SURFACE_LABEL[k]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Éclairage" full value={lit} onChange={(e) => setLit(e.target.value)}>
          <option value="1">☀ Éclairé : réservable la nuit</option>
          <option value="0">Sans éclairage : jour seulement</option>
        </SelectField>
        {court && (
          <div className="flex flex-col gap-1 rounded-[20px] border-[1.5px] border-line p-3.5 min-[561px]:col-span-2">
            <b className="text-[15px] font-medium">Réservation en ligne</b>
            <Toggle label="Familles et joueurs" hint="Visible dans « Réserver un terrain »" checked={families} onChange={setFamilies} />
            <Toggle label="Entraîneurs (séances privées)" checked={coaches} onChange={setCoaches} />
            <Toggle label="Réservable le soir" hint={lit === '1' ? 'Terrain éclairé' : 'Sans éclairage : jamais le soir'} checked={night} onChange={setNight} />
            <span className="mt-2 text-[12px] text-mut">Jours ouverts à la réservation</span>
            <div className="grid grid-cols-7 gap-1">
              {ORDER.map((d) => {
                const on = days.includes(d);
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => setDays((l) => (on ? l.filter((x) => x !== d) : [...l, d]))} className={`rounded-[12px] py-1.5 text-[12.5px] ${on ? 'bg-pg font-semibold text-ink' : 'bg-fld text-mut'}`}>
                    {DAYS[d]}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <SelectField label="De" value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Ouverture du club</option>
                {HALF_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </SelectField>
              <SelectField label="À" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Fermeture du club</option>
                {HALF_HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </SelectField>
            </div>
            <b className="mt-3 text-[15px] font-medium">Fermetures ponctuelles</b>
            {court.closures.length ? (
              <div className="flex flex-col gap-1.5">
                {court.closures.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-[14px] bg-fld px-3 py-2 text-[13.5px]">
                    <span>
                      {c.fromDate === c.toDate ? c.fromDate.split('-').reverse().join('/') : `${c.fromDate.split('-').reverse().join('/')} → ${c.toDate.split('-').reverse().join('/')}`} · {c.reason}
                    </span>
                    <ActionIcon kind="remove" label="Retirer la fermeture" onClick={() => removeClosure.mutate(c.id)} />
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-[13px] text-mut">Aucune fermeture prévue.</span>
            )}
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Du" type="date" value={closure.fromDate} onChange={(e) => setClosure((c) => ({ ...c, fromDate: e.target.value, toDate: c.toDate || e.target.value }))} />
              <TextField label="Au" type="date" value={closure.toDate} onChange={(e) => setClosure((c) => ({ ...c, toDate: e.target.value }))} />
              <div className="col-span-2">
                <TextField label="Motif (entretien, tournoi…)" value={closure.reason} maxLength={120} onChange={(e) => setClosure((c) => ({ ...c, reason: e.target.value }))} />
              </div>
            </div>
            <Button onClick={() => addClosure.mutate()} disabled={!closure.fromDate || !closure.toDate || !closure.reason.trim() || addClosure.isPending}>
              + Fermer cette période
            </Button>
          </div>
        )}
      </FormGrid>
    </Modal>
  );
}

/** Terrains (vCourts) : entretien, désactivation (R11). */
export function CourtsPage() {
  const [view, setView] = useViewMode('terrains');
  const q = useQuery({ queryKey: ['courts'], queryFn: () => api.get<Court[]>('/courts') });
  const [form, setForm] = useState<{ open: boolean; court?: Court }>({ open: false });
  const [toDisable, setToDisable] = useState<Court>();

  const maint = useAction((c: Court) => api.post(`/courts/${c.id}/maintenance`, { maintenance: !c.maintenance }), {
    invalidate: KEYS,
    success: (_r, c) => (c.maintenance ? `${c.name} de nouveau disponible.` : `${c.name} en entretien.`),
  });
  const toggle = useAction((c: Court) => api.post(`/courts/${c.id}/${c.active ? 'deactivate' : 'activate'}`), {
    invalidate: KEYS,
    success: (_r, c) => (c.active ? 'Terrain désactivé.' : 'Terrain réactivé.'),
    onSuccess: () => setToDisable(undefined),
  });

  return (
    <>
      <PageHeader
        title="Terrains"
        subtitle="Découvrez les terrains et leur disponibilité."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            <Button variant="primary" onClick={() => setForm({ open: true })}>
              + Nouveau terrain
            </Button>
          </div>
        }
      />
      <div className="mt-5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid list={view === 'list'}>
              {q.data.map((c) => (
                <Card key={c.id}>
                  <CardRow>
                    <h3>{c.name}</h3>
                    <Pill tone={!c.active ? 'r' : c.maintenance ? 's' : 'g'}>
                      {!c.active ? 'Désactivé' : c.maintenance ? 'Entretien' : 'Actif'}
                    </Pill>
                  </CardRow>
                  <Pills>
                    <Pill tone="b">{SURFACE_LABEL[c.surface]}</Pill>
                    <Pill tone={c.lit ? 'g' : 's'}>{c.lit ? '☀ Éclairé' : 'Sans éclairage'}</Pill>
                  </Pills>
                  <CardText>
                    {c.futureReservations} réservation{c.futureReservations > 1 ? 's' : ''} à venir
                  </CardText>
                  <CardText keep>{bookingSummary(c)}</CardText>
                  {c.closures.length > 0 && <Pill tone="s">Fermé à la réservation dès le {c.closures[0].fromDate.split('-').reverse().join('/')}</Pill>}
                  <CardActions>
                    {c.active && (
                      <ActionIcon kind="maintenance" label={c.maintenance ? 'Fin d’entretien' : 'Mettre en entretien'} primary={c.maintenance} onClick={() => maint.mutate(c)} disabled={maint.isPending} />
                    )}
                    <ActionIcon kind="edit" onClick={() => setForm({ open: true, court: c })} />
                    {c.active ? (
                      <ActionIcon kind="deactivate" onClick={() => setToDisable(c)} />
                    ) : (
                      <ActionIcon kind="activate" onClick={() => toggle.mutate(c)} />
                    )}
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun terrain.</EmptyState>
          )}
        </QueryState>
      </div>
      <Note>Un terrain avec des réservations futures ne peut pas être désactivé (R11).</Note>

      <CourtFormModal open={form.open} court={form.court} onClose={() => setForm({ open: false })} />
      <ConfirmModal
        open={Boolean(toDisable)}
        title="Désactiver ce terrain ?"
        text={`${toDisable?.name ?? ''} ne sera plus réservable.`}
        cta="Désactiver"
        pending={toggle.isPending}
        onConfirm={() => toDisable && toggle.mutate(toDisable)}
        onClose={() => setToDisable(undefined)}
      />
    </>
  );
}
