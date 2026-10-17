import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useMe } from '../../auth/AuthContext';
import { Card, CardRow, CardSubtitle, CardTitle, EmptyState, Kpi, PageHeader, Pill, Pills, ProgressBar, QueryState, Screen, Section, T } from '../../components/ui';
import { api } from '../../lib/api';
import { DT, fD, fullName } from '../../lib/format';
import type { Dashboard } from '../../lib/types';

/** Dashboard (vDash) : joueurs, encaissé, retards, réservations de demain, remplissage des groupes. */
export default function DashboardScreen() {
  const me = useMe();
  const allowed = me.permissions.includes('stats.view');
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard'), enabled: me.space === 'admin' && allowed });
  if (me.space !== 'admin') return <Redirect href="/" />;
  const d = q.data;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <PageHeader title="Dashboard" subtitle={d ? `Vue d’ensemble de la saison ${d.season.label}.` : 'Vue d’ensemble du club.'} />
      {!allowed ? (
        <EmptyState>Votre rôle n’a pas accès aux statistiques. Utilisez le menu pour vos autres modules.</EmptyState>
      ) : (
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {d && (
            <>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Card style={{ flex: 1 }}>
                  <CardSubtitle>Joueurs actifs</CardSubtitle>
                  <Kpi>{d.activePlayers}</Kpi>
                  <T mut size={13}>{`${d.groupsCount} groupes · ${d.coachesCount} entraîneurs`}</T>
                </Card>
                <Card style={{ flex: 1 }}>
                  <CardSubtitle>Réservations demain</CardSubtitle>
                  <Kpi>{d.reservationsTomorrow}</Kpi>
                  <T mut size={13}>{fD(d.tomorrow)}</T>
                </Card>
              </View>
              <Card>
                <CardSubtitle>Encaissé cette saison</CardSubtitle>
                <Kpi>{DT(d.cashed)}</Kpi>
                <T mut size={13}>{`${d.paymentsCount} paiements enregistrés`}</T>
              </Card>
              <Section title="Tranches en retard">
                {d.late.length ? (
                  <>
                    <Pills>
                      <Pill tone="r">{`${d.late.length} tranche(s) · ${DT(d.lateAmount)} dus`}</Pill>
                    </Pills>
                    {d.late.slice(0, 15).map((l) => (
                      <Card key={l.id}>
                        <CardRow>
                          <CardTitle>{fullName(l.player)}</CardTitle>
                          <Pill tone="r">{DT(l.remaining)}</Pill>
                        </CardRow>
                        <Pills>
                          <Pill tone="b">{`Tranche ${l.number}/${l.count}`}</Pill>
                          <Pill tone="b">Échéance {fD(l.dueDate)}</Pill>
                        </Pills>
                      </Card>
                    ))}
                  </>
                ) : (
                  <EmptyState>Aucune tranche en retard.</EmptyState>
                )}
              </Section>
              <Section title="Remplissage des groupes">
                <Card>
                  {d.groups.map((g) => (
                    <View key={g.id} style={{ gap: 6, marginBottom: 6 }}>
                      <CardRow>
                        <T w="medium" size={14} style={{ flex: 1 }}>
                          {g.name}
                        </T>
                        <T mut size={13}>{`${g.members}/${g.capacity}`}</T>
                      </CardRow>
                      <ProgressBar value={g.members} max={g.capacity} />
                    </View>
                  ))}
                </Card>
              </Section>
            </>
          )}
        </QueryState>
      )}
    </Screen>
  );
}
