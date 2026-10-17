import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth, useMe } from '../../auth/AuthContext';
import { KidSelect } from '../../components/KidSelect';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, EmptyState, Kpi, CardSubtitle } from '../../components/ui/Card';
import { Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { api } from '../../lib/api';
import { fD } from '../../lib/format';
import { TournamentForm } from './TournamentForm';
import { STATUS, type History, type TournamentSummary } from './types';

const period = (t: { startDate: string; endDate: string }) =>
  t.startDate === t.endDate ? fD(t.startDate, { weekday: 'short', day: 'numeric', month: 'short' }) : `${fD(t.startDate, { day: 'numeric', month: 'short' })} – ${fD(t.endDate, { day: 'numeric', month: 'short' })}`;

/** Historique des tournois du joueur (ou de l'enfant choisi par le parent) : résultats, palmarès, matchs. */
function PlayerHistory() {
  const me = useMe();
  const { playerId } = useAuth();
  const pid = me.role === 'PARENT' ? playerId : undefined;
  const q = useQuery({ queryKey: ['tournament-history', pid ?? 'me'], queryFn: () => api.get<History>('/tournaments/history', { playerId: pid }), enabled: me.role !== 'PARENT' || Boolean(pid) });
  const [open, setOpen] = useState<string>();
  const d = q.data;
  return (
    <Section title="Historique des tournois">
      <Filters>
        <KidSelect />
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {d && (
          <>
            <CardGrid className="mt-3">
              <Card>
                <CardSubtitle>Tournois joués</CardSubtitle>
                <Kpi>{d.totals.played}</Kpi>
              </Card>
              <Card>
                <CardSubtitle>Victoires / défaites</CardSubtitle>
                <Kpi>
                  {d.totals.wins} / {d.totals.losses}
                </Kpi>
              </Card>
              <Card>
                <CardSubtitle>Palmarès</CardSubtitle>
                <Kpi>🏆 {d.totals.titles}</Kpi>
                <Pills>{d.totals.finals > 0 && <Pill tone="s">{d.totals.finals} finale(s)</Pill>}</Pills>
              </Card>
            </CardGrid>
            {d.tournaments.length ? (
              <CardGrid list className="mt-3">
                {d.tournaments.map((t) => (
                  <Card key={t.tournamentId}>
                    <CardRow>
                      <h3>
                        <Link to={`/tournois/${t.tournamentId}`} className="hover:underline">
                          {t.name}
                        </Link>
                      </h3>
                    </CardRow>
                    <Pills>
                      <Pill tone={t.result === 'Vainqueur' ? 'g' : t.result === 'En cours' ? 'r' : 's'}>{t.result}</Pill>
                      <Pill tone="b">{fD(t.date, { day: 'numeric', month: 'short', year: 'numeric' })}</Pill>
                      <Pill tone="s">
                        {t.wins} V · {t.losses} D
                      </Pill>
                    </Pills>
                    <CardActions>
                      <ActionIcon kind="view" label="Voir les matchs" onClick={() => setOpen(open === t.tournamentId ? undefined : t.tournamentId)} />
                    </CardActions>
                    {open === t.tournamentId && (
                      <div className="flex w-full flex-col gap-1.5">
                        {t.matches.map((m) => (
                          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[16px] bg-fld px-4 py-2 text-sm">
                            <span>
                              {m.round} · contre {m.opponent}
                            </span>
                            <Pills>
                              {m.score && <Pill tone="b">{m.score}</Pill>}
                              {m.won === null ? <Pill tone="s">À jouer</Pill> : <Pill tone={m.won ? 'g' : 'r'}>{m.won ? 'Gagné' : 'Perdu'}</Pill>}
                            </Pills>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <div className="mt-3">
                <EmptyState>Aucun tournoi joué pour l’instant.</EmptyState>
              </div>
            )}
          </>
        )}
      </QueryState>
    </Section>
  );
}

/** Tournois du club : liste (en cours, inscriptions, terminés), création par la direction technique, historique du joueur. */
export function TournamentsPage() {
  const me = useMe();
  const [view, setView] = useViewMode('tournois');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['tournaments'], queryFn: () => api.get<{ canManage: boolean; tournaments: TournamentSummary[] }>('/tournaments') });
  const family = me.role === 'PARENT' || me.role === 'PLAYER';
  const list = q.data?.tournaments ?? [];

  return (
    <>
      <PageHeader
        title="Tournois"
        subtitle="Découvrez les tournois du club, leurs tableaux et leurs résultats."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            {q.data?.canManage && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                + Nouveau tournoi
              </Button>
            )}
          </div>
        }
      />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {list.length ? (
          <CardGrid list={view === 'list'} className="mt-4">
            {list.map((t) => (
              <Card key={t.id}>
                <CardRow>
                  <h3>
                    <Link to={`/tournois/${t.id}`} className="hover:underline">
                      {t.name}
                    </Link>
                  </h3>
                  <Pill tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Pill>
                </CardRow>
                <Pills>
                  <Pill tone="b">{period(t)}</Pill>
                  <Pill tone="s">{t.eligibilityLabel}</Pill>
                  <Pill tone="b" className="card-text">
                    {t.entries}/{t.maxPlayers} inscrits
                  </Pill>
                  {t.winnerName && <Pill tone="g">🏆 {t.winnerName}</Pill>}
                </Pills>
                <CardActions>
                  <ActionIcon kind="open" primary to={`/tournois/${t.id}`} label="Ouvrir le tournoi" />
                </CardActions>
              </Card>
            ))}
          </CardGrid>
        ) : (
          <div className="mt-4">
            <EmptyState>Aucun tournoi pour le moment.</EmptyState>
          </div>
        )}
      </QueryState>
      {family && <PlayerHistory />}
      <Note>
        Tournois créés par la direction technique : catégories, années de naissance ou ouverts à tous. Chaque rencontre est un match
        du module Matchs (score en direct, statistiques) ; le tableau avance tout seul à la fin de chaque match.
      </Note>
      <TournamentForm open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
