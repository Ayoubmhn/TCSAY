import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { fullName } from '../../lib/format';
import type { Category, Player } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { PlayerFormModal } from './PlayerFormModal';

/** Joueurs (vPlayers) : recherche, filtre par catégorie ou archivés, création, modification, archivage (R8). */
export function PlayersPage() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState<{ open: boolean; player?: Player }>({ open: false });
  const [toArchive, setToArchive] = useState<Player>();

  const archived = filter === 'arch';
  const list = useQuery({
    queryKey: ['players', filter, q],
    queryFn: () =>
      api.get<Player[]>('/players', {
        q: q.trim() || undefined,
        archived: archived || undefined,
        categoryId: filter !== 'all' && !archived ? filter : undefined,
      }),
  });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories') });

  const archive = useAction((id: string) => api.post(`/players/${id}/archive`), {
    invalidate: [['players'], ['groups'], ['dashboard'], ['categories']],
    success: 'Joueur archivé.',
    onSuccess: () => setToArchive(undefined),
  });
  const restore = useAction((id: string) => api.post(`/players/${id}/restore`), {
    invalidate: [['players'], ['dashboard']],
    success: 'Joueur restauré.',
  });
  const rows = list.data ?? [];

  return (
    <>
      <PageHeader
        title="Joueurs"
        subtitle="Découvrez les joueurs inscrits pour la saison en cours."
        action={
          <Button variant="primary" onClick={() => setForm({ open: true })}>
            + Nouveau joueur
          </Button>
        }
      />
      <Filters>
        <input
          className="fld w-[220px] text-fg"
          placeholder="Rechercher un joueur"
          aria-label="Rechercher"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <FilterSelect label="Filtrer par catégorie" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Toutes les catégories</option>
          {categories.data
            ?.filter((c) => c.playersCount > 0)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          <option value="arch">Archivés</option>
        </FilterSelect>
        {list.data && (
          <Pill tone="b">
            {rows.length} joueur{rows.length > 1 ? 's' : ''}
          </Pill>
        )}
      </Filters>

      <div className="mt-2.5">
        <QueryState isPending={list.isPending} error={list.error} refetch={list.refetch}>
          {rows.length ? (
            <CardGrid>
              {rows.map((p) => (
                <Card key={p.id}>
                  <CardRow>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar first={p.firstName} last={p.lastName} />
                      <div className="min-w-0">
                        <h3>{fullName(p)}</h3>
                        <CardText>
                          {p.age} ans · {p.gender === 'M' ? 'Garçon / Homme' : 'Fille / Femme'}
                        </CardText>
                      </div>
                    </div>
                  </CardRow>
                  <Pills>
                    {p.category && <Pill tone="s">{p.category.name}</Pill>}
                    {p.group ? <Pill tone="g">{p.group.name}</Pill> : !p.archivedAt && <Pill tone="r">Sans groupe</Pill>}
                    {p.derogationReason && <Pill tone="s">Dérogation</Pill>}
                  </Pills>
                  <CardText>
                    {p.minor
                      ? `Parent : ${p.parents.map((x) => fullName(x)).join(', ') || '—'}`
                      : (p.email ?? '—')}
                  </CardText>
                  <CardActions>
                    {p.archivedAt ? (
                      <>
                        <Pill tone="s">Archivé</Pill>
                        <Button onClick={() => restore.mutate(p.id)}>Restaurer</Button>
                      </>
                    ) : (
                      <>
                        <Button onClick={() => setForm({ open: true, player: p })}>Modifier</Button>
                        <Button variant="danger" onClick={() => setToArchive(p)}>
                          Archiver
                        </Button>
                      </>
                    )}
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun joueur.</EmptyState>
          )}
        </QueryState>
      </div>

      <Note>
        Suppression = <b>archivage</b> (R8). Nom, naissance, genre et catégorie : modifiables par l’admin seulement (R9). Un
        mineur a toujours au moins un parent lié.
      </Note>

      <PlayerFormModal open={form.open} player={form.player} onClose={() => setForm({ open: false })} />
      <ConfirmModal
        open={Boolean(toArchive)}
        title="Archiver ce joueur ?"
        text={toArchive ? `${fullName(toArchive)} a des inscriptions et des paiements liés : il sera archivé, pas supprimé (R8).` : ''}
        cta="Archiver"
        pending={archive.isPending}
        onConfirm={() => toArchive && archive.mutate(toArchive.id)}
        onClose={() => setToArchive(undefined)}
      />
    </>
  );
}
