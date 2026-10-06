import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, CardGrid, CardSubtitle, CardTitle } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill } from '../../components/ui/Pill';
import { ApiError, api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { Season } from '../../features/seasons/api';

function ActiveSeasonCard() {
  const { data, isPending, error } = useQuery({
    queryKey: ['seasons', 'active'],
    queryFn: () => api.get<Season>('/seasons/active'),
    retry: false,
  });

  const none = error instanceof ApiError && error.status === 404;

  return (
    <Card className="flex flex-col gap-3">
      <CardSubtitle>Saison active</CardSubtitle>
      {isPending && <p className="text-mut">Chargement…</p>}
      {data && (
        <>
          <p className="text-[28px] font-semibold leading-none">{data.label}</p>
          <div className="flex flex-wrap gap-2">
            <Pill tone="blue">Du {formatDate(data.startDate)}</Pill>
            <Pill tone="blue">Au {formatDate(data.endDate)}</Pill>
          </div>
        </>
      )}
      {none && (
        <>
          <p className="text-[28px] font-semibold leading-none">Aucune</p>
          <Link to="/admin/saisons" className="text-sm font-medium text-pri underline-offset-4 hover:underline">
            Activer une saison
          </Link>
        </>
      )}
      {error && !none && <p className="text-sm text-mut">{error.message}</p>}
    </Card>
  );
}

export function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Découvrez l’activité du club" />
      <CardGrid>
        <ActiveSeasonCard />
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <CardSubtitle>Statistiques</CardSubtitle>
            <Pill tone="sand" small>
              À venir
            </Pill>
          </div>
          <CardTitle>Joueurs, paiements, réservations</CardTitle>
          <p className="text-sm text-mut">Les indicateurs arriveront avec les modules correspondants.</p>
        </Card>
      </CardGrid>
    </>
  );
}
