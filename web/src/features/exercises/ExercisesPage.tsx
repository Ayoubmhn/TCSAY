import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { KidSelect } from '../../components/KidSelect';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { Filters } from '../../components/ui/Field';
import { ProgressBar } from '../../components/ui/InstallmentCard';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { fD, todayIso } from '../../lib/format';
import type { ExerciseKind } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { KINDS } from './kinds';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { ActionIcon } from '../../components/ui/ActionIcon';

type MyExercise = {
  id: string;
  title: string;
  kind: ExerciseKind;
  durationMin: number | null;
  instructions: string;
  videoUrl: string | null;
  dueDate: string | null;
  note: string | null;
  coach: string;
  doneAt: string | null;
};

/** Exercices (joueur, parent) : à faire avant la séance ou à la maison, cochés « fait ». */
export function ExercisesPage() {
  const [view, setView] = useViewMode('exercices');
  const { playerId } = useAuth();
  const q = useQuery({
    queryKey: ['my-exercises', playerId],
    queryFn: () => api.get<MyExercise[]>('/exercises/mine', { playerId }),
    enabled: Boolean(playerId),
  });
  const toggle = useAction(
    ({ id, done }: { id: string; done: boolean }) => api.put<{ done: boolean }>(`/exercises/assignments/${id}/done`, { playerId, done }),
    { invalidate: [['my-exercises']], success: ({ done }: { done: boolean }) => (done ? 'Exercice fait, bravo 👏' : 'Exercice marqué non fait.') },
  );
  const list = q.data ?? [];
  const done = list.filter((e) => e.doneAt).length;
  const today = todayIso();

  return (
    <>
      <PageHeader title="Exercices" subtitle="Découvrez les exercices donnés par l’entraîneur, avant la séance ou à la maison." action={<ViewToggle value={view} onChange={setView} />} />
      <Filters>
        <KidSelect />
        {q.data && <Pill tone={done === list.length && list.length > 0 ? 'g' : 'b'}>{done}/{list.length} fait(s)</Pill>}
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {list.length ? (
          <>
            <ProgressBar value={done} max={list.length} />
            {KINDS.filter((k) => list.some((e) => e.kind === k.value)).map((k) => (
              <Section key={k.value} title={`${k.icon} ${k.label}`}>
                <CardGrid list={view === 'list'}>
                  {list
                    .filter((e) => e.kind === k.value)
                    .map((e) => {
                      const late = !e.doneAt && e.dueDate !== null && e.dueDate < today;
                      return (
                        <Card key={e.id}>
                          <CardRow>
                            <h3 className={e.doneAt ? 'text-mut line-through' : ''}>{e.title}</h3>
                            {e.doneAt ? <Pill tone="g">Fait</Pill> : late ? <Pill tone="r">En retard</Pill> : <Pill tone="b">À faire</Pill>}
                          </CardRow>
                          <Pills>
                            {e.durationMin && <Pill tone="b">{e.durationMin} min</Pill>}
                            {e.dueDate && <Pill tone="s">Avant le {fD(e.dueDate, { weekday: 'short', day: 'numeric', month: 'short' })}</Pill>}
                            <Pill tone="s">Par {e.coach}</Pill>
                          </Pills>
                          <CardText>{e.instructions}</CardText>
                          {e.note && <CardText>💬 {e.note}</CardText>}
                          <CardActions>
                            <ActionIcon
                              kind={e.doneAt ? 'cancel' : 'check'}
                              label={e.doneAt ? 'Annuler « fait »' : 'Marquer fait'}
                              primary={!e.doneAt}
                              onClick={() => toggle.mutate({ id: e.id, done: !e.doneAt })}
                              disabled={toggle.isPending}
                            />
                            {e.videoUrl && (
                              <a
                                href={e.videoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg"
                              >
                                Voir la vidéo
                              </a>
                            )}
                          </CardActions>
                        </Card>
                      );
                    })}
                </CardGrid>
              </Section>
            ))}
          </>
        ) : (
          <EmptyState>Aucun exercice à faire pour le moment.</EmptyState>
        )}
      </QueryState>
      <Note>L’entraîneur voit qui a fait ses exercices. Faites l’échauffement avant chaque séance.</Note>
    </>
  );
}
