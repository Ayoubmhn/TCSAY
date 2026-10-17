import { useQuery } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useAuth, useMe } from '../../auth/AuthContext';
import { KidSelect } from '../../components/KidSelect';
import { Avatar, Button, Card, CardRow, CardSubtitle, CardTitle, EmptyState, Kpi, Pill, Pills, QueryState, Screen, Section, T } from '../../components/ui';
import { api } from '../../lib/api';
import { DT, fDLong, fullName, initials } from '../../lib/format';
import { homeOf } from '../../lib/nav';
import { useTheme } from '../../lib/theme';
import type { EventItem, Overview } from '../../lib/types';

/** Accueil joueur / parent (vHome) : prochaine séance, paiements, réservations, absences, événements. */
export default function HomeScreen() {
  const me = useMe();
  const { t } = useTheme();
  const { playerId } = useAuth();
  const isFamily = me.space === 'parent' || me.space === 'player';
  const overview = useQuery({
    queryKey: ['overview', playerId],
    queryFn: () => api.get<Overview>('/me/overview', { playerId }),
    enabled: isFamily && Boolean(playerId),
  });
  const events = useQuery({ queryKey: ['events'], queryFn: () => api.get<EventItem[]>('/events'), enabled: isFamily });
  if (!isFamily) return <Redirect href={homeOf(me)} />;
  const o = overview.data;
  const isParent = me.role === 'PARENT';

  return (
    <Screen
      refreshing={overview.isRefetching}
      onRefresh={() => {
        void overview.refetch();
        void events.refetch();
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar big text={initials(me.firstName, me.lastName)} />
        <View style={{ flex: 1 }}>
          <T w="semibold" size={23}>
            Bienvenue {me.firstName} 👋
          </T>
          <T mut>
            {o ? `Saison ${o.season.label} · ` : ''}
            {isParent ? `Suivi de ${me.players.length} joueur${me.players.length > 1 ? 's' : ''}` : (o?.category ?? '')}
          </T>
        </View>
      </View>
      <KidSelect />

      {!playerId ? (
        <EmptyState>Aucun joueur n’est lié à ce compte. Contactez le club.</EmptyState>
      ) : (
        <QueryState isPending={overview.isPending} error={overview.error} refetch={overview.refetch}>
          {o && (
            <>
              {/* Grande carte d'accueil : couleurs du dégradé #14532d → #2f7a4d → #c2410c (aplats, sans bibliothèque de dégradé). */}
              <View style={{ borderRadius: 36, overflow: 'hidden', backgroundColor: '#14532d' }}>
                <View style={{ position: 'absolute', right: -60, top: 40, width: 260, height: 260, borderRadius: 130, backgroundColor: '#2f7a4d' }} />
                <View style={{ position: 'absolute', right: -80, bottom: -110, width: 220, height: 220, borderRadius: 110, backgroundColor: '#c2410c' }} />
                <View style={{ padding: 26, paddingBottom: 34, gap: 12, minHeight: 200 }}>
                  <T w="semibold" size={12} color="#fff" style={{ letterSpacing: 1.4, opacity: 0.85 }}>
                    PROCHAINE SÉANCE{isParent ? ` · ${o.player.firstName.toUpperCase()}` : ''}
                  </T>
                  {o.nextSession ? (
                    <>
                      <T w="semibold" size={23} color="#fff">
                        {o.nextSession.groupName}
                      </T>
                      <Pills>
                        <Pill tone="b">{fDLong(o.nextSession.date)}</Pill>
                        <Pill tone="b">{`${o.nextSession.startTime} – ${o.nextSession.endTime}`}</Pill>
                        {o.nextSession.court ? <Pill tone="g">{o.nextSession.court}</Pill> : null}
                      </Pills>
                      {o.nextSession.coaches.length > 0 && (
                        <T color="#fff" size={14} style={{ opacity: 0.9 }}>
                          {`${o.nextSession.coaches.length > 1 ? 'Coachs' : 'Coach'} ${o.nextSession.coaches.map(fullName).join(', ')}`}
                        </T>
                      )}
                    </>
                  ) : (
                    <>
                      <T w="semibold" size={21} color="#fff">
                        {o.sessionsLocked ? '🔒 Planning disponible après le paiement' : 'Aucune séance prévue'}
                      </T>
                      <T color="#fff" style={{ opacity: 0.9 }}>
                        {o.sessionsLocked
                          ? 'La tranche en retard est à régler au club (voir Mes paiements).'
                          : o.hasGroup
                            ? 'Aucune séance dans les 14 prochains jours.'
                            : `${o.player.firstName} n’est inscrit dans aucun groupe.`}
                      </T>
                    </>
                  )}
                </View>
                <View style={{ position: 'absolute', right: -6, bottom: -6, width: 78, height: 78, borderRadius: 39, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Voir mes séances"
                    onPress={() => router.push('/seances')}
                    style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: t.sel, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <T color="#fff" size={22}>
                      →
                    </T>
                  </Pressable>
                </View>
              </View>

              <Section title="En bref">
                <Card>
                  <CardSubtitle>Paiements</CardSubtitle>
                  {o.dueCount ? (
                    <>
                      <Pills>
                        <Pill tone="r">{`${o.dueCount} tranche${o.dueCount > 1 ? 's' : ''} à payer`}</Pill>
                      </Pills>
                      <Kpi>{DT(o.dueAmount)}</Kpi>
                      <T mut size={13}>
                        Restant sur la saison
                      </T>
                    </>
                  ) : (
                    <>
                      <Pills>
                        <Pill tone="g">À jour</Pill>
                      </Pills>
                      <T mut>Toutes les tranches sont payées.</T>
                    </>
                  )}
                  <Button onPress={() => router.push('/paiements')}>Mes paiements</Button>
                </Card>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Card style={{ flex: 1 }}>
                    <CardSubtitle>Réservations</CardSubtitle>
                    <Kpi>{o.upcomingReservations}</Kpi>
                    <T mut size={13}>
                      créneaux à venir
                    </T>
                  </Card>
                  <Card style={{ flex: 1 }} onPress={() => router.push('/absences')}>
                    <CardSubtitle>Absences</CardSubtitle>
                    <Kpi>{o.absences}</Kpi>
                    <T mut size={13}>
                      séances manquées ›
                    </T>
                  </Card>
                </View>
              </Section>
            </>
          )}
        </QueryState>
      )}

      <Section title="Événements">
        {events.data && events.data.length > 0 ? (
          events.data.map((e) => (
            <Card key={e.id}>
              <CardRow>
                <CardTitle>{e.title}</CardTitle>
                <Pill tone="s">{e.tag}</Pill>
              </CardRow>
              <Pills>
                <Pill tone="b">{fDLong(e.date)}</Pill>
                <Pill tone="g">{e.place}</Pill>
              </Pills>
            </Card>
          ))
        ) : (
          <EmptyState>Aucun événement pour le moment.</EmptyState>
        )}
      </Section>
    </Screen>
  );
}
