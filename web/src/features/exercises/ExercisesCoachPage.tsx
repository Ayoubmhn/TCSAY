import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { SelectField, TextArea, TextField } from '../../components/ui/Field';
import { ProgressBar } from '../../components/ui/InstallmentCard';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { api } from '../../lib/api';
import { fD, todayIso } from '../../lib/format';
import type { Exercise, ExerciseKind } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { KINDS, kindOf } from './kinds';

type Assignment = {
  id: string;
  exercise: { title: string; kind: ExerciseKind };
  target: string;
  dueDate: string | null;
  note: string | null;
  createdAt: string;
  total: number;
  done: number;
  missing: string[];
};

/** Exercices (entraîneur, direction technique) : bibliothèque, exercices donnés et suivi de qui les a faits. */
export function ExercisesCoachPage() {
  const library = useQuery({ queryKey: ['exercises'], queryFn: () => api.get<Exercise[]>('/exercises') });
  const given = useQuery({ queryKey: ['exercise-assignments'], queryFn: () => api.get<Assignment[]>('/exercises/assignments') });
  const [view, setView] = useViewMode('exercices');
  const [form, setForm] = useState<{ open: boolean; exercise?: Exercise }>({ open: false });
  const [giving, setGiving] = useState<Exercise>();
  const [toArchive, setToArchive] = useState<Exercise>();
  const archive = useAction((id: string) => api.post(`/exercises/${id}/archive`), {
    invalidate: [['exercises']],
    success: 'Exercice archivé.',
    onSuccess: () => setToArchive(undefined),
  });

  return (
    <>
      <PageHeader
        title="Exercices"
        subtitle="Découvrez la bibliothèque d’exercices et donnez-les à vos groupes."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            <Button variant="primary" onClick={() => setForm({ open: true })}>
              + Nouvel exercice
            </Button>
          </div>
        }
      />

      <Section title="Exercices donnés (30 jours)">
        <QueryState isPending={given.isPending} error={given.error} refetch={given.refetch}>
          {given.data?.length ? (
            <CardGrid list={view === 'list'}>
              {given.data.map((a) => (
                <Card key={a.id}>
                  <CardRow>
                    <h3>
                      {kindOf(a.exercise.kind).icon} {a.exercise.title}
                    </h3>
                  </CardRow>
                  <Pills>
                    <Pill tone="b">{a.target}</Pill>
                    {a.dueDate && <Pill tone="s">Avant le {fD(a.dueDate, { day: 'numeric', month: 'short' })}</Pill>}
                    <Pill tone={a.done === a.total && a.total > 0 ? 'g' : 'b'}>
                      {a.done}/{a.total} fait(s)
                    </Pill>
                  </Pills>
                  {a.total > 0 && <ProgressBar value={a.done} max={a.total} />}
                  <CardText>{a.missing.length ? `Pas encore fait : ${a.missing.join(', ')}` : 'Tout le monde l’a fait 👏'}</CardText>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun exercice donné ces 30 derniers jours.</EmptyState>
          )}
        </QueryState>
      </Section>

      <Section title="Bibliothèque">
        <QueryState isPending={library.isPending} error={library.error} refetch={library.refetch}>
          {library.data?.length ? (
            <CardGrid list={view === 'list'}>
              {library.data.map((e) => (
                <Card key={e.id}>
                  <CardRow>
                    <h3>
                      {kindOf(e.kind).icon} {e.title}
                    </h3>
                  </CardRow>
                  <Pills>
                    <Pill tone="s">{kindOf(e.kind).label}</Pill>
                    {e.durationMin && <Pill tone="b">{e.durationMin} min</Pill>}
                    {e.videoUrl && <Pill tone="b">Vidéo</Pill>}
                  </Pills>
                  <CardText>{e.instructions}</CardText>
                  <CardActions>
                    <ActionIcon kind="add" label="Donner cet exercice" primary onClick={() => setGiving(e)} />
                    {e.mine && <ActionIcon kind="edit" onClick={() => setForm({ open: true, exercise: e })} />}
                    {e.mine && <ActionIcon kind="archive" onClick={() => setToArchive(e)} />}
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Bibliothèque vide : créez un premier exercice.</EmptyState>
          )}
        </QueryState>
      </Section>
      <Note>
        Le joueur ou le parent coche « Fait » dans son espace Exercices. Un exercice est modifié ou archivé par son auteur
        (ou la direction technique) ; archiver ne retire pas les exercices déjà donnés.
      </Note>

      {form.open && <ExerciseFormModal exercise={form.exercise} onClose={() => setForm({ open: false })} />}
      {giving && <AssignModal exercise={giving} onClose={() => setGiving(undefined)} />}
      <ConfirmModal
        open={Boolean(toArchive)}
        title="Archiver cet exercice ?"
        text={`« ${toArchive?.title ?? ''} » sort de la bibliothèque (R8 : archivage, rien n’est supprimé).`}
        cta="Archiver"
        pending={archive.isPending}
        onConfirm={() => toArchive && archive.mutate(toArchive.id)}
        onClose={() => setToArchive(undefined)}
      />
    </>
  );
}

function ExerciseFormModal({ exercise, onClose }: { exercise?: Exercise; onClose: () => void }) {
  const [title, setTitle] = useState(exercise?.title ?? '');
  const [kind, setKind] = useState<ExerciseKind>(exercise?.kind ?? 'WARMUP');
  const [duration, setDuration] = useState(exercise?.durationMin ? String(exercise.durationMin) : '');
  const [instructions, setInstructions] = useState(exercise?.instructions ?? '');
  const [videoUrl, setVideoUrl] = useState(exercise?.videoUrl ?? '');
  const body = () => ({
    title,
    kind,
    durationMin: duration ? Number(duration) : undefined,
    instructions,
    videoUrl: videoUrl.trim() || undefined,
  });
  const save = useAction(() => (exercise ? api.patch(`/exercises/${exercise.id}`, body()) : api.post('/exercises', body())), {
    invalidate: [['exercises']],
    success: exercise ? 'Exercice modifié.' : 'Exercice créé.',
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      title={exercise ? 'Modifier l’exercice' : 'Nouvel exercice'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={() => save.mutate()} disabled={!title.trim() || !instructions.trim() || save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 min-[521px]:grid-cols-2">
        <TextField label="Titre" value={title} maxLength={80} full onChange={(e) => setTitle(e.target.value)} />
        <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value as ExerciseKind)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.icon} {k.label}
            </option>
          ))}
        </SelectField>
        <TextField label="Durée (minutes)" type="number" min={1} max={120} value={duration} onChange={(e) => setDuration(e.target.value)} />
        <TextArea label="Consignes" rows={4} value={instructions} maxLength={1500} full onChange={(e) => setInstructions(e.target.value)} />
        <TextField label="Lien vidéo (facultatif, https://…)" value={videoUrl} maxLength={300} full onChange={(e) => setVideoUrl(e.target.value)} />
      </div>
    </Modal>
  );
}

type GroupRow = { id: string; name: string; members: number };

/** Donner l'exercice à un groupe entier ou à un joueur du groupe, avec échéance facultative. */
function AssignModal({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const groups = useQuery({ queryKey: ['evaluation-groups'], queryFn: () => api.get<GroupRow[]>('/evaluations/groups') });
  const [groupId, setGroupId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const gid = groupId || groups.data?.find((g) => g.members > 0)?.id || '';
  const players = useQuery({
    queryKey: ['evaluation-group', gid, 'T1'],
    queryFn: () => api.get<{ players: { id: string; firstName: string; lastName: string }[] }>('/evaluations/group', { groupId: gid, period: 'T1' }),
    enabled: Boolean(gid),
  });
  const save = useAction(
    () =>
      api.post<{ players: number }>(`/exercises/${exercise.id}/assign`, {
        ...(playerId ? { playerId } : { groupId: gid }),
        dueDate: dueDate || undefined,
        note: note.trim() || undefined,
      }),
    { invalidate: [['exercise-assignments'], ['exercises']], success: (r) => `Exercice donné à ${r.players} joueur(s) : notification envoyée.`, onSuccess: onClose },
  );
  return (
    <Modal
      open
      title={`Donner : ${exercise.title}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={() => save.mutate()} disabled={!gid || save.isPending}>
            Donner l’exercice
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 min-[521px]:grid-cols-2">
        <SelectField
          label="Groupe"
          value={gid}
          onChange={(e) => {
            setGroupId(e.target.value);
            setPlayerId('');
          }}
        >
          {(groups.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.members})
            </option>
          ))}
        </SelectField>
        <SelectField label="Pour" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
          <option value="">Tout le groupe</option>
          {(players.data?.players ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
            </option>
          ))}
        </SelectField>
        <TextField label="À faire avant (facultatif)" type="date" min={todayIso()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <TextField label="Note (facultatif)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}
