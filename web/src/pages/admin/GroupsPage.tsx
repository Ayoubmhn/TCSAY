import { useQuery } from '@tanstack/react-query';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { CoachChip, SlotLine } from '../../components/SlotInfo';
import { DAY_FULL, WEEK } from '../../components/SlotsEditor';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { FilterSelect, Filters, SelectField, TextArea, TextField } from '../../components/ui/Field';
import { Segmented } from '../../components/ui/Segmented';
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
import { hm } from '../../lib/timetable';
import type { Category, Coach, Court, Group, GroupKind } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const KEYS = [['groups'], ['players'], ['dashboard'], ['coaches'], ['planning']];

type GroupForm = {
  name: string;
  categoryId: string;
  kind: GroupKind;
  capacity: string;
  weekly: string;
  session: string;
  physical: boolean;
  physWeekly: string;
  physSession: string;
  mainCoachId: string;
  physicalCoachId: string;
  preferredCourtId: string;
  reason: string;
};

const EMPTY: GroupForm = {
  name: '',
  categoryId: '',
  kind: 'COMPETITIVE',
  capacity: '12',
  weekly: '180',
  session: '90',
  physical: false,
  physWeekly: '60',
  physSession: '60',
  mainCoachId: '',
  physicalCoachId: '',
  preferredCourtId: '',
  reason: '',
};
const WEEKLY = Array.from({ length: 29 }, (_, i) => 60 + i * 30); // 1 h → 15 h par semaine
const DURATIONS = [
  { value: '60', label: '1 h' },
  { value: '90', label: '1 h 30' },
  { value: '120', label: '2 h' },
];

/** « 2 séances de 1 h 30 » (avec le reste éventuel). */
function sessionsText(weekly: number, session: number, what: string): string {
  const n = Math.floor(weekly / session);
  const rest = weekly - n * session;
  return `${n} séance${n > 1 ? 's' : ''} de ${what}de ${hm(session)}${rest ? ` (+ ${hm(rest)} non placées)` : ''}`;
}

/**
 * Formulaire groupe : volume par semaine (tennis, et séance physique au choix), entraîneur principal et terrain de préférence.
 * Les créneaux se placent sur la grille de l'emploi du temps (glisser-déposer) ; le volume ne peut pas y être dépassé.
 */
