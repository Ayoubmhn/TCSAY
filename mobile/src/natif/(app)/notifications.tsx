import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { IconCheck } from '../../components/Icons';
import { Button, Card, CardRow, CardTitle, EmptyState, IconButton, PageHeader, Pill, QueryState, Screen, Segmented, T } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { appRoute } from '../../lib/nav';
import { useTheme, type PillTone } from '../../lib/theme';
import type { AppNotification } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const KIND: Record<string, { tone: PillTone; label: string }> = {
  REMINDER: { tone: 'r', label: 'Paiement' },
  RESERVATION: { tone: 'g', label: 'Réservation' },
  SALARY: { tone: 'g', label: 'Salaire' },
  OTHER: { tone: 's', label: 'Information' },
};

/** Notifications (tous les rôles) : non lues d'abord, marquer comme lu, ouvrir l'écran concerné. */
export default function NotificationsScreen() {
  const { t } = useTheme();
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const q = useQuery({ queryKey: ['notifications', filter], queryFn: () => api.get<AppNotification[]>('/notifications', { filter }) });
  const read = useAction((id: string) => api.post(`/notifications/${id}/read`), { invalidate: [['notifications']] });
  const readAll = useAction(() => api.post<{ read: number }>('/notifications/read-all'), {
    invalidate: [['notifications']],
    success: (r) => `${r.read} notification(s) marquée(s) comme lue(s).`,
  });
  const rows = q.data ?? [];

  const open = (n: AppNotification) => {
    if (!n.readAt) read.mutate(n.id);
    const route = appRoute(n.link);
    if (route) router.push(route);
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <PageHeader title="Notifications" subtitle="Découvrez les messages du club : paiements, séances, réservations." />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <Segmented
          label="Afficher"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'unread', label: 'Non lues' },
            { value: 'all', label: 'Toutes' },
          ]}
        />
        <Button onPress={() => readAll.mutate()} disabled={readAll.isPending || !rows.some((n) => !n.readAt)}>
          Tout lire
        </Button>
      </View>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {rows.length ? (
          rows.map((n) => {
            const kind = n.broadcastId ? { tone: 'b' as PillTone, label: 'Message du club' } : (KIND[n.kind] ?? { tone: 's' as PillTone, label: 'Information' });
            return (
              <Card key={n.id} faded={Boolean(n.readAt)} onPress={appRoute(n.link) ? () => open(n) : undefined}>
                <CardRow>
                  <CardTitle>{n.title}</CardTitle>
                  <Pill tone={kind.tone}>{kind.label}</Pill>
                </CardRow>
                <T size={14}>{n.body}</T>
                <CardRow>
                  <T mut size={12}>
                    {formatDateTime(n.createdAt)}
                    {appRoute(n.link) ? '  ·  Ouvrir ›' : ''}
                  </T>
                  {!n.readAt && (
                    <IconButton label="Marquer comme lu" onPress={() => read.mutate(n.id)}>
                      <IconCheck color={t.fg} size={20} />
                    </IconButton>
                  )}
                </CardRow>
              </Card>
            );
          })
        ) : (
          <EmptyState>{filter === 'unread' ? 'Aucune notification non lue.' : 'Aucune notification.'}</EmptyState>
        )}
      </QueryState>
    </Screen>
  );
}
