import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useMe } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { CardGrid, EmptyState } from '../../components/ui/Card';
import { Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Segmented } from '../../components/ui/Segmented';
import { api } from '../../lib/api';
import { EventForm } from './EventForm';
import { EventCard } from './EventCard';
import type { EventSummary } from './types';

/** Événements du club : à venir et passés ; la direction crée, publie et suit les participations. */
export function EventsPage() {
  const me = useMe();
  const manager = me.role === 'ADMIN' && me.permissions.includes('events.manage');
  const [tab, setTab] = useState<'next' | 'past'>('next');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['events', tab], queryFn: () => api.get<EventSummary[]>('/events', tab === 'past' ? { past: '1' } : undefined) });

  return (
    <>
      <PageHeader
        title="Événements"
        subtitle="Découvrez les fêtes, stages, réunions et sorties du club."
        action={
          manager ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Nouvel événement
            </Button>
          ) : undefined
        }
      />
      <Filters>
        <Segmented
          label="Afficher"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'next', label: 'À venir' },
            { value: 'past', label: 'Passés' },
          ]}
        />
      </Filters>
      <div className="mt-4">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid>
              {q.data.map((e) => (
                <EventCard key={e.id} e={e} />
              ))}
            </CardGrid>
          ) : (
            <EmptyState>{tab === 'past' ? 'Aucun événement passé.' : 'Aucun événement à venir.'}</EmptyState>
          )}
        </QueryState>
      </div>
      <div className="mt-4">
        <Note>
          {manager
            ? 'Un événement « avec participation » demande une réponse (places limitées au choix) ; « affichage seulement » l’annonce sans inscription. Rappel automatique la veille. Supprimer = archiver.'
            : 'Répondez « Je participe » sur les événements qui le demandent. Un rappel arrive la veille.'}
        </Note>
      </div>
      {creating && <EventForm onClose={() => setCreating(false)} />}
    </>
  );
}
