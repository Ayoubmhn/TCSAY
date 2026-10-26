import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { SlotLine } from '../../components/SlotInfo';
import { badSlot, DAY_FULL, newSlot, SlotsEditor, slotsPayload, slotToForm, WEEK, type SlotForm } from '../../components/SlotsEditor';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardSubtitle, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { TextArea, TextField } from '../../components/ui/Field';
import { START_DEFAULT, StartFromField, startFromBody, startFromProblem, type StartFrom } from './StartFrom';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills, type PillTone } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { Segmented } from '../../components/ui/Segmented';
import { useToast } from '../../components/ui/Toast';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { api } from '../../lib/api';
import { fD } from '../../lib/format';
import type { TempScheduleDetail, TempScheduleList, TempScheduleMode, TempSchedulePhase, TempScheduleSummary } from '../../lib/types';
import { useAction } from '../../lib/useAction';

/** Tout ce qui découle d'un emploi temporaire : planning, séances, présences, réservations, groupes. */
const KEYS = [['temp-schedules'], ['temp-schedule'], ['planning'], ['sessions'], ['groups'], ['dashboard']];

const PHASE: Record<TempSchedulePhase, { label: string; tone: PillTone }> = {
  UPCOMING: { label: 'À venir', tone: 'b' },
  RUNNING: { label: 'En cours', tone: 'g' },
  DONE: { label: 'Terminé', tone: 's' },
};
const MODE_LABEL: Record<TempScheduleMode, string> = { REPLACE: 'Horaire remplacé', ADD: 'Séances en plus' };
const long = (iso: string) => fD(iso, { weekday: 'short', day: 'numeric', month: 'long' });

function StatusPills({ s }: { s: Pick<TempScheduleSummary, 'status' | 'phase' | 'startDate' | 'endDate' | 'sessionsOwed'> }) {
  return (
    <Pills>
      <Pill tone="b">
        {long(s.startDate)} → {long(s.endDate)}
      </Pill>
      {s.status === 'DRAFT' ? <Pill tone="s">Brouillon</Pill> : <Pill tone={PHASE[s.phase].tone}>{`Publié · ${PHASE[s.phase].label}`}</Pill>}
      {s.sessionsOwed && <Pill tone="r">Séances dues (à rattraper)</Pill>}
    </Pills>
  );
}

