import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth, useMe } from '../auth/AuthContext';
import { api } from '../lib/api';
import { DT, fD } from '../lib/format';
import { KidSelect } from './KidSelect';
import { Card } from './ui/Card';
import { Filters } from './ui/Field';
import { PageHeader } from './ui/PageHeader';

export type AccessModule = 'sessions' | 'progress' | 'exercises' | 'reservation';

type AccessStatus = {
  enabled: boolean;
  locked: Record<AccessModule, boolean>;
  overdue: { number: number; count: number; dueDate: string; remaining: number } | null;
  exempt: string | null;
};

/**
 * Accès après paiement (joueur, parent) : si la tranche échue n'est pas payée et que le club a fermé ce module,
 * affiche un écran « Disponible après le paiement » (avec le choix de l'enfant) au lieu du contenu. L'API refuse aussi.
 */
export function PaymentGate({ module, title, children }: { module: AccessModule; title: string; children: ReactNode }) {
  const me = useMe();
  const { playerId } = useAuth();
  const family = me.role === 'PLAYER' || me.role === 'PARENT';
  const q = useQuery({
    queryKey: ['access-status', playerId],
    queryFn: () => api.get<AccessStatus>('/access/payment/status', { playerId }),
    enabled: family && Boolean(playerId),
    staleTime: 60_000,
  });
  if (!family || !q.data?.locked[module] || !q.data.overdue) return <>{children}</>;
  const o = q.data.overdue;
  return (
    <>
      <PageHeader title={title} subtitle="Disponible après le paiement de la tranche en retard." />
      <Filters>
        <KidSelect />
      </Filters>
      <Card className="mx-auto mt-6 max-w-[520px] items-center text-center">
        <span className="text-[34px]" aria-hidden="true">
          🔒
        </span>
        <h3>Disponible après le paiement</h3>
        <span className="text-[14px] text-mut">
          La tranche {o.number}/{o.count} (échéance {fD(o.dueDate, { day: 'numeric', month: 'long' })}) reste à régler : {DT(o.remaining)}.
          <br />
          Paiement au club, en espèces ou par chèque.
        </span>
        <Link to="/paiements" className="mt-2 inline-flex items-center justify-center rounded-full bg-pri px-5 py-[11px] font-semibold text-white">
          Voir mes paiements
        </Link>
      </Card>
    </>
  );
}
