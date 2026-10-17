import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { KidSelect } from '../../components/KidSelect';
import { InstallmentCard } from '../../components/parts';
import { EmptyState, Note, PageHeader, Pill, Pills, QueryState, Screen, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { DT } from '../../lib/format';
import type { Installment, SeasonLite } from '../../lib/types';

/** Mes paiements (vPay) : cotisation d'une saison, tranche par tranche. */
export default function PaymentsScreen() {
  const { playerId } = useAuth();
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
    <Screen refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
      <PageHeader title="Mes paiements" subtitle="Découvrez vos cotisations et l’état de chaque tranche." />
      <KidSelect />
      {visible.length > 0 && (
        <Select label="Choisir la saison" value={seasonId} onChange={setSeasonId} options={visible.map((s) => ({ value: s.id, label: `Saison ${s.label}` }))} />
      )}
      <QueryState isPending={(list.isPending && Boolean(seasonId)) || seasons.isPending} error={list.error ?? seasons.error} refetch={list.refetch}>
        {rows.length ? (
          <>
            <Pills>
              <Pill tone="b">Total {DT(total)}</Pill>
              <Pill tone="g">Payé {DT(paid)}</Pill>
              <Pill tone={total - paid ? 'r' : 'g'}>Restant {DT(total - paid)}</Pill>
            </Pills>
            {rows.map((i) => (
              <InstallmentCard key={i.id} i={i} />
            ))}
          </>
        ) : (
          <EmptyState>Aucune cotisation pour cette saison.</EmptyState>
        )}
      </QueryState>
      <Note>
        Le paiement en espèces ou par chèque se fait au club : l’administrateur l’enregistre et vous remet le reçu numéroté. Paiement en ligne au sprint 6
        (passerelle à choisir : Konnect, ClicToPay ou Paymee).
      </Note>
    </Screen>
  );
}
