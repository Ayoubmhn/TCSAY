import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Card, CardGrid, CardRow, CardSubtitle, CardText, EmptyState, Kpi } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/InstallmentCard';
import { QueryState } from '../../components/ui/Loading';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { DT, formatDate } from '../../lib/format';
import { STATUS, type SeasonStatus } from './api';

type SeasonStats = {
  season: {
    id: string;
    label: string;
    status: SeasonStatus;
    startDate: string;
    endDate: string;
    leisureStartDate: string | null;
    leisureEndDate: string | null;
  };
  players: { total: number; boys: number; girls: number; leisure: number; byCategory: { name: string; count: number }[] };
  groups: { id: string; name: string; kind: 'LEISURE' | 'COMPETITIVE'; category: string | null; members: number; capacity: number; slots: number; archived: boolean }[];
  finances: { due: number; cashed: number; remaining: number; rate: number | null; salariesPaid: number; salariesDue: number };
  attendance: { present: number; late: number; absent: number; rate: number | null };
  reservations: number;
  coachAbsences: Partial<Record<'REPLACED' | 'PHYSICAL' | 'CANCELLED', number>>;
};

/** Historique et statistiques d'une saison (passée, en cours ou à venir). */
export function SeasonDetailPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['season-stats', id], queryFn: () => api.get<SeasonStats>(`/stats/seasons/${id}`) });
  const d = q.data;
  const max = Math.max(1, ...(d?.players.byCategory.map((c) => c.count) ?? [1]));

  return (
    <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
      {d && (
        <>
          <Link to="/admin/saisons" className="text-sm font-medium text-mut hover:underline">
            ‹ Saisons
          </Link>
          <div className="mt-3">
            <PageHeader
              title={`Saison ${d.season.label}`}
              subtitle="Découvrez l’historique et les statistiques de la saison."
              action={<Pill tone={STATUS[d.season.status].tone}>{STATUS[d.season.status].label}</Pill>}
            />
          </div>
          <Pills className="mt-3">
            <Pill tone="b">
              Compétitif {formatDate(d.season.startDate)} → {formatDate(d.season.endDate)}
            </Pill>
            {d.season.leisureStartDate && d.season.leisureEndDate && (
              <Pill tone="s">
                Loisirs {formatDate(d.season.leisureStartDate)} → {formatDate(d.season.leisureEndDate)}
              </Pill>
            )}
          </Pills>

          <Section title="En bref">
            <CardGrid>
              <Card>
                <CardSubtitle>Joueurs inscrits</CardSubtitle>
                <Kpi>{d.players.total}</Kpi>
                <CardText>
                  {d.players.boys} garçons · {d.players.girls} filles · {d.players.leisure} en loisirs
                </CardText>
              </Card>
              <Card>
                <CardSubtitle>Cotisations encaissées</CardSubtitle>
                <Kpi>{DT(d.finances.cashed)}</Kpi>
                <CardText>
                  sur {DT(d.finances.due)} dus{d.finances.rate !== null ? ` · ${d.finances.rate} %` : ''}
                </CardText>
                {d.finances.due > 0 && <ProgressBar value={d.finances.cashed} max={d.finances.due} />}
              </Card>
              <Card>
                <CardSubtitle>Présence aux séances</CardSubtitle>
                <Kpi>{d.attendance.rate !== null ? `${d.attendance.rate} %` : '—'}</Kpi>
                <Pills>
                  <Pill tone="g">{d.attendance.present} présents</Pill>
                  <Pill tone="b">{d.attendance.late} retards</Pill>
                  <Pill tone="r">{d.attendance.absent} absences</Pill>
                </Pills>
              </Card>
              <Card>
                <CardSubtitle>Salaires</CardSubtitle>
                <Kpi>{DT(d.finances.salariesPaid)}</Kpi>
                <CardText>versés · {DT(d.finances.salariesDue)} à verser</CardText>
              </Card>
              <Card>
                <CardSubtitle>Terrains et entraîneurs</CardSubtitle>
                <Kpi>{d.reservations}</Kpi>
                <CardText>réservations</CardText>
                <Pills>
                  <Pill tone="s">{d.coachAbsences.REPLACED ?? 0} remplacements</Pill>
                  <Pill tone="s">{d.coachAbsences.PHYSICAL ?? 0} séances physiques</Pill>
                  <Pill tone="r">{d.coachAbsences.CANCELLED ?? 0} annulées</Pill>
                </Pills>
              </Card>
            </CardGrid>
          </Section>

          <Section title="Joueurs par catégorie">
            {d.players.byCategory.length ? (
              <Card>
                <div className="flex flex-col gap-2.5">
                  {d.players.byCategory.map((c) => (
                    <div key={c.name} className="grid grid-cols-[minmax(120px,200px)_1fr_auto] items-center gap-3 text-sm">
                      <span className="truncate">{c.name}</span>
                      <ProgressBar value={c.count} max={max} />
                      <b className="font-semibold tabular-nums">{c.count}</b>
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <EmptyState>Aucun joueur inscrit sur cette saison.</EmptyState>
            )}
          </Section>

          <Section title="Groupes">
            {d.groups.length ? (
              <CardGrid>
                {d.groups.map((g) => (
                  <Card key={g.id}>
                    <CardRow>
                      <h3>{g.name}</h3>
                      <Pill tone={g.members >= g.capacity ? 'r' : 'g'}>
                        {g.members}/{g.capacity}
                      </Pill>
                    </CardRow>
                    <Pills>
                      <Pill tone="s">{g.kind === 'LEISURE' ? 'Loisirs' : 'Compétitif'}</Pill>
                      {g.category && <Pill tone="s">{g.category}</Pill>}
                      <Pill tone="b">{g.slots} séance(s) / semaine</Pill>
                      {g.archived && <Pill tone="s">Archivé</Pill>}
                    </Pills>
                    <ProgressBar value={g.members} max={g.capacity} />
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucun groupe sur cette saison.</EmptyState>
            )}
          </Section>
        </>
      )}
    </QueryState>
  );
}
