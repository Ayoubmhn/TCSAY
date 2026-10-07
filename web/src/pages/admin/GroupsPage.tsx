import { useQuery } from '@tanstack/react-query';
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
import { DAY_NAMES, fullName } from '../../lib/format';
import type { Category, Coach, Court, Group, Player } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const KEYS = [['groups'], ['players'], ['dashboard'], ['coaches']];
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // lundi → dimanche

type GroupForm = {
  name: string;
  categoryId: string;
  coachId: string;
  courtId: string;
  days: number[];
  startTime: string;
  endTime: string;
  capacity: string;
};

const EMPTY: GroupForm = { name: '', categoryId: '', coachId: '', courtId: '', days: [], startTime: '17:00', endTime: '18:30', capacity: '8' };

function GroupFormModal({ open, group, onClose }: { open: boolean; group?: Group; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<GroupForm>(EMPTY);
  const groupRef = useRef(group);
  groupRef.current = group;
  useEffect(() => {
    if (!open) return;
    const g = groupRef.current;
    setF(
      g
        ? {
            name: g.name,
            categoryId: g.category.id,
            coachId: g.coach?.id ?? '',
            courtId: g.court?.id ?? '',
            days: g.days,
            startTime: g.startTime,
            endTime: g.endTime,
            capacity: String(g.capacity),
          }
        : EMPTY,
    );
  }, [open]);
  const set = (k: keyof GroupForm) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories'), enabled: open });
  const coaches = useQuery({ queryKey: ['coaches'], queryFn: () => api.get<Coach[]>('/coaches'), enabled: open });
  const courts = useQuery({ queryKey: ['courts'], queryFn: () => api.get<Court[]>('/courts'), enabled: open });

  const payload = () => ({
    name: f.name,
    categoryId: f.categoryId,
    coachId: f.coachId || undefined,
    courtId: f.courtId || undefined,
    days: f.days,
    startTime: f.startTime,
    endTime: f.endTime,
    capacity: Number(f.capacity),
  });
  const save = useAction(
    () => (group ? api.patch(`/groups/${group.id}`, { ...payload(), version: group.version }) : api.post('/groups', payload())),
    { invalidate: KEYS, success: group ? 'Groupe enregistré.' : 'Groupe créé.', onSuccess: onClose },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return toast('Nom du groupe obligatoire.');
    if (!f.categoryId) return toast('Catégorie obligatoire.');
    if (!f.days.length) return toast('Choisissez au moins un jour.');
    if (f.endTime <= f.startTime) return toast('L’heure de fin doit suivre l’heure de début.');
    save.mutate();
  };

  return (
    <Modal
      open={open}
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
      <FormGrid id="group-form" onSubmit={submit}>
        <TextField label="Nom" full value={f.name} onChange={set('name')} placeholder="Ex. Benjamins A" />
        <SelectField label="Catégorie" full value={f.categoryId} onChange={set('categoryId')}>
          <option value="">— Choisir —</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Entraîneur" value={f.coachId} onChange={set('coachId')}>
          <option value="">— Aucun —</option>
          {coaches.data
            ?.filter((c) => c.isActive)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {fullName(c)}
              </option>
            ))}
        </SelectField>
        <SelectField label="Terrain" value={f.courtId} onChange={set('courtId')}>
          <option value="">— Aucun —</option>
          {courts.data
            ?.filter((c) => c.active)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </SelectField>
        <fieldset className="col-span-full flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-mut">Jours</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEK.map((d) => {
              const on = f.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setF((x) => ({ ...x, days: on ? x.days.filter((y) => y !== d) : [...x.days, d] }))}
                  className={`rounded-full px-[13px] py-[5px] text-[13px] font-medium ${on ? 'bg-toggle text-bg' : 'bg-btn text-fg'}`}
                >
                  {DAY_NAMES[d]}
                </button>
              );
            })}
          </div>
        </fieldset>
        <TextField label="Début" type="time" value={f.startTime} onChange={set('startTime')} />
        <TextField label="Fin" type="time" value={f.endTime} onChange={set('endTime')} />
        <TextField label="Capacité" type="number" min={1} max={40} value={f.capacity} onChange={set('capacity')} />
      </FormGrid>
    </Modal>
  );
}

function AddMemberModal({ group, onClose }: { group?: Group; onClose: () => void }) {
  const players = useQuery({ queryKey: ['players', 'all'], queryFn: () => api.get<Player[]>('/players'), enabled: Boolean(group) });
  const candidates = (players.data ?? []).filter((p) => !p.group);
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
      <SelectField label="Joueur sans groupe" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
        <option value="">— Choisir —</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {fullName(p)} · {p.category?.name ?? '—'}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Motif de dérogation (si catégorie différente)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  );
}

/** Groupes (vGroups) : capacité et catégorie (R4), conflits de terrain, créneau, entraîneur (R5). */
export function GroupsPage() {
  const q = useQuery({ queryKey: ['groups'], queryFn: () => api.get<Group[]>('/groups') });
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
      <div className="mt-5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid>
              {q.data.map((g) => {
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
                      <Pill tone="s">{g.category.name}</Pill>
                      <Pill tone="b">
                        {g.days.map((d) => DAY_NAMES[d]).join(' & ')} {g.startTime}–{g.endTime}
                      </Pill>
                      {g.court && <Pill tone="g">{g.court.name}</Pill>}
                    </Pills>
                    <CardText>Coach {g.coach ? fullName(g.coach) : '—'}</CardText>
                    <Pills>
                      {g.members.map((m) => (
                        <button
                          key={m.playerId}
                          type="button"
                          onClick={() => setRemove({ group: g, member: m })}
                          aria-label={`Retirer ${fullName(m)} du groupe`}
                          title={m.derogationReason ? `Dérogation : ${m.derogationReason}` : undefined}
                        >
                          <Pill tone={m.derogationReason ? 's' : 'b'}>{m.firstName} ✕</Pill>
                        </button>
                      ))}
                    </Pills>
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
            <EmptyState>Aucun groupe pour cette saison.</EmptyState>
          )}
        </QueryState>
      </div>
      <Note>
        Capacité et catégorie vérifiées à chaque ajout (R4, dérogation avec motif). Aucun conflit de terrain, de créneau ou
        d’entraîneur (R5).
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
