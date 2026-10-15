import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { KidSelect } from '../../components/KidSelect';
import { Card, CardRow, CardTitle, EmptyState, PageHeader, Pill, Pills, QueryState, Screen, T } from '../../components/ui';
import { api } from '../../lib/api';
import { fDYear } from '../../lib/format';
import type { Absence } from '../../lib/types';

/** Mes absences (vAbs) : absences et retards pointés par l'entraîneur. */
export default function AbsencesScreen() {
  const { playerId } = useAuth();
  const q = useQuery({ queryKey: ['absences', playerId], queryFn: () => api.get<Absence[]>('/absences', { playerId }), enabled: Boolean(playerId) });
  const rows = q.data ?? [];
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <PageHeader title="Mes absences" subtitle="Découvrez les séances manquées et les retards." />
      <KidSelect />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {rows.length ? (
          <>
            <Pills>
              <Pill tone="r">{`${rows.filter((a) => a.status === 'ABSENT').length} absence(s)`}</Pill>
              <Pill tone="b">{`${rows.filter((a) => a.status === 'LATE').length} retard(s)`}</Pill>
            </Pills>
            {rows.map((a) => (
              <Card key={a.id}>
                <CardRow>
                  <CardTitle>{a.group.name}</CardTitle>
                  <Pill tone={a.status === 'LATE' ? 'b' : 'r'}>{a.status === 'LATE' ? 'En retard' : 'Absent'}</Pill>
                </CardRow>
                <Pills>
                  <Pill tone="b">{fDYear(a.date)}</Pill>
                  <Pill tone="b">{`${a.group.startTime} – ${a.group.endTime}`}</Pill>
                </Pills>
                {a.reason ? <T mut size={13}>{a.reason}</T> : null}
              </Card>
            ))}
          </>
        ) : (
          <EmptyState>Aucune absence cette saison. Bravo !</EmptyState>
        )}
      </QueryState>
    </Screen>
  );
}
