import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { KidSelect } from '../../components/KidSelect';
import { Button } from '../../components/ui/Button';
import { CardGrid, EmptyState } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { InstallmentCard } from '../../components/ui/InstallmentCard';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { DT } from '../../lib/format';
import type { Installment, SeasonLite } from '../../lib/types';

/** Mes paiements (vPay) : cotisation d'une saison, tranche par tranche. */
export function PaymentsPage() {
  const { playerId } = useAuth();
  const toast = useToast();
  const seasons = useQuery({ queryKey: ['seasons', 'list'], queryFn: () => api.get<SeasonLite[]>('/seasons') });
  const visible = (seasons.data ?? []).filter((s) => s.status !== 'DRAFT');
  const [seasonId, setSeasonId] = useState<string>();
  useEffect(() => {
    if (!seasonId && visible.length) setSeasonId((visible.find((s) => s.status === 'ACTIVE') ?? visible[0]).id);
  }, [seasonId, visible]);

  const list = useQuery({
    queryKey: ['installments', 'mine', playerId, seasonId],
    queryFn: () => api.get<Installment[]>('/installments', { playerId, seasonId }),
    enabled: Boolean(playerId && seasonId),
  });
  const rows = [...(list.data ?? [])].sort((a, b) => a.number - b.number);
  const total = rows.reduce((s, i) => s + i.amount, 0);
  const paid = rows.reduce((s, i) => s + i.paid, 0);

  return (
    <>
      <PageHeader title="Mes paiements" subtitle="Découvrez vos cotisations et l’état de chaque tranche." />
      <Filters>
        <KidSelect />
        <FilterSelect label="Choisir la saison" value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
          {visible.map((s) => (
            <option key={s.id} value={s.id}>
              Saison {s.label}
            </option>
          ))}
        </FilterSelect>
      </Filters>

      <QueryState isPending={list.isPending && Boolean(seasonId)} error={list.error} refetch={list.refetch}>
        {rows.length ? (
          <>
            <Pills className="mt-2.5 mb-4">
              <Pill tone="b">Total {DT(total)}</Pill>
              <Pill tone="g">Payé {DT(paid)}</Pill>
              <Pill tone={total - paid ? 'r' : 'g'}>Restant {DT(total - paid)}</Pill>
            </Pills>
            <CardGrid>
              {rows.map((i) => (
                <InstallmentCard
                  key={i.id}
                  installment={i}
                  title={`Tranche ${i.number}/${i.count}`}
                  action={
                    i.remaining ? (
                      <Button
                        variant="primary"
                        onClick={() => toast('Paiement en ligne : passerelle à choisir (Konnect, ClicToPay ou Paymee). Prévu au sprint 6.')}
                      >
                        Payer en ligne
                      </Button>
                    ) : (
                      <Button onClick={() => toast('Reçu PDF : prévu au sprint 6.')}>Reçu PDF</Button>
                    )
                  }
                />
              ))}
            </CardGrid>
          </>
        ) : (
          <div className="mt-2.5">
            <EmptyState>Aucune cotisation pour cette saison.</EmptyState>
          </div>
        )}
      </QueryState>
      <Note>
        Le paiement en espèces se fait au club : l’administrateur l’enregistre. Paiement en ligne et reçus PDF arrivent au
        sprint 6 (passerelle à choisir : Konnect, ClicToPay ou Paymee).
      </Note>
    </>
  );
}
