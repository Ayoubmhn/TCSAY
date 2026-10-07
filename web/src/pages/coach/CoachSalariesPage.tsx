import { useQuery } from '@tanstack/react-query';
import { Card, CardGrid, CardRow, EmptyState, Kpi } from '../../components/ui/Card';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { DT, fD } from '../../lib/format';
import type { Salary } from '../../lib/types';

/** Mes salaires (vCSal) : salaires versés seulement. */
export function CoachSalariesPage() {
  const q = useQuery({ queryKey: ['salaries', 'mine'], queryFn: () => api.get<Salary[]>('/salaries/mine') });
  const list = q.data ?? [];

  return (
    <>
      <PageHeader title="Mes salaires" subtitle="Découvrez les salaires qui vous ont été versés." />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        <Pills className="my-[18px]">
          <Pill tone="g">Total versé {DT(list.reduce((s, x) => s + x.amount, 0))}</Pill>
        </Pills>
        {list.length ? (
          <CardGrid>
            {list.map((s) => (
              <Card key={s.id}>
                <CardRow>
                  <h3>{s.period}</h3>
                  <Pill tone="g">Versé</Pill>
                </CardRow>
                <Kpi>{DT(s.amount)}</Kpi>
                {s.paidAt && (
                  <Pills>
                    <Pill tone="b">Versé le {fD(s.paidAt, { day: 'numeric', month: 'short', year: 'numeric' })}</Pill>
                  </Pills>
                )}
              </Card>
            ))}
          </CardGrid>
        ) : (
          <EmptyState>Aucun salaire versé pour le moment.</EmptyState>
        )}
      </QueryState>
      <Note>
        Les salaires sont saisis par l’administrateur. Mode de calcul (mensuel, horaire ou forfait) : à confirmer avec le bureau.
      </Note>
    </>
  );
}
