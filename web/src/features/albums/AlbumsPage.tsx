import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth, useMe } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card, CardGrid, CardRow, EmptyState } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Segmented } from '../../components/ui/Segmented';
import { api, apiUrl } from '../../lib/api';
import { fD } from '../../lib/format';
import { useAction } from '../../lib/useAction';
import { AlbumForm } from './AlbumForm';
import type { AlbumSummary } from './types';

/** Photos du club : albums visibles (tournois, événements, matchs, groupes), et « Photos de mon enfant ». */
export function AlbumsPage() {
  const me = useMe();
  const { playerId } = useAuth();
  const family = me.role === 'PARENT' || me.role === 'PLAYER';
  const [tab, setTab] = useState<'all' | 'kid'>('all');
  const [kid, setKid] = useState(playerId ?? '');
  const [creating, setCreating] = useState(false);
  const filterKid = family && tab === 'kid' ? kid || playerId : undefined;
  const q = useQuery({ queryKey: ['albums', filterKid ?? 'all'], queryFn: () => api.get<{ canCreate: boolean; albums: AlbumSummary[] }>('/albums', { playerId: filterKid }) });
  const mode = useQuery({ queryKey: ['album-consent'], queryFn: () => api.get<{ mode: 'OPT_IN' | 'OPT_OUT' }>('/albums/consent') });
  const president = me.permissions.includes('permissions.manage') && me.role === 'ADMIN';
  const setMode = useAction((m: 'OPT_IN' | 'OPT_OUT') => api.put('/albums/settings', { mode: m }), { invalidate: [['album-consent'], ['albums']], success: 'Règle des photos enregistrée.' });

  return (
    <>
      <PageHeader
        title="Photos"
        subtitle="Découvrez les albums des tournois, des événements et des entraînements."
        action={
          q.data?.canCreate ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Nouvel album
            </Button>
          ) : undefined
        }
      />
      {family && (
        <Filters>
          <Segmented
            label="Afficher"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'all', label: 'Tous les albums' },
              { value: 'kid', label: me.role === 'PARENT' ? 'Photos de mon enfant' : 'Mes photos' },
            ]}
          />
          {tab === 'kid' && me.role === 'PARENT' && me.players.length > 1 && (
            <FilterSelect label="Enfant" value={kid || playerId} onChange={(e) => setKid(e.target.value)}>
              {me.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </option>
              ))}
            </FilterSelect>
          )}
        </Filters>
      )}
      <div className="mt-4">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.albums.length ? (
            <CardGrid>
              {q.data.albums.map((a) => (
                <Link key={a.id} to={`/photos/${a.id}`} className="block">
                  <Card className="h-full gap-3 overflow-hidden p-0">
                    <div className="grid aspect-[4/3] place-items-center bg-fld">
                      {a.cover ? <img src={apiUrl(a.cover)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="text-sm text-mut">Pas encore de photo</span>}
                    </div>
                    <div className="flex flex-col gap-2 px-5 pb-5">
                      <CardRow>
                        <h3>{a.title}</h3>
                        <Pill tone="b">{a.photos} photo{a.photos > 1 ? 's' : ''}</Pill>
                      </CardRow>
                      <Pills>
                        <Pill tone="s">
                          {a.kindLabel}
                          {a.context ? ` · ${a.context}` : ''}
                        </Pill>
                        <Pill tone="b">{fD(a.date, { day: 'numeric', month: 'short', year: 'numeric' })}</Pill>
                        {a.canManage && <Pill tone="g">{a.audienceLabel}</Pill>}
                        {a.archived && <Pill tone="r">Archivé</Pill>}
                      </Pills>
                    </div>
                  </Card>
                </Link>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>{tab === 'kid' ? 'Aucune photo de votre enfant pour l’instant.' : 'Aucun album pour l’instant.'}</EmptyState>
          )}
        </QueryState>
      </div>
      <div className="mt-4 flex flex-col gap-3">
        <Note>
          {mode.data?.mode === 'OPT_OUT'
            ? 'Règle du club : photos autorisées sauf refus de la famille. '
            : 'Règle du club : sans autorisation photo, un enfant identifié n’apparaît qu’à sa famille. '}
          Réglez l’autorisation de vos enfants dans Paramètres › Autorisation photo. Une photo de votre enfant peut être retirée à tout moment.
        </Note>
        {president && (
          <Filters>
            <FilterSelect label="Règle des photos (président)" value={mode.data?.mode ?? 'OPT_IN'} onChange={(e) => setMode.mutate(e.target.value as 'OPT_IN' | 'OPT_OUT')}>
              <option value="OPT_IN">Pas d’autorisation = pas de photo (conseillé)</option>
              <option value="OPT_OUT">Autorisé sauf refus de la famille</option>
            </FilterSelect>
          </Filters>
        )}
      </div>
      {creating && <AlbumForm onClose={() => setCreating(false)} />}
    </>
  );
}
