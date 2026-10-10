import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { KidSelect } from '../../components/KidSelect';
import { Card, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { fD } from '../../lib/format';
import type { Absence } from '../../lib/types';

/** Mes absences (vAbs). */
export function AbsencesPage() {
  const { playerId } = useAuth();
  const q = useQuery({
    queryKey: ['absences', playerId],
    queryFn: () => api.get<Absence[]>('/absences', { playerId }),
    enabled: Boolean(playerId),
  });
  const list = q.data ?? [];

  return (
    <>
      <PageHeader title="Mes absences" subtitle="Découvrez les séances manquées cette saison." />
      <Filters>
        <KidSelect />
        {q.data && (
          <Pill tone="r">
            {list.length} absence{list.length > 1 ? 's' : ''}
          </Pill>
        )}
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {list.length ? (
          <CardGrid>
            {list.map((a) => (
              <Card key={a.id}>
                <CardRow>
                  <h3>{a.group.name}</h3>
                  {a.status === 'LATE' ? <Pill tone="b">En retard</Pill> : <Pill tone="r">Absent</Pill>}
                </CardRow>
                <Pills>
                  <Pill tone="b">{fD(a.date)}</Pill>
                  <Pill tone="b">{a.group.startTime}</Pill>
                </Pills>
                <CardText>Motif : {a.reason}</CardText>
              </Card>
            ))}
          </CardGrid>
        ) : (
          <EmptyState>Aucune absence. Bravo !</EmptyState>
        )}
      </QueryState>
      <Note>Les présences sont pointées par le coach à chaque séance.</Note>
    </>
  );
}