function GroupFormModal({ open, group, onClose }: { open: boolean; group?: Group; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState<GroupForm>(EMPTY);
  const placeNow = useRef(false);
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
            weekly: g.weeklyMinutes ? String(g.weeklyMinutes) : '',
            session: String(g.sessionMinutes ?? 90),
            physical: Boolean(g.physicalMinutes),
            physWeekly: String(g.physicalMinutes ?? 60),
            physSession: String(g.physicalSessionMinutes ?? 60),
            mainCoachId: g.mainCoachId ?? '',
            physicalCoachId: g.physicalCoachId ?? '',
            preferredCourtId: g.preferredCourtId ?? '',
            reason: '',
          }
        : EMPTY,
    );
  }, [open]);

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories'), enabled: open });
  const coaches = useQuery({ queryKey: ['coaches'], queryFn: () => api.get<Coach[]>('/coaches'), enabled: open });
  const courts = useQuery({ queryKey: ['courts'], queryFn: () => api.get<Court[]>('/courts'), enabled: open });
  const activeCoaches = coaches.data?.filter((c) => c.isActive) ?? [];

  const volumes = {
    weeklyMinutes: f.weekly ? Number(f.weekly) : null,
    sessionMinutes: f.weekly ? Number(f.session) : null,
    physicalMinutes: f.physical ? Number(f.physWeekly) : null,
    physicalSessionMinutes: f.physical ? Number(f.physSession) : null,
  };
  const volumeChanged =
    Boolean(group?.weeklyMinutes) &&
    (volumes.weeklyMinutes !== group?.weeklyMinutes ||
      volumes.sessionMinutes !== group?.sessionMinutes ||
      volumes.physicalMinutes !== (group?.physicalMinutes ?? null) ||
      volumes.physicalSessionMinutes !== (group?.physicalSessionMinutes ?? null));

  const payload = () => ({
    name: f.name,
    categoryId: f.categoryId || undefined,
    kind: f.kind,
    capacity: Number(f.capacity),
    weeklyMinutes: volumes.weeklyMinutes ?? 0,
    sessionMinutes: volumes.sessionMinutes ?? 0,
    physicalMinutes: volumes.physicalMinutes ?? 0,
    physicalSessionMinutes: volumes.physicalSessionMinutes ?? 0,
    mainCoachId: f.mainCoachId,
    physicalCoachId: f.physical ? f.physicalCoachId : '',
    preferredCourtId: f.preferredCourtId,
    ...(volumeChanged ? { volumeReason: f.reason } : {}),
  });
  const save = useAction(
    () => (group ? api.patch<Group>(`/groups/${group.id}`, { ...payload(), version: group.version }) : api.post<Group>('/groups', payload())),
    {
      invalidate: [...KEYS, ['timetable']],
      success: group ? 'Groupe enregistré.' : 'Groupe créé.',
      onSuccess: (g) => {
        onClose();
        if (placeNow.current) navigate(`/admin/emploi-du-temps?groupe=${g.id}`);
      },
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return toast('Nom du groupe obligatoire.');
    if (!group && !f.weekly) return toast('Choisissez les heures par semaine.');
    if (volumeChanged && !f.reason.trim()) return toast('Motif obligatoire pour changer le volume du groupe.');
    save.mutate();
  };

  const tennisText = volumes.weeklyMinutes ? sessionsText(volumes.weeklyMinutes, volumes.sessionMinutes!, 'tennis ') : 'Volume libre';
  const physText = volumes.physicalMinutes ? ` + ${sessionsText(volumes.physicalMinutes, volumes.physicalSessionMinutes!, 'physique ')}` : '';
  const total = (volumes.weeklyMinutes ?? 0) + (volumes.physicalMinutes ?? 0);

  return (
    <Modal
      open={open}
      size="xl"
      title={group ? 'Modifier le groupe' : 'Nouveau groupe'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          {group ? (
            <Button variant="primary" type="submit" form="group-form" disabled={save.isPending} onClick={() => (placeNow.current = false)}>
              Enregistrer
            </Button>
          ) : (
            <>
              <Button type="submit" form="group-form" disabled={save.isPending} onClick={() => (placeNow.current = false)}>
                Créer et placer plus tard
              </Button>
              <Button variant="primary" type="submit" form="group-form" disabled={save.isPending} onClick={() => (placeNow.current = true)}>
                Créer et placer sur la grille
              </Button>
            </>
          )}
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
          <SelectField label="Type de groupe" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as GroupKind })}>
            <option value="COMPETITIVE">Compétitif (jusqu’en août, stage d’été inclus)</option>
            <option value="LEISURE">Loisirs (octobre → juin)</option>
          </SelectField>
          <TextField label="Capacité" type="number" min={1} max={60} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
          <SelectField label="Heures de tennis par semaine" value={f.weekly} onChange={(e) => setF({ ...f, weekly: e.target.value })}>
            {group && !group.weeklyMinutes && <option value="">Libre (ancien fonctionnement)</option>}
            {!group && <option value="">— Choisir —</option>}
            {WEEKLY.map((m) => (
              <option key={m} value={m}>
                {hm(m)}
              </option>
            ))}
          </SelectField>
          <div>
            <span className="mb-1.5 block text-xs text-mut">Durée d’une séance de tennis</span>
            <Segmented label="Durée d’une séance de tennis" value={f.session} onChange={(v) => setF({ ...f, session: v })} options={DURATIONS} />
          </div>
          <SelectField label="Entraîneur principal" value={f.mainCoachId} onChange={(e) => setF({ ...f, mainCoachId: e.target.value })}>
            <option value="">— À affecter —</option>
            {activeCoaches.map((c) => (
              <option key={c.id} value={c.id}>
                {fullName(c).trim()}
              </option>
            ))}
          </SelectField>
          <SelectField label="Terrain de préférence (facultatif)" value={f.preferredCourtId} onChange={(e) => setF({ ...f, preferredCourtId: e.target.value })}>
            <option value="">—</option>
            {courts.data
              ?.filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.lit ? ' ☀' : ''}
                </option>
              ))}
          </SelectField>
        </div>

        <div className="rounded-[20px] border-[1.5px] border-line bg-dr p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3>Séance physique</h3>
            <Segmented
              label="Séance physique"
              value={f.physical ? 'oui' : 'non'}
              onChange={(v) => setF({ ...f, physical: v === 'oui' })}
              options={[
                { value: 'non', label: 'Non' },
                { value: 'oui', label: 'Oui' },
              ]}
            />
          </div>
          {f.physical && (
            <div className="mt-3 grid grid-cols-1 gap-3 min-[521px]:grid-cols-3">
              <SelectField label="Heures par semaine" value={f.physWeekly} onChange={(e) => setF({ ...f, physWeekly: e.target.value })}>
                {WEEKLY.slice(0, 9).map((m) => (
                  <option key={m} value={m}>
                    {hm(m)}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Durée d’une séance" value={f.physSession} onChange={(e) => setF({ ...f, physSession: e.target.value })}>
                {DURATIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Encadrée par" value={f.physicalCoachId} onChange={(e) => setF({ ...f, physicalCoachId: e.target.value })}>
                <option value="">L’entraîneur principal</option>
                {activeCoaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {fullName(c).trim()}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
          {f.physical && <p className="m-0 mt-2 text-[12.5px] text-mut">Hors terrain le plus souvent (salle, piste) : ne bloque aucun court.</p>}
        </div>

        <div className="rounded-[20px] border-[1.5px] border-line p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className="font-semibold">
              {tennisText}
              {physText}
            </b>
            {total > 0 && <Pill tone="b">{`${hm(total)} / semaine`}</Pill>}
          </div>
          <p className="m-0 mt-1.5 text-[12.5px] text-mut">
            Les séances se placent sur la grille de l’emploi du temps (glisser-déposer). Le volume ne peut pas être dépassé ; le modifier plus tard demande
            un motif.
          </p>
        </div>

        {volumeChanged && <TextArea label="Motif du changement de volume *" full rows={2} maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}

        {group && (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3>Séances de la semaine</h3>
              <Link to={`/admin/emploi-du-temps?groupe=${group.id}`} className="text-sm font-medium text-pri hover:underline">
                Modifier sur la grille →
              </Link>
            </div>
            {group.slots.length ? group.slots.map((s) => <SlotLine key={s.id} slot={s} />) : <CardText keep>Aucune séance placée.</CardText>}
          </div>
        )}
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
                      {g.slots.length === 0 && <CardText keep>Aucune séance placée.</CardText>}
                    </div>
                    {g.weeklyMinutes && (
                      <CardText>
                        {`Tennis ${hm(g.weeklyMinutes)} / sem.${g.sessionMinutes ? ` (séances de ${hm(g.sessionMinutes)})` : ''}${g.physicalMinutes ? ` · physique ${hm(g.physicalMinutes)} / sem.` : ''}`}
                      </CardText>
                    )}
                    <CardActions>
                      <ActionIcon kind="view" label="Détails du groupe" to={`/admin/groupes/${g.id}`} />
                      <ActionIcon kind="open" label="Placer sur la grille de l’emploi du temps" to={`/admin/emploi-du-temps?groupe=${g.id}`} />
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

