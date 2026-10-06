import { Link } from 'react-router';
import { Card, CardGrid, CardSubtitle, CardText, EmptyState, Kpi } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { Badge, Pill } from '../../components/ui/Pill';
import { ApiError } from '../../lib/api';
import { useActiveSeason } from '../../features/seasons/api';

/** KPI du prototype (vDash) ; les valeurs arrivent avec leurs modules. */
const KPIS = [
  { title: 'Joueurs actifs', hint: 'Module Joueurs' },
  { title: 'Encaissé cette saison', hint: 'Module Paiements' },
  { title: 'Tranches en retard', hint: 'Module Paiements' },
  { title: 'Réservations demain', hint: 'Module Réservations' },
];

export function DashboardPage() {
  const { data: season, isPending, error } = useActiveSeason();
  const noActive = error instanceof ApiError && error.status === 404;

  const subtitle = season
    ? `Vue d’ensemble de la saison ${season.label}.`
    : isPending
      ? 'Chargement…'
      : 'Aucune saison active pour le moment.';

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={subtitle}
        action={
          season ? (
            <Pill tone="g">Saison active {season.label}</Pill>
          ) : noActive ? (
            <Link to="/admin/saisons" className="rounded-full">
              <Pill tone="s">Aucune saison active</Pill>
            </Link>
          ) : undefined
        }
      />

      {error && !noActive && (
        <div className="mt-5">
          <EmptyState>{error.message}</EmptyState>
        </div>
      )}

      <CardGrid className="mt-5">
        {KPIS.map((k) => (
          <Card key={k.title}>
            <CardSubtitle>{k.title}</CardSubtitle>
            <Kpi>—</Kpi>
            <div className="flex items-center gap-2">
              <Badge>À venir</Badge>
              <CardText>{k.hint}</CardText>
            </div>
          </Card>
        ))}
      </CardGrid>
    </>
  );
}
