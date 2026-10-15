import { useQuery } from '@tanstack/react-query';
import { EstimateCard, SalaryCard } from '../../../components/parts';
import { EmptyState, Note, PageHeader, Pill, Pills, QueryState, Screen, Section } from '../../../components/ui';
import { api } from '../../../lib/api';
import { DT } from '../../../lib/format';
import type { Estimate, Salary } from '../../../lib/types';

type Mine = { paid: Salary[]; pending: Salary[]; upcoming: Estimate[] };

/** Mes salaires (vCSal) : à venir (estimation), à verser, puis historique des salaires versés. */
export default function CoachSalariesScreen() {
  const q = useQuery({ queryKey: ['salaries', 'mine'], queryFn: () => api.get<Mine>('/salaries/mine') });
  const d = q.data;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <PageHeader title="Mes salaires" subtitle="Découvrez vos salaires à venir et ceux qui vous ont été versés." />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {d && (
          <>
            <Pills>
              <Pill tone="g">Total versé {DT(d.paid.reduce((s, x) => s + x.amount, 0))}</Pill>
              {d.pending.length > 0 ? <Pill tone="r">À verser {DT(d.pending.reduce((s, x) => s + x.amount, 0))}</Pill> : null}
            </Pills>
            <Section title="À venir">
              {d.upcoming.length || d.pending.length ? (
                <>
                  {d.pending.map((s) => (
                    <SalaryCard key={s.id} salary={s} />
                  ))}
                  {d.upcoming.map((e) => (
                    <EstimateCard key={e.month} estimate={e} />
                  ))}
                </>
              ) : (
                <EmptyState>Aucun salaire à venir.</EmptyState>
              )}
            </Section>
            <Section title="Historique">
              {d.paid.length ? d.paid.map((s) => <SalaryCard key={s.id} salary={s} />) : <EmptyState>Aucun salaire versé pour le moment.</EmptyState>}
            </Section>
          </>
        )}
      </QueryState>
      <Note>Les estimations tiennent compte des séances prévues et des absences validées. Le montant définitif est saisi par l’administrateur.</Note>
    </Screen>
  );
}
