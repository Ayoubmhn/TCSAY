import { useQuery } from '@tanstack/react-query';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { CoachChip } from '../../components/SlotInfo';
import { DAY_FULL, SlotsEditor, WEEK, badSlot, newSlot, slotToForm, slotsPayload, type SlotForm } from '../../components/SlotsEditor';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { FilterSelect, Filters, SelectField, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill } from '../../components/ui/Pill';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { useToast } from '../../components/ui/Toast';
import { categoryPairs } from '../../lib/categories';
import { api } from '../../lib/api';
import { DAY_NAMES, fullName } from '../../lib/format';
import type { Category, Coach, Group, GroupKind } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const KEYS = [['groups'], ['players'], ['dashboard'], ['coaches'], ['planning']];

type GroupForm = { name: string; categoryId: string; kind: GroupKind; capacity: string; slots: SlotForm[] };

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
            slots: g.slots.map((s) => slotToForm(s)),
          }
        : { name: '', categoryId: '', kind: 'COMPETITIVE', capacity: '12', slots: [newSlot()] },
    );
  }, [open]);

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories'), enabled: open });

  const payload = () => ({
    name: f.name,
    categoryId: f.categoryId || undefined,
    kind: f.kind,
    capacity: Number(f.capacity),
    slots: slotsPayload(f.slots),
  });
  const save = useAction(
    () => (group ? api.patch(`/groups/${group.id}`, { ...payload(), version: group.version }) : api.post('/groups', payload())),
    { invalidate: KEYS, success: group ? 'Groupe enregistré.' : 'Groupe créé.', onSuccess: onClose },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return toast('Nom du groupe obligatoire.');
    if (!f.slots.length) return toast('Ajoutez au moins un créneau.');
    const bad = badSlot(f.slots);
    if (bad) return toast(bad);
    save.mutate();
  };

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
          <SelectField
            label="Catégorie (facultative, garçons et filles)"
            value={categories.data?.find((c) => c.id === f.categoryId)?.pairCode ?? ''}
            onChange={(e) => setF({ ...f, categoryId: categories.data?.find((c) => c.pairCode === e.target.value)?.id ?? '' })}
          >
            <option value="">— Toutes —</option>
            {categoryPairs(categories.data ?? []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
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
        <SlotsEditor slots={f.slots} onChange={(slots) => setF((x) => ({ ...x, slots }))} />
      </form>
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
  const [view, setView] = useViewMode('groupes');
  const [toArchive, setToArchive] = useState<Group>();

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
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            <Button variant="primary" onClick={() => setForm({ open: true })}>
              + Nouveau groupe
            </Button>
          </div>
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
            <CardGrid list={view === 'list'}>
              {list.map((g) => {
                const full = g.members.length >= g.capacity;
                return (
                  <Card key={g.id}>
                    <CardRow>
                      <Link to={`/admin/groupes/${g.id}`} className="min-w-0 hover:underline">
                        <h3>{g.name}</h3>
                      </Link>
                      <Pill tone={full ? 'r' : 'g'}>
                        {g.members.length}/{g.capacity}
                      </Pill>
                    </CardRow>
                    {/* Carte résumée : horaires et entraîneurs ; le reste dans la fiche du groupe (« Détails »). */}
                    <div className="flex flex-col gap-1.5">
                      {g.slots.map((s) => (
                        <div key={s.id} className="flex flex-wrap items-center gap-1.5">
                          <Pill tone="b">
                            {DAY_NAMES[s.day]}{' '}
                            <span dir="ltr">
                              {s.startTime}–{s.endTime}
                            </span>
                          </Pill>
                          {s.coaches.length ? s.coaches.map((c) => <CoachChip key={c.id} coach={c} />) : <Pill tone="s">Entraîneur à affecter</Pill>}
                        </div>
                      ))}
                      {g.slots.length === 0 && <CardText>Aucun créneau.</CardText>}
                    </div>
                    <CardActions>
                      <ActionIcon kind="view" label="Détails du groupe" to={`/admin/groupes/${g.id}`} />
                      <ActionIcon kind="edit" onClick={() => setForm({ open: true, group: g })} />
                      <ActionIcon kind="archive" onClick={() => setToArchive(g)} />
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

