import { useQuery } from '@tanstack/react-query';
import { EstimateCard, SalaryCard } from '../../components/SalaryParts';
import { CardGrid, EmptyState } from '../../components/ui/Card';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { DT } from '../../lib/format';
import type { Estimate, Salary } from '../../lib/types';

type Mine = { paid: Salary[]; pending: Salary[]; upcoming: Estimate[] };

/** Mes salaires (vCSal) : salaires à venir (estimation), à verser, puis historique des salaires versés. */
export function CoachSalariesPage() {
  const q = useQuery({ queryKey: ['salaries', 'mine'], queryFn: () => api.get<Mine>('/salaries/mine') });
  const d = q.data;

  return (
    <>
      <PageHeader title="Mes salaires" subtitle="Découvrez vos salaires à venir et ceux qui vous ont été versés." />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {d && (
          <>
            <Pills className="my-[18px]">
              <Pill tone="g">Total versé {DT(d.paid.reduce((s, x) => s + x.amount, 0))}</Pill>
              {d.pending.length > 0 && <Pill tone="r">À verser {DT(d.pending.reduce((s, x) => s + x.amount, 0))}</Pill>}
            </Pills>
            <Section title="À venir">
              {d.upcoming.length || d.pending.length ? (
                <CardGrid>
                  {d.pending.map((s) => (
                    <SalaryCard key={s.id} salary={s} />
                  ))}
                  {d.upcoming.map((e) => (
                    <EstimateCard key={e.month} estimate={e} />
                  ))}
                </CardGrid>
              ) : (
                <EmptyState>Aucun salaire à venir.</EmptyState>
              )}
            </Section>
            <Section title="Historique">
              {d.paid.length ? (
                <CardGrid>
                  {d.paid.map((s) => (
                    <SalaryCard key={s.id} salary={s} />
                  ))}
                </CardGrid>
              ) : (
                <EmptyState>Aucun salaire versé pour le moment.</EmptyState>
              )}
            </Section>
          </>
        )}
      </QueryState>
      <Note>
        Les estimations tiennent compte des séances prévues et des absences validées par l’administration. Le montant définitif
        est saisi par l’administrateur.
      </Note>
    </>
  );
}
