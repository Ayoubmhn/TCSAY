import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/InstallmentCard';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills, type PillTone } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { api } from '../../lib/api';
import { fD } from '../../lib/format';

export type TechAlert = { playerId: string; name: string; group: string; kind: 'ABSENCES' | 'DROP' | 'EFFORT' | 'PAIN'; label: string; date: string };
type Overview = {
  month: string;
  groups: { id: string; name: string; players: number; average: number | null; previous: number | null; attendanceRate: number | null; objectives: string[] }[];
  alerts: TechAlert[];
};

const TONE: Record<TechAlert['kind'], PillTone> = { ABSENCES: 'r', PAIN: 'r', DROP: 's', EFFORT: 's' };
const nb = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

export function useTechOverview() {
  return useQuery({ queryKey: ['tech-overview'], queryFn: () => api.get<Overview>('/evaluations/overview') });
}

/** Liste des alertes (lien vers la fiche joueur pour la direction). */
export function AlertList({ alerts, linkPlayers }: { alerts: TechAlert[]; linkPlayers: boolean }) {
  if (!alerts.length) return <EmptyState>Aucune alerte. Tout va bien.</EmptyState>;
  return (
    <CardGrid list>
      {alerts.map((a) => (
        <Card key={a.playerId + a.kind}>
          <CardRow>
            <h3>{linkPlayers ? <Link to={`/admin/joueurs/${a.playerId}`} className="hover:underline">{a.name}</Link> : a.name}</h3>
          </CardRow>
          <Pills>
            <Pill tone={TONE[a.kind]}>{a.label}</Pill>
            <Pill tone="b">{a.group}</Pill>
            <Pill tone="b">{fD(a.date, { day: 'numeric', month: 'short' })}</Pill>
          </Pills>
        </Card>
      ))}
    </CardGrid>
  );
}

/** Suivi technique (direction technique) : progression par groupe et alertes sur les joueurs. */
export function TechOverviewPage() {
  const q = useTechOverview();
  const [view, setView] = useViewMode('suivi-technique');
  const d = q.data;
  return (
    <>
      <PageHeader
        title="Suivi technique"
        subtitle="Découvrez la progression des groupes et les joueurs à suivre."
        action={<ViewToggle value={view} onChange={setView} />}
      />
      <div className="mt-5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {d && (
            <>
              <Section title={`Alertes · ${d.alerts.length}`}>
                <AlertList alerts={d.alerts} linkPlayers />
              </Section>
              <Section title={`Groupes · ${fD(`${d.month}-01`, { month: 'long', year: 'numeric' })}`}>
                <CardGrid list={view === 'list'}>
                  {d.groups
                    .filter((g) => g.players > 0)
                    .sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.name.localeCompare(b.name, 'fr'))
                    .map((g) => {
                    const diff = g.average !== null && g.previous !== null ? Math.round((g.average - g.previous) * 10) / 10 : null;
                    return (
                      <Card key={g.id}>
                        <CardRow>
                          <h3>{g.name}</h3>
                          {g.average !== null ? <Pill tone="g">{nb(g.average)}/5</Pill> : <Pill tone="s">Pas de note ce mois</Pill>}
                        </CardRow>
                        <Pills>
                          <Pill tone="b">{g.players} joueur(s)</Pill>
                          {diff !== null && (
                            <Pill tone={diff >= 0 ? 'g' : 'r'}>
                              {diff >= 0 ? '+' : '−'}
                              {nb(Math.abs(diff))} vs mois précédent
                            </Pill>
                          )}
                          {g.attendanceRate !== null && <Pill tone="b">Assiduité {g.attendanceRate} % (30 j)</Pill>}
                        </Pills>
                        {g.average !== null && <ProgressBar value={g.average} max={5} />}
                        <CardText>{g.objectives.length ? `Objectifs travaillés : ${g.objectives.join(', ')}` : 'Aucun objectif saisi sur 30 jours.'}</CardText>
                      </Card>
                    );
                    })}
                </CardGrid>
              </Section>
            </>
          )}
        </QueryState>
      </div>
      <Note>
        Seuls les groupes avec des joueurs sont affichés. Alertes calculées sur les présences et les évaluations de séance : 3 absences de suite, notes en baisse (3 dernières
        séances contre les 5 précédentes), engagement noté 1 ou 2 deux fois de suite, douleur signalée sur 14 jours (parent et
        directeur technique déjà prévenus).
      </Note>
    </>
  );
}
