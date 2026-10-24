import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth, useMe } from '../../auth/AuthContext';
import { KidSelect } from '../../components/KidSelect';
import { BigAvatar } from '../../components/ui/Avatar';
import { Card, CardActions, CardGrid, CardRow, CardSubtitle, CardText, EmptyState, Kpi } from '../../components/ui/Card';
import { Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { DT, fD } from '../../lib/format';
import type { Overview } from '../../lib/types';
import { EventCard } from '../../features/events/EventCard';
import type { EventSummary } from '../../features/events/types';
import { STATUS, type TournamentSummary } from '../../features/tournaments/types';

const LINK_BTN = 'inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg';

/** Accueil joueur / parent (vHome). */
export function HomePage() {
  const me = useMe();
  const { playerId } = useAuth();
  const isParent = me.role === 'PARENT';
  const overview = useQuery({
    queryKey: ['overview', playerId],
    queryFn: () => api.get<Overview>('/me/overview', { playerId }),
    enabled: Boolean(playerId),
  });
  const events = useQuery({ queryKey: ['events'], queryFn: () => api.get<EventSummary[]>('/events') });
  const tournaments = useQuery({
    queryKey: ['tournaments'],
    queryFn: () => api.get<{ canManage: boolean; tournaments: TournamentSummary[] }>('/tournaments'),
  });
  const today = new Date().toISOString().slice(0, 10);
  // Tournois à venir ou en cours : inscriptions ouvertes en premier.
  const upcoming = (tournaments.data?.tournaments ?? [])
    .filter((t) => (t.status === 'REGISTRATION' || t.status === 'RUNNING') && t.endDate >= today)
    .sort((a, b) => (a.status === b.status ? a.startDate.localeCompare(b.startDate) : a.status === 'REGISTRATION' ? -1 : 1));
  const o = overview.data;

  return (
    <>
      <div className="flex items-center gap-4">
        <BigAvatar first={me.firstName} last={me.lastName} photo={me.photoUrl} />
        <div>
          <h1>Bienvenue {me.firstName} 👋</h1>
          <p className="mt-1 text-mut">
            {o ? `Saison ${o.season.label} · ` : ''}
            {isParent ? `Suivi de ${me.players.length} joueur${me.players.length > 1 ? 's' : ''}` : (o?.category ?? '')}
          </p>
        </div>
      </div>
      {isParent && (
        <Filters>
          <KidSelect />
        </Filters>
      )}

      {!playerId ? (
        <div className="mt-6">
          <EmptyState>Aucun joueur n’est lié à ce compte. Contactez le club.</EmptyState>
        </div>
      ) : (
        <QueryState isPending={overview.isPending} error={overview.error} refetch={overview.refetch}>
          {o && (
            <>
              {/* Grande carte d'accueil : seul dégradé autorisé */}
              <div className="relative mt-6 flex min-h-[200px] flex-col gap-3 rounded-[36px] bg-[linear-gradient(150deg,#14532d_0%,#2f7a4d_60%,#c2410c_100%)] px-7 pt-7 pb-[34px] text-white">
                <span className="text-xs font-semibold tracking-[0.12em] opacity-85">
                  PROCHAINE SÉANCE{isParent ? ` · ${o.player.firstName.toUpperCase()}` : ''}
                </span>
                {o.nextSession ? (
                  <>
                    <h2 className="text-2xl font-semibold">{o.nextSession.groupName}</h2>
                    <Pills>
                      <Pill tone="b">{fD(o.nextSession.date, { weekday: 'long', day: 'numeric', month: 'long' })}</Pill>
                      <Pill tone="b">
                        {o.nextSession.startTime} – {o.nextSession.endTime}
                      </Pill>
                      {o.nextSession.court && <Pill tone="g">{o.nextSession.court}</Pill>}
                      {o.nextSession.kind === 'PHYSICAL' && <Pill tone="s">Séance physique</Pill>}
                      {o.nextSession.holiday && <Pill tone="s">{o.nextSession.holiday}</Pill>}
                    </Pills>
                    {o.nextSession.coaches.length > 0 && (
                      <div className="text-sm opacity-90">
                        {o.nextSession.coaches.length > 1 ? 'Coachs' : 'Coach'} {o.nextSession.coaches.map((c) => `${c.firstName} ${c.lastName}`.trim()).join(', ')}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <h2 className="text-2xl font-semibold">{o.sessionsLocked ? '🔒 Planning disponible après le paiement' : 'Aucune séance prévue'}</h2>
                    <div className="opacity-90">
                      {o.sessionsLocked
                        ? 'La tranche en retard est à régler au club (voir Mes paiements).'
                        : o.hasGroup
                        ? 'Aucune séance dans les 14 prochains jours.'
                        : `${o.player.firstName} n’est inscrit dans aucun groupe.`}
                    </div>
                  </>
                )}
                <div className="absolute -end-1.5 -bottom-1.5 grid h-[78px] w-[78px] place-items-center rounded-full bg-bg">
                  <Link
                    to="/seances"
                    aria-label="Voir mes séances"
                    className="grid h-[58px] w-[58px] place-items-center rounded-full bg-sel text-[22px] text-white"
                  >
                    →
                  </Link>
                </div>
              </div>

              <Section title="En bref">
                <CardGrid>
                  <Card>
                    <CardSubtitle>Paiements</CardSubtitle>
                    {o.dueCount ? (
                      <>
                        <Pills>
                          <Pill tone="r">
                            {o.dueCount} tranche{o.dueCount > 1 ? 's' : ''} à payer
                          </Pill>
                        </Pills>
                        <Kpi>{DT(o.dueAmount)}</Kpi>
                        <CardText>Restant sur la saison</CardText>
                      </>
                    ) : (
                      <>
                        <Pills>
                          <Pill tone="g">À jour</Pill>
                        </Pills>
                        <span className="text-mut">Toutes les tranches sont payées.</span>
                      </>
                    )}
                    <CardActions>
                      <Link className={LINK_BTN} to="/paiements">
                        Mes paiements
                      </Link>
                    </CardActions>
                  </Card>
                  <Card>
                    <CardSubtitle>Mes réservations</CardSubtitle>
                    <Kpi>{o.upcomingReservations}</Kpi>
                    <CardText>créneaux à venir</CardText>
                    <CardActions>
                      <Link className={LINK_BTN} to="/reserver">
                        Réserver un terrain
                      </Link>
                    </CardActions>
                  </Card>
                  <Card>
                    <CardSubtitle>Absences cette saison</CardSubtitle>
                    <Kpi>{o.absences}</Kpi>
                    <CardText>séances manquées</CardText>
                    <CardActions>
                      <Link className={LINK_BTN} to="/absences">
                        Voir le détail
                      </Link>
                    </CardActions>
                  </Card>
                </CardGrid>
              </Section>
            </>
          )}
        </QueryState>
      )}

      {upcoming.length > 0 && (
        <Section title="Tournois">
          <CardGrid>
            {upcoming.map((t) => (
              <Card key={t.id}>
                <CardRow>
                  <h3>
                    <Link to={`/tournois/${t.id}`} className="hover:underline">
                      🏆 {t.name}
                    </Link>
                  </h3>
                  <Pill tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Pill>
                </CardRow>
                <Pills>
                  <Pill tone="b">
                    {t.startDate === t.endDate
                      ? fD(t.startDate, { weekday: 'long', day: 'numeric', month: 'long' })
                      : `${fD(t.startDate, { day: 'numeric', month: 'short' })} – ${fD(t.endDate, { day: 'numeric', month: 'short' })}`}
                  </Pill>
                  <Pill tone="s">{t.eligibilityLabel}</Pill>
                  {t.fee !== null && <Pill tone="s">Inscription {DT(t.fee)}</Pill>}
                </Pills>
                <CardActions>
                  <Link to={`/tournois/${t.id}`} className={LINK_BTN}>
                    {t.status === 'REGISTRATION' ? (t.familyRequest ? 'S’inscrire' : 'Voir le tournoi') : 'Tableau et horaires'}
                  </Link>
                </CardActions>
              </Card>
            ))}
          </CardGrid>
        </Section>
      )}

      <Section title="Événements">
        {events.data && events.data.length > 0 && (
          <Link to="/evenements" className="-mt-2 text-sm font-medium text-mut hover:underline">
            Tous les événements ›
          </Link>
        )}
        {events.data && events.data.length > 0 ? (
          <CardGrid>
            {events.data.slice(0, 6).map((e) => (
              <EventCard key={e.id} e={e} />
            ))}
          </CardGrid>
        ) : (
          <EmptyState>Aucun événement pour le moment.</EmptyState>
        )}
      </Section>
    </>
  );
}
