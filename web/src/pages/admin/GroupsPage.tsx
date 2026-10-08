import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { SlotLine } from '../../components/SlotInfo';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { FilterSelect, Filters, SelectField, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { fullName } from '../../lib/format';
import type { Category, Coach, Court, Group, GroupKind, Player } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const KEYS = [['groups'], ['players'], ['dashboard'], ['coaches'], ['planning']];
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // lundi → dimanche
const DAY_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

type SlotForm = { key: string; id?: string; day: number; startTime: string; endTime: string; courtId: string; coachIds: string[] };
type GroupForm = { name: string; categoryId: string; kind: GroupKind; capacity: string; slots: SlotForm[] };

let seq = 0;
const newSlot = (day = 1): SlotForm => ({ key: `n${seq++}`, day, startTime: '17:30', endTime: '19:00', courtId: '', coachIds: [] });

/** Formulaire groupe : chaque créneau a son jour, son horaire, son terrain et un ou plusieurs entraîneurs. */
function GroupFormModal({ open, group, onClose }: { open: boolean; group?: Group; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<GroupForm>({ name: '', categoryId: '', kind: 'COMPETITIVE', capacity: '12', slots: [newSlot()] });
  const groupRef = useRef(group);
  groupRef.current = group;
  useEffect(() => {
    if (!open) return;
    const g = groupRef.current;
    setF(
      g
        ? {
            name: g.name,
            categoryId: g.category?.id ?? '',
            kind: g.kind,
            capacity: String(g.capacity),
            slots: g.slots.map((s) => ({
              key: s.id,
              id: s.id,
              day: s.day,
              startTime: s.startTime,
              endTime: s.endTime,
              courtId: s.court?.id ?? '',
              coachIds: s.coaches.map((c) => c.id),
            })),
          }
        : { name: '', categoryId: '', kind: 'COMPETITIVE', capacity: '12', slots: [newSlot()] },
    );
  }, [open]);

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories'), enabled: open });
  const coaches = useQuery({ queryKey: ['coaches'], queryFn: () => api.get<Coach[]>('/coaches'), enabled: open });
  const courts = useQuery({ queryKey: ['courts'], queryFn: () => api.get<Court[]>('/courts'), enabled: open });

  const setSlot = (key: string, patch: Partial<SlotForm>) =>
    setF((x) => ({ ...x, slots: x.slots.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));

  const payload = () => ({
    name: f.name,
    categoryId: f.categoryId || undefined,
    kind: f.kind,
    capacity: Number(f.capacity),
    slots: f.slots.map((s) => ({
      id: s.id,
      day: s.day,
      startTime: s.startTime,
      endTime: s.endTime,
      courtId: s.courtId || undefined,
      coachIds: s.coachIds,
    })),
  });
  const save = useAction(
    () => (group ? api.patch(`/groups/${group.id}`, { ...payload(), version: group.version }) : api.post('/groups', payload())),
    { invalidate: KEYS, success: group ? 'Groupe enregistré.' : 'Groupe créé.', onSuccess: onClose },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return toast('Nom du groupe obligatoire.');
    if (!f.slots.length) return toast('Ajoutez au moins un créneau.');
    const bad = f.slots.find((s) => s.endTime <= s.startTime);
    if (bad) return toast(`${DAY_FULL[bad.day]} : l’heure de fin doit suivre l’heure de début.`);
    save.mutate();
  };

  const activeCoaches = coaches.data?.filter((c) => c.isActive) ?? [];

  return (
    <Modal
      open={open}
      size="xl"
      title={group ? 'Modifier le groupe' : 'Nouveau groupe'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="group-form" disabled={save.isPending}>
            {group ? 'Enregistrer' : 'Créer le groupe'}
          </Button>
        </>
      }
    >
      <form id="group-form" noValidate onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 min-[521px]:grid-cols-2">
          <TextField label="Nom" full value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex. Benjamins G" />
          <SelectField label="Catégorie (facultative)" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            <option value="">— Toutes / mixte —</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <TextField label="Capacité" type="number" min={1} max={60} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
          <SelectField label="Type de groupe" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as GroupKind })}>
            <option value="COMPETITIVE">Compétitif (jusqu’en août, stage d’été inclus)</option>
            <option value="LEISURE">Loisirs (octobre → juin)</option>
          </SelectField>
        </div>

        <div className="flex items-center justify-between">
          <h3>Créneaux par jour</h3>
          <Button onClick={() => setF((x) => ({ ...x, slots: [...x.slots, newSlot(x.slots.at(-1)?.day ?? 1)] }))}>+ Ajouter un créneau</Button>
        </div>
        {f.slots.map((s, i) => (
          <fieldset key={s.key} className="flex flex-col gap-2.5 rounded-[20px] border-[1.5px] border-line p-3">
            <legend className="sr-only">Créneau {i + 1}</legend>
            <div className="grid grid-cols-2 gap-2.5 min-[521px]:grid-cols-[1.2fr_1fr_1fr_1.3fr_auto]">
              <SelectField label="Jour" value={String(s.day)} onChange={(e) => setSlot(s.key, { day: Number(e.target.value) })}>
                {WEEK.map((d) => (
                  <option key={d} value={d}>
                    {DAY_FULL[d]}
                  </option>
                ))}
              </SelectField>
              <TextField label="Début" type="time" value={s.startTime} onChange={(e) => setSlot(s.key, { startTime: e.target.value })} />
              <TextField label="Fin" type="time" value={s.endTime} onChange={(e) => setSlot(s.key, { endTime: e.target.value })} />
              <SelectField label="Terrain" value={s.courtId} onChange={(e) => setSlot(s.key, { courtId: e.target.value })}>
                <option value="">—</option>
                {courts.data
                  ?.filter((c) => c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </SelectField>
              <div className="flex items-end">
                <IconButton aria-label={`Retirer le créneau ${i + 1}`} onClick={() => setF((x) => ({ ...x, slots: x.slots.filter((y) => y.key !== s.key) }))}>
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
      </form>
    </Modal>
  );
}

function AddMemberModal({ group, onClose }: { group?: Group; onClose: () => void }) {
  const players = useQuery({ queryKey: ['players', 'all'], queryFn: () => api.get<Player[]>('/players'), enabled: Boolean(group) });
  const candidates = (players.data ?? []).filter((p) => !group?.members.some((m) => m.playerId === p.id));
  const [playerId, setPlayerId] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    setPlayerId('');
    setReason('');
  }, [group]);
  const add = useAction(() => api.post(`/groups/${group!.id}/members`, { playerId, derogationReason: reason || undefined }), {
    invalidate: KEYS,
    success: () => `${candidates.find((p) => p.id === playerId)?.firstName ?? 'Joueur'} ajouté à ${group?.name}.`,
    onSuccess: onClose,
  });
  return (
    <Modal
      open={Boolean(group)}
      title={`Ajouter à ${group?.name ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={() => add.mutate()} disabled={!playerId || add.isPending}>
            Ajouter
          </Button>
        </>
      }
    >
      <SelectField label="Joueur" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
        <option value="">— Choisir —</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {fullName(p)} · {p.category?.name ?? '—'}
            {p.group ? ` · déjà en ${p.group.name}` : ''}
          </option>
        ))}
      </SelectField>
      <TextField label="Motif de dérogation (si catégorie différente)" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

/** Groupes (vGroups) : créneaux par jour, plusieurs entraîneurs, capacité et catégorie (R4), conflits (R5). */
export function GroupsPage() {
  const q = useQuery({ queryKey: ['groups'], queryFn: () => api.get<Group[]>('/groups') });
  const coaches = useQuery({ queryKey: ['coaches'], queryFn: () => api.get<Coach[]>('/coaches') });
  const [coachFilter, setCoachFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<GroupKind | ''>('');
  const [dayFilter, setDayFilter] = useState('');
  const [form, setForm] = useState<{ open: boolean; group?: Group }>({ open: false });
  const [addTo, setAddTo] = useState<Group>();
  const [remove, setRemove] = useState<{ group: Group; member: Group['members'][number] }>();
  const [toArchive, setToArchive] = useState<Group>();

  const removeMember = useAction(() => api.delete(`/groups/${remove!.group.id}/members/${remove!.member.playerId}`), {
    invalidate: KEYS,
    success: 'Joueur retiré du groupe.',
    onSuccess: () => setRemove(undefined),
  });
  const archive = useAction((id: string) => api.post(`/groups/${id}/archive`), {
    invalidate: KEYS,
    success: 'Groupe archivé.',
    onSuccess: () => setToArchive(undefined),
  });

  const list = (q.data ?? []).filter(
    (g) =>
      (!kindFilter || g.kind === kindFilter) &&
      (!coachFilter || g.coaches.some((c) => c.id === coachFilter)) &&
      (dayFilter === '' || g.slots.some((s) => s.day === Number(dayFilter))),
  );

  return (
    <>
      <PageHeader
        title="Groupes"
        subtitle="Découvrez les groupes d’entraînement de la saison en cours."
        action={
          <Button variant="primary" onClick={() => setForm({ open: true })}>
            + Nouveau groupe
          </Button>
        }
      />
      <Filters>
        <FilterSelect label="Filtrer par type" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as GroupKind | '')}>
          <option value="">Loisirs et compétitif</option>
          <option value="COMPETITIVE">Compétitif</option>
          <option value="LEISURE">Loisirs</option>
        </FilterSelect>
        <FilterSelect label="Filtrer par entraîneur" value={coachFilter} onChange={(e) => setCoachFilter(e.target.value)}>
          <option value="">Tous les entraîneurs</option>
          {coaches.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {fullName(c).trim()}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Filtrer par jour" value={dayFilter} onChange={(e) => setDayFilter(e.target.value)}>
          <option value="">Tous les jours</option>
          {WEEK.map((d) => (
            <option key={d} value={d}>
              {DAY_FULL[d]}
            </option>
          ))}
        </FilterSelect>
        {q.data && (
          <Pill tone="b">
            {list.length} groupe{list.length > 1 ? 's' : ''}
          </Pill>
        )}
      </Filters>
      <div className="mt-2.5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {list.length ? (
            <CardGrid>
              {list.map((g) => {
                const full = g.members.length >= g.capacity;
                return (
                  <Card key={g.id}>
                    <CardRow>
                      <h3>{g.name}</h3>
                      <Pill tone={full ? 'r' : 'g'}>
                        {g.members.length}/{g.capacity}
                        {full ? ' · complet' : ''}
                      </Pill>
                    </CardRow>
                    <Pills>
                      <Pill tone={g.kind === 'LEISURE' ? 'g' : 'b'}>{g.kind === 'LEISURE' ? 'Loisirs · oct. → juin' : 'Compétitif · → août'}</Pill>
                      <Pill tone="s">{g.category?.name ?? 'Catégorie à affecter'}</Pill>
                      <Pill tone="b">
                        {g.slots.length} créneau{g.slots.length > 1 ? 'x' : ''} / semaine
                      </Pill>
                    </Pills>
                    <div className="flex flex-col gap-1.5">
                      {g.slots.map((s) => (
                        <SlotLine key={s.id} slot={s} />
                      ))}
                    </div>
                    {g.members.length > 0 && (
                      <Pills>
                        {g.members.map((m) => (
                          <span key={m.playerId} className="inline-flex items-center gap-1 rounded-full bg-pb ps-[11px] text-[13px] font-medium text-ink">
                            <Link to={`/admin/joueurs/${m.playerId}`} className="py-[5px] hover:underline" title={m.derogationReason ? `Dérogation : ${m.derogationReason}` : undefined}>
                              {m.firstName}
                            </Link>
                            <button
                              type="button"
                              onClick={() => setRemove({ group: g, member: m })}
                              aria-label={`Retirer ${fullName(m)} du groupe`}
                              className="rounded-full px-2 py-[5px] hover:bg-black/10"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </Pills>
                    )}
                    {g.members.length === 0 && <CardText>Aucun joueur pour l’instant.</CardText>}
                    <CardActions>
                      <Button onClick={() => setAddTo(g)}>Ajouter un joueur</Button>
                      <Button onClick={() => setForm({ open: true, group: g })}>Modifier</Button>
                      <Button variant="danger" onClick={() => setToArchive(g)}>
                        Archiver
                      </Button>
                    </CardActions>
                  </Card>
                );
              })}
            </CardGrid>
          ) : (
            <EmptyState>Aucun groupe.</EmptyState>
          )}
        </QueryState>
      </div>
      <Note>
        Chaque jour peut avoir son horaire, son terrain et un ou plusieurs entraîneurs. Capacité et catégorie vérifiées à chaque
        ajout (R4, dérogation avec motif). Aucun conflit de terrain ou d’entraîneur sur un même créneau (R5).
      </Note>

      <GroupFormModal open={form.open} group={form.group} onClose={() => setForm({ open: false })} />
      <AddMemberModal group={addTo} onClose={() => setAddTo(undefined)} />
      <ConfirmModal
        open={Boolean(remove)}
        title="Retirer ce joueur du groupe ?"
        text={remove ? `${fullName(remove.member)} quittera le groupe ${remove.group.name}.` : ''}
        cta="Retirer"
        pending={removeMember.isPending}
        onConfirm={() => removeMember.mutate()}
        onClose={() => setRemove(undefined)}
      />
      <ConfirmModal
        open={Boolean(toArchive)}
        title="Archiver ce groupe ?"
        text={toArchive ? `Le groupe ${toArchive.name} sera archivé, pas supprimé (R8).` : ''}
        cta="Archiver"
        pending={archive.isPending}
        onConfirm={() => toArchive && archive.mutate(toArchive.id)}
        onClose={() => setToArchive(undefined)}
      />
    </>
  );
}