/** Nom, dates et remarque (création et modification). */
function ScheduleFormModal({ open, schedule, onClose }: { open: boolean; schedule?: TempScheduleDetail; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', startDate: '', endDate: '', note: '', sessionsOwed: false });
  const [start, setStart] = useState<StartFrom>(START_DEFAULT);
  useEffect(() => {
    if (!open) return;
    setF(
      schedule
        ? { name: schedule.name, startDate: schedule.startDate, endDate: schedule.endDate, note: schedule.note ?? '', sessionsOwed: schedule.sessionsOwed }
        : { name: '', startDate: '', endDate: '', note: '', sessionsOwed: false },
    );
    setStart(START_DEFAULT);
  }, [open, schedule]);
  const save = useAction(
    () =>
      schedule
        ? api.patch(`/temp-schedules/${schedule.id}`, { ...f, version: schedule.version })
        : api.post<{ id: string }>('/temp-schedules', { name: f.name, startDate: f.startDate, endDate: f.endDate, note: f.note, ...startFromBody(start) }),
    {
      invalidate: KEYS,
      success: schedule ? 'Emploi temporaire enregistré.' : 'Emploi temporaire créé : choisissez les groupes.',
      onSuccess: (r) => {
        onClose();
        if (!schedule && r && typeof r === 'object' && 'id' in r) navigate(`/admin/vacances/${(r as { id: string }).id}`);
      },
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return toast('Nom obligatoire (ex. « Vacances d’hiver »).');
    if (!f.startDate || !f.endDate) return toast('Dates de début et de fin obligatoires.');
    if (f.endDate < f.startDate) return toast('La date de fin doit suivre la date de début.');
    const problem = schedule ? null : startFromProblem(start);
    if (problem) return toast(problem);
    save.mutate();
  };
  return (
    <Modal
      open={open}
      title={schedule ? 'Modifier l’emploi temporaire' : 'Nouvel emploi temporaire'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="temp-form" disabled={save.isPending}>
            {schedule ? 'Enregistrer' : 'Créer'}
          </Button>
        </>
      }
    >
      <form id="temp-form" noValidate onSubmit={submit} className="grid grid-cols-1 gap-3 min-[521px]:grid-cols-2">
        <TextField label="Nom *" full maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex. Vacances d’hiver" />
        <TextField label="Du *" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        <TextField label="Au (inclus) *" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
        <TextArea label="Remarque (facultative)" full rows={2} maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <div className="min-[521px]:col-span-2">
          {schedule ? (
            <label className="flex items-start gap-2.5 text-[14px]">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-pri" checked={f.sessionsOwed} onChange={(e) => setF({ ...f, sessionsOwed: e.target.checked })} />
              <span>
                Séances dues pendant ces dates
                <span className="block text-[12.5px] text-mut">Cochée : les séances habituelles retirées comptent « à rattraper » dans le compteur des séances.</span>
              </span>
            </label>
          ) : (
            <StartFromField value={start} onChange={setStart} />
          )}
        </div>
      </form>
    </Modal>
  );
}

/** Emplois temporaires (vacances, stages) de la saison. */
export function TempSchedulesPage() {
  const { me } = useAuth();
  const canManage = Boolean(me?.permissions.includes('groups.manage'));
  const q = useQuery({ queryKey: ['temp-schedules'], queryFn: () => api.get<TempScheduleList>('/temp-schedules') });
  const [view, setView] = useViewMode('vacances');
  const [creating, setCreating] = useState(false);
  const list = q.data?.schedules ?? [];

  return (
    <>
      <PageHeader
        title="Emplois temporaires"
        subtitle="Découvrez les emplois du temps des vacances et des stages."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            {canManage && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                + Nouvel emploi temporaire
              </Button>
            )}
          </div>
        }
      />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {list.length ? (
          <CardGrid list={view === 'list'}>
            {list.map((s) => {
              const replaced = s.groups.filter((g) => g.mode === 'REPLACE').length;
              const added = s.groups.length - replaced;
              return (
                <Card key={s.id}>
                  <CardRow>
                    <Link to={`/admin/vacances/${s.id}`} className="min-w-0 hover:underline">
                      <h3>{s.name}</h3>
                    </Link>
                  </CardRow>
                  <StatusPills s={s} />
                  <CardText>
                    {s.groups.length
                      ? [replaced ? `${replaced} groupe${replaced > 1 ? 's' : ''} à horaire remplacé` : '', added ? `${added} en séances en plus` : '']
                          .filter(Boolean)
                          .join(' · ')
                      : 'Aucun groupe choisi.'}
                  </CardText>
                  <CardActions>
                    <ActionIcon kind="view" label="Ouvrir" to={`/admin/vacances/${s.id}`} />
                  </CardActions>
                </Card>
              );
            })}
          </CardGrid>
        ) : (
          <EmptyState>Aucun emploi temporaire pour la saison {q.data?.season.label}.</EmptyState>
        )}
      </QueryState>
      <Note>
        Pendant les vacances, un groupe peut suivre un autre horaire (ou n’avoir aucune séance) ou avoir des séances en plus (stage).
        Un brouillon ne change rien ; une fois publié, le planning, les séances, les présences et la grille de réservation suivent
        l’emploi temporaire, puis l’horaire habituel revient tout seul. Pas de conflit de terrain ni d’entraîneur (R5).
      </Note>
      <ScheduleFormModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

type GroupRow = TempScheduleDetail['groups'][number];

/** Place d'un groupe dans l'emploi : horaire remplacé (créneaux, ou aucun = pas de séance) ou séances en plus. */
function GroupModal({ schedule, group, onClose }: { schedule: TempScheduleDetail; group?: GroupRow; onClose: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<TempScheduleMode>('REPLACE');
  const [slots, setSlots] = useState<SlotForm[]>([]);
  // Nouveau groupe : on part de son horaire habituel (à modifier) ; en « séances en plus », on part de zéro.
  const [prefilled, setPrefilled] = useState(false);
  const usualCopy = () => (group ? group.usualSlots.filter((s) => schedule.days.includes(s.day)).map((s) => slotToForm(s, false)) : []);
  useEffect(() => {
    if (!group) return;
    setMode(group.mode ?? 'REPLACE');
    setSlots(group.mode ? group.slots.map((s) => slotToForm(s)) : group.usualSlots.filter((s) => schedule.days.includes(s.day)).map((s) => slotToForm(s, false)));
    setPrefilled(!group.mode);
  }, [group, schedule.days]);
  const changeMode = (m: TempScheduleMode) => {
    setMode(m);
    if (!prefilled) return;
    setSlots(m === 'ADD' ? [] : usualCopy());
  };
  const editSlots = (next: SlotForm[]) => {
    setPrefilled(false);
    setSlots(next);
  };
  const save = useAction(
    () => api.put(`/temp-schedules/${schedule.id}/groups/${group!.id}`, { mode, slots: slotsPayload(slots), version: schedule.version }),
    { invalidate: KEYS, success: 'Horaire des vacances enregistré.', onSuccess: onClose },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'ADD' && !slots.length) return toast('Séances en plus : ajoutez au moins un créneau.');
    const bad = badSlot(slots);
    if (bad) return toast(bad);
    save.mutate();
  };
  const firstDay = WEEK.find((d) => schedule.days.includes(d)) ?? 1;
  return (
    <Modal
      open={Boolean(group)}
      size="xl"
      title={group ? `${group.name} : ${schedule.name}` : ''}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="temp-group-form" disabled={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      {group && (
        <form id="temp-group-form" noValidate onSubmit={submit} className="flex flex-col gap-3">
          <Segmented<TempScheduleMode>
            label="Pendant ces dates"
            value={mode}
            onChange={changeMode}
            options={[
              { value: 'REPLACE', label: 'Remplacer l’horaire habituel' },
              { value: 'ADD', label: 'Séances en plus (stage)' },
            ]}
          />
          <p className="m-0 text-[13px] text-mut">
            {mode === 'REPLACE'
              ? 'Les séances habituelles n’ont pas lieu : seulement les créneaux ci-dessous. Aucun créneau = pas de séance pendant ces dates.'
              : 'Les séances habituelles continuent, et les créneaux ci-dessous s’ajoutent.'}
          </p>
          <div>
            <CardSubtitle>Horaire habituel</CardSubtitle>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {group.usualSlots.length ? group.usualSlots.map((s) => <SlotLine key={s.id} slot={s} />) : <CardText keep>Aucun créneau habituel.</CardText>}
              {!group.usualRuns && <CardText keep>Ce groupe ne s’entraîne pas à ces dates (période loisirs).</CardText>}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3>Créneaux pendant les vacances</h3>
            <div className="flex flex-wrap gap-2">
              {group.usualSlots.length > 0 && (
                <Button onClick={() => editSlots(usualCopy())}>
                  Copier l’horaire habituel
                </Button>
              )}
              <Button onClick={() => editSlots([...slots, newSlot(slots.at(-1)?.day ?? firstDay)])}>+ Ajouter un créneau</Button>
            </div>
          </div>
          {slots.length ? (
            <SlotsEditor slots={slots} onChange={editSlots} days={schedule.days} />
          ) : (
            <CardText keep>{mode === 'REPLACE' ? 'Pas de séance pendant ces dates.' : 'Ajoutez au moins un créneau.'}</CardText>
          )}
        </form>
      )}
    </Modal>
  );
}

/** Fiche d'un emploi temporaire : dates, groupes concernés et leurs créneaux, publication. */
export function TempSchedulePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const canManage = Boolean(me?.permissions.includes('groups.manage'));
  const q = useQuery({ queryKey: ['temp-schedule', id], queryFn: () => api.get<TempScheduleDetail>(`/temp-schedules/${id}`) });
  const s = q.data;
  const [editing, setEditing] = useState(false);
  const [group, setGroup] = useState<GroupRow>();
  const [removing, setRemoving] = useState<GroupRow>();
  const [publishing, setPublishing] = useState(false);
  const [notify, setNotify] = useState(true);
  const [unpublishing, setUnpublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const publish = useAction(() => api.post<{ notified: number }>(`/temp-schedules/${id}/publish`, { version: s!.version, notify }), {
    invalidate: KEYS,
    success: (r) => (r.notified ? `Emploi publié : ${r.notified} personne${r.notified > 1 ? 's' : ''} prévenue${r.notified > 1 ? 's' : ''}.` : 'Emploi publié.'),
    onSuccess: () => setPublishing(false),
  });
  const unpublish = useAction((reason: string) => api.post(`/temp-schedules/${id}/unpublish`, { version: s!.version, reason }), {
    invalidate: KEYS,
    success: 'Retour en brouillon : l’horaire habituel s’applique.',
    onSuccess: () => setUnpublishing(false),
  });
  const archive = useAction((reason: string) => api.post(`/temp-schedules/${id}/archive`, { version: s!.version, reason }), {
    invalidate: KEYS,
    success: 'Emploi temporaire archivé.',
    onSuccess: () => navigate('/admin/vacances'),
  });
  const remove = useAction(() => api.delete(`/temp-schedules/${id}/groups/${removing!.id}`, { version: s!.version }), {
    invalidate: KEYS,
    success: 'Groupe retiré : il garde son horaire habituel.',
    onSuccess: () => setRemoving(undefined),
  });

  const inSchedule = s?.groups.filter((g) => g.mode) ?? [];
  const others = s?.groups.filter((g) => !g.mode) ?? [];
  const started = Boolean(s && s.status === 'PUBLISHED' && s.phase !== 'UPCOMING');

  return (
    <>
      <PageHeader title={s?.name ?? 'Emploi temporaire'} subtitle="Découvrez l’horaire des groupes pendant ces dates." />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {s && (
          <>
            <Card>
              <CardRow>
                <StatusPills s={s} />
              </CardRow>
              <CardText keep>
                {s.days.length === 7 ? 'Tous les jours de la semaine sont compris.' : `Jours compris : ${WEEK.filter((d) => s.days.includes(d)).map((d) => DAY_FULL[d].toLowerCase()).join(', ')}.`}
                {s.note ? ` ${s.note}` : ''}
              </CardText>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => navigate('/admin/vacances')}>← Emplois temporaires</Button>
                {canManage && s.phase !== 'DONE' && <Button onClick={() => setEditing(true)}>Modifier les dates</Button>}
                {canManage && s.status === 'DRAFT' && (
                  <Button variant="primary" onClick={() => setPublishing(true)} disabled={!inSchedule.length}>
                    Publier
                  </Button>
                )}
                {canManage && s.status === 'PUBLISHED' && !started && <Button onClick={() => setUnpublishing(true)}>Retirer la publication</Button>}
                {canManage && !started && (
                  <Button variant="danger" onClick={() => setArchiving(true)}>
                    Archiver
                  </Button>
                )}
              </div>
            </Card>

            <Section title="Groupes concernés">
              {inSchedule.length ? (
                <CardGrid>
                  {inSchedule.map((g) => (
                    <Card key={g.id}>
                      <CardRow>
                        <Link to={`/admin/groupes/${g.id}`} className="min-w-0 hover:underline">
                          <h3>{g.name}</h3>
                        </Link>
                        <Pill tone={g.mode === 'ADD' ? 'g' : 's'}>{MODE_LABEL[g.mode!]}</Pill>
                      </CardRow>
                      <div className="flex flex-col gap-1.5">
                        {g.slots.length ? g.slots.map((x) => <SlotLine key={x.id} slot={x} />) : <Pill tone="r">Pas de séance pendant ces dates</Pill>}
                      </div>
                      <CardText>
                        {g.mode === 'ADD' ? 'En plus de l’horaire habituel.' : 'À la place de l’horaire habituel.'} {g.members} joueur{g.members > 1 ? 's' : ''}.
                      </CardText>
                      {canManage && s.phase !== 'DONE' && (
                        <CardActions>
                          <ActionIcon kind="edit" label="Modifier l’horaire des vacances" onClick={() => setGroup(g)} />
                          {!(started && g.mode === 'REPLACE') && <ActionIcon kind="remove" label="Retirer de l’emploi temporaire" onClick={() => setRemoving(g)} />}
                        </CardActions>
                      )}
                    </Card>
                  ))}
                </CardGrid>
              ) : (
                <EmptyState>Aucun groupe : ajoutez ci-dessous les groupes dont l’horaire change.</EmptyState>
              )}
            </Section>

            <Section title="Groupes à l’horaire habituel">
              {others.length ? (
                <CardGrid list>
                  {others.map((g) => (
                    <Card key={g.id}>
                      <CardRow>
                        <h3>{g.name}</h3>
                        {!g.usualRuns && <Pill tone="s">Pas d’entraînement à ces dates</Pill>}
                      </CardRow>
                      <div className="flex flex-col gap-1.5">
                        {g.usualSlots.map((x) => (
                          <SlotLine key={x.id} slot={x} />
                        ))}
                      </div>
                      {canManage && s.phase !== 'DONE' && (
                        <CardActions>
                          <ActionIcon kind="add" label="Changer l’horaire de ce groupe pendant ces dates" onClick={() => setGroup(g)} />
                        </CardActions>
                      )}
                    </Card>
                  ))}
                </CardGrid>
              ) : (
                <EmptyState>Tous les groupes sont dans cet emploi temporaire.</EmptyState>
              )}
            </Section>

            <Note>
              {s.status === 'DRAFT'
                ? 'Brouillon : rien ne change encore pour les familles et les entraîneurs. Publiez quand l’horaire est prêt.'
                : 'Publié : le planning, les séances, les présences et la grille de réservation suivent cet emploi pendant ses dates.'}{' '}
              Un groupe ne suit qu’un emploi publié à la fois. Une fois commencé, l’emploi ne se retire plus : raccourcissez la date de fin si besoin.
            </Note>

            <ScheduleFormModal open={editing} schedule={s} onClose={() => setEditing(false)} />
            <GroupModal schedule={s} group={group} onClose={() => setGroup(undefined)} />
            <Modal
              open={publishing}
              title="Publier cet emploi temporaire ?"
              onClose={() => setPublishing(false)}
              footer={
                <>
                  <Button onClick={() => setPublishing(false)}>Annuler</Button>
                  <Button variant="primary" data-primary onClick={() => publish.mutate()} disabled={publish.isPending}>
                    Publier
                  </Button>
                </>
              }
            >
              <p className="m-0 text-mut">
                Du {long(s.startDate)} au {long(s.endDate)}, {inSchedule.map((g) => g.name).join(', ')} suivront cet emploi. Le planning et les séances changent
                dès maintenant.
              </p>
              <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-pri" />
                Prévenir les familles et les entraîneurs (notification)
              </label>
            </Modal>
            <ConfirmModal
              open={unpublishing}
              title="Retirer la publication ?"
              text="L’horaire habituel s’appliquera de nouveau ; les familles et les entraîneurs sont prévenus."
              cta="Retirer"
              withMotif
              pending={unpublish.isPending}
              onConfirm={(m) => unpublish.mutate(m)}
              onClose={() => setUnpublishing(false)}
            />
            <ConfirmModal
              open={archiving}
              title="Archiver cet emploi temporaire ?"
              text="Il sera archivé, pas supprimé (R8). S’il était publié, les familles et les entraîneurs sont prévenus."
              cta="Archiver"
              withMotif
              pending={archive.isPending}
              onConfirm={(m) => archive.mutate(m)}
              onClose={() => setArchiving(false)}
            />
            <ConfirmModal
              open={Boolean(removing)}
              title="Retirer ce groupe ?"
              text={removing ? `${removing.name} gardera son horaire habituel pendant ces dates.` : ''}
              cta="Retirer"
              pending={remove.isPending}
              onConfirm={() => remove.mutate()}
              onClose={() => setRemoving(undefined)}
            />
          </>
        )}
      </QueryState>
    </>
  );
}
