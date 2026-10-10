import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../components/ui/Card';
import { FilterSelect, Filters } from '../components/ui/Field';
import { QueryState } from '../components/ui/Loading';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill, type PillTone } from '../components/ui/Pill';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { AppNotification } from '../lib/types';
import { useAction } from '../lib/useAction';

const KIND: Record<string, { tone: PillTone; label: string }> = {
  REMINDER: { tone: 'r', label: 'Paiement' },
  RESERVATION: { tone: 'g', label: 'Réservation' },
  SALARY: { tone: 'g', label: 'Salaire' },
  OTHER: { tone: 's', label: 'Information' },
};

/** Notifications dans l'application (tous les rôles) : non lues d'abord, marquer comme lu, ouvrir l'écran concerné. */
export function NotificationsPage() {
  const navigate = useNavigate();
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
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Découvrez les messages du club : paiements, réservations, salaires."
        action={
          <Button onClick={() => readAll.mutate()} disabled={readAll.isPending}>
            Tout marquer comme lu
          </Button>
        }
      />
      <Filters>
        <FilterSelect label="Afficher" value={filter} onChange={(e) => setFilter(e.target.value as 'unread' | 'all')}>
          <option value="unread">Non lues</option>
          <option value="all">Toutes</option>
        </FilterSelect>
        {q.data && <Pill tone="b">{rows.length} notification{rows.length > 1 ? 's' : ''}</Pill>}
      </Filters>
      <div className="mt-2.5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {rows.length ? (
            <CardGrid>
              {rows.map((n) => {
                const kind = n.broadcastId ? { tone: 'b' as PillTone, label: 'Message du club' } : (KIND[n.kind] ?? { tone: 's' as PillTone, label: 'Information' });
                return (
                  <Card key={n.id} className={n.readAt ? 'opacity-70' : ''}>
                    <CardRow>
                      <h3 className="min-w-0">{n.title}</h3>
                      <Pill tone={kind.tone}>{kind.label}</Pill>
                    </CardRow>
                    <p className="m-0 text-sm whitespace-pre-line text-fg">{n.body}</p>
                    <CardText>{formatDateTime(n.createdAt)}</CardText>
                    <CardActions>
                      {n.link && (
                        <Button variant="primary" onClick={() => open(n)}>
                          Ouvrir
                        </Button>
                      )}
                      {!n.readAt && <Button onClick={() => read.mutate(n.id)}>Marquer comme lu</Button>}
                    </CardActions>
                  </Card>
                );
              })}
            </CardGrid>
          ) : (
            <EmptyState>{filter === 'unread' ? 'Aucune notification non lue.' : 'Aucune notification.'}</EmptyState>
          )}
        </QueryState>
      </div>
    </>
  );
}
