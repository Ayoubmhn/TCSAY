import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/Button';
import { CardText } from '../../components/ui/Card';
import { SelectField, TextArea, TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Pill, Pills } from '../../components/ui/Pill';
import { Segmented } from '../../components/ui/Segmented';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { todayIso } from '../../lib/format';
import { resizedPhoto } from '../../lib/photo';
import { useAction } from '../../lib/useAction';
import { TAGS, type EventAudience, type EventDetail, type Option, type Person } from './types';

type People = { users: { id: string; name: string; roles: string[] }[]; players: { id: string; name: string; code: string | null }[] };

const AUDIENCES: { value: EventAudience; label: string; hint: string }[] = [
  { value: 'EVERYONE', label: 'Tout le club', hint: 'Tous les membres connectés du club.' },
  { value: 'GROUPS', label: 'Groupes', hint: 'Joueurs des groupes, leurs parents et leurs entraîneurs.' },
  { value: 'CATEGORIES', label: 'Catégories', hint: 'Joueurs inscrits cette saison dans ces catégories et leurs parents.' },
  { value: 'CUSTOM', label: 'Personnes choisies', hint: 'Seulement les personnes ajoutées (un joueur = sa famille).' },
];

/** Puces à cocher (groupes, catégories). */
function Choices({ label, options, value, onChange }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-mut">{label}</span>
      <div className="flex max-h-[180px] flex-wrap gap-1.5 overflow-y-auto">
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])} className={`rounded-full px-3 py-1.5 text-[13px] ${on ? 'bg-sel text-white' : 'bg-fld hover:bg-btn'}`}>
              {o.label}
            </button>
          );
        })}
        {!options.length && <span className="text-[13px] text-mut">Aucun choix disponible.</span>}
      </div>
    </div>
  );
}

/** Création / modification d'un événement : avec participation ou affichage seulement. */
export function EventForm({ event, onClose }: { event?: EventDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.date ?? todayIso());
  const [startTime, setStartTime] = useState(event?.startTime ?? '');
  const [endTime, setEndTime] = useState(event?.endTime ?? '');
  const [place, setPlace] = useState(event?.place ?? 'Club');
  const [tag, setTag] = useState(event?.tag ?? 'Fête');
  const [description, setDescription] = useState(event?.description ?? '');
  const [audience, setAudience] = useState<EventAudience>(event?.audience ?? 'EVERYONE');
  const [groupIds, setGroupIds] = useState<string[]>(event?.groups.map((g) => g.id) ?? []);
  const [categoryIds, setCategoryIds] = useState<string[]>(event?.categories.map((c) => c.id) ?? []);
  const [people, setPeople] = useState<Person[]>(event?.members ?? []);
  const [rsvp, setRsvp] = useState(event?.rsvp ?? false);
  const [capacity, setCapacity] = useState(event?.capacity ? String(event.capacity) : '');
  const [notifyChange, setNotifyChange] = useState(false);
  const [poster, setPoster] = useState<File | null>(null);
  const [q, setQ] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const options = useQuery({ queryKey: ['event-options'], queryFn: () => api.get<{ groups: Option[]; categories: Option[] }>('/events/options') });
  const found = useQuery({ queryKey: ['event-people', q], queryFn: () => api.get<People>('/events/people', { q }), enabled: q.trim().length >= 2 });

  const body = (publish: boolean) => ({
    title: title.trim(),
    date,
    startTime: startTime || undefined,
    endTime: endTime || undefined,
    place: place.trim(),
    tag: tag.trim(),
    description: description.trim() || undefined,
    audience,
    groupIds,
    categoryIds,
    userIds: people.filter((p) => p.kind === 'user').map((p) => p.id),
    playerIds: people.filter((p) => p.kind === 'player').map((p) => p.id),
    rsvp,
    capacity: rsvp && capacity ? Number(capacity) : null,
    ...(event ? { version: event.version, notifyChange } : { publish }),
  });

  const sendPoster = async (id: string) => {
    if (!poster) return;
    try {
      await api.upload(`/events/${id}/poster`, await resizedPhoto(poster, 1280), {}, 'PUT');
    } catch (e) {
      toast(`Affiche : ${errorMessage(e)}`);
    }
  };

  const save = useAction(
    async (publish: boolean) => {
      const r: { id?: string; notified: number } = event ? await api.patch(`/events/${event.id}`, body(false)) : await api.post('/events', body(publish));
      const id = event?.id ?? r.id!;
      await sendPoster(id);
      return { id, notified: r.notified };
    },
    {
      invalidate: [['events'], ['event', event?.id]],
      onSuccess: (r) => {
        toast(r.notified ? `Enregistré : ${r.notified} personne${r.notified > 1 ? 's' : ''} prévenue${r.notified > 1 ? 's' : ''}.` : event ? 'Événement modifié.' : 'Brouillon enregistré : publiez-le quand il est prêt.');
        onClose();
        if (!event) navigate(`/evenements/${r.id}`);
      },
    },
  );
  const add = (p: Person) => {
    setPeople((list) => (list.some((x) => x.kind === p.kind && x.id === p.id) ? list : [...list, p]));
    setQ('');
  };
  const ready = title.trim() && place.trim() && tag.trim() && date && !save.isPending;

  return (
    <Modal
      open
      size="lg"
      title={event ? 'Modifier l’événement' : 'Nouvel événement'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          {event ? (
            <Button variant="primary" data-primary onClick={() => save.mutate(false)} disabled={!ready}>
              Enregistrer
            </Button>
          ) : (
            <>
              <Button onClick={() => save.mutate(false)} disabled={!ready}>
                Brouillon
              </Button>
              <Button variant="primary" data-primary onClick={() => save.mutate(true)} disabled={!ready}>
                Publier et prévenir
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-2">
        <div className="min-[561px]:col-span-2">
          <TextField label="Titre" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Fête de fin d’année du club" />
        </div>
        <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Début (facultatif)" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <TextField label="Fin (facultatif)" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <TextField label="Lieu" value={place} maxLength={100} onChange={(e) => setPlace(e.target.value)} />
        <SelectField label="Type" value={TAGS.includes(tag) ? tag : 'Autre'} onChange={(e) => setTag(e.target.value)}>
          {TAGS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </SelectField>
        <div className="flex flex-col gap-1.5 min-[561px]:col-span-2">
          <Segmented
            label="Mode"
            value={rsvp ? 'rsvp' : 'show'}
            onChange={(v) => setRsvp(v === 'rsvp')}
            options={[
              { value: 'rsvp', label: 'Avec participation' },
              { value: 'show', label: 'Affichage seulement' },
            ]}
          />
          <CardText keep>{rsvp ? 'Chacun répond « Je participe » ou « Je ne participe pas » (le parent pour chaque enfant).' : 'L’événement est affiché et annoncé, sans inscription.'}</CardText>
        </div>
        {rsvp && <TextField label="Places (vide = sans limite)" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />}
        <SelectField label="Pour qui ?" value={audience} onChange={(e) => setAudience(e.target.value as EventAudience)}>
          {AUDIENCES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </SelectField>
        <div className="flex items-end min-[561px]:col-span-2">
          <CardText keep>{AUDIENCES.find((a) => a.value === audience)?.hint}</CardText>
        </div>
        {audience === 'GROUPS' && (
          <div className="min-[561px]:col-span-2">
            <Choices label="Groupes" options={options.data?.groups ?? []} value={groupIds} onChange={setGroupIds} />
          </div>
        )}
        {audience === 'CATEGORIES' && (
          <div className="min-[561px]:col-span-2">
            <Choices label="Catégories" options={options.data?.categories ?? []} value={categoryIds} onChange={setCategoryIds} />
          </div>
        )}
        {audience === 'CUSTOM' && (
          <div className="flex flex-col gap-1.5 min-[561px]:col-span-2">
            <TextField label="Ajouter des personnes (parent, joueur, entraîneur…)" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="2 lettres au moins" />
            {q.trim().length >= 2 && (
              <div className="flex max-h-[200px] flex-col gap-1 overflow-y-auto" role="listbox" aria-label="Personnes">
                {found.data?.users.map((u) => (
                  <button key={`u${u.id}`} type="button" role="option" aria-selected={false} onClick={() => add({ kind: 'user', id: u.id, name: u.name })} className="flex justify-between rounded-[14px] bg-fld px-3 py-2 text-start text-sm hover:bg-btn">
                    <span>{u.name}</span>
                    <span className="text-xs text-mut">Compte</span>
                  </button>
                ))}
                {found.data?.players.map((p) => (
                  <button key={`p${p.id}`} type="button" role="option" aria-selected={false} onClick={() => add({ kind: 'player', id: p.id, name: p.name })} className="flex justify-between rounded-[14px] bg-fld px-3 py-2 text-start text-sm hover:bg-btn">
                    <span>{p.name}</span>
                    <span className="text-xs text-mut">Joueur et sa famille</span>
                  </button>
                ))}
                {found.data && !found.data.users.length && !found.data.players.length && <span className="px-1 text-[13px] text-mut">Personne trouvée.</span>}
              </div>
            )}
            {people.length > 0 && (
              <Pills>
                {people.map((p) => (
                  <button key={p.kind + p.id} type="button" aria-label={`Retirer ${p.name}`} onClick={() => setPeople((l) => l.filter((x) => !(x.kind === p.kind && x.id === p.id)))}>
                    <Pill tone={p.kind === 'player' ? 'g' : 'b'}>{p.name} ✕</Pill>
                  </button>
                ))}
              </Pills>
            )}
          </div>
        )}
        <div className="min-[561px]:col-span-2">
          <TextArea label="Description (facultatif)" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5 min-[561px]:col-span-2">
          <span className="text-xs font-medium text-mut">Affiche (facultatif)</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => picker.current?.click()}>{poster || event?.posterUrl ? 'Changer l’affiche' : '+ Joindre une affiche'}</Button>
            {poster && <Pill tone="g">{poster.name}</Pill>}
          </div>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="Affiche de l’événement"
            onChange={(e) => {
              setPoster(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </div>
        {event?.notifiedAt && (
          <label className="flex items-center gap-2 text-sm min-[561px]:col-span-2">
            <input type="checkbox" checked={notifyChange} onChange={(e) => setNotifyChange(e.target.checked)} />
            Prévenir les personnes concernées de la modification
          </label>
        )}
      </div>
    </Modal>
  );
}
