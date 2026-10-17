import { useQuery } from '@tanstack/react-query';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';

import { useAuth } from '../../auth/AuthContext';
import { categoryPairs } from '../../lib/categories';
import { api } from '../../lib/api';
import { fullName, isPlaceholderEmail } from '../../lib/format';
import type { Category, Player } from '../../lib/types';
import { byNumber, byText, nameSorts, sortRows, type SortOption } from '../../lib/sort';
import { useAction } from '../../lib/useAction';
import { MemberCodesModal } from './MemberCodesModal';
import { MissingMemberships } from './MissingMemberships';
import { PlayerFormModal } from './PlayerFormModal';

const PLAYER_SORTS: SortOption<Player>[] = [
  ...nameSorts<Player>(),
  { value: 'code', label: 'Code TCSAY', compare: byText<Player>((p) => p.memberCode) },
  { value: 'young', label: 'Âge (plus jeune d’abord)', compare: byNumber<Player>((p) => p.age) },
  { value: 'old', label: 'Âge (plus âgé d’abord)', compare: byNumber<Player>((p) => p.age, true) },
  { value: 'category', label: 'Catégorie', compare: (a, b) => byText<Player>((p) => p.category?.name)(a, b) || byText<Player>((p) => p.lastName)(a, b) },
  { value: 'group', label: 'Groupe (sans groupe en premier)', compare: (a, b) => byText<Player>((p) => p.group?.name)(a, b) || byText<Player>((p) => p.lastName)(a, b) },
];

/** Joueurs (vPlayers) : recherche, filtre par catégorie ou archivés, création, modification, archivage (R8). */
export function PlayersPage() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  // « Nouveau joueur » depuis le tableau de bord : /admin/joueurs?nouveau=1 ouvre directement le formulaire.
  const [params] = useSearchParams();
  const [form, setForm] = useState<{ open: boolean; player?: Player }>({ open: params.get('nouveau') === '1' });
  const [toArchive, setToArchive] = useState<Player>();
  const [codes, setCodes] = useState(false);
  const [view, setView] = useViewMode('joueurs');
  const [sort, setSort] = useState('name');
  const { me } = useAuth();
  const president = Boolean(me?.permissions.includes('permissions.manage'));

  const archived = filter === 'arch';
  const list = useQuery({
    queryKey: ['players', filter, q],
    queryFn: () =>
      api.get<Player[]>('/players', {
        q: q.trim() || undefined,
        archived: archived || undefined,
        pairCode: filter !== 'all' && !archived ? filter : undefined,
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
  const rows = sortRows(list.data ?? [], PLAYER_SORTS, sort);

  return (
    <>
      <PageHeader
        title="Joueurs"
        subtitle="Découvrez les joueurs inscrits pour la saison en cours."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            {president && <Button onClick={() => setCodes(true)}>Identifiants TCSAY</Button>}
            <Link
              className="inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg"
              to="/admin/joueurs/import"
            >
              Importer (Excel)
            </Link>
            <Button variant="primary" onClick={() => setForm({ open: true })}>
              + Nouveau joueur
            </Button>
          </div>
        }
      />
      <Filters>
        <input
          className="fld w-[220px] text-fg"
          placeholder="Nom, code TCSAY ou nom arabe"
          aria-label="Rechercher"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <FilterSelect label="Filtrer par catégorie" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Toutes les catégories</option>
          {categoryPairs(categories.data ?? [])
            .filter((c) => c.playersCount > 0)
            .map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.playersCount})
              </option>
            ))}
          <option value="arch">Archivés</option>
        </FilterSelect>
        <FilterSelect label="Trier par" value={sort} onChange={(e) => setSort(e.target.value)}>
          {PLAYER_SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              Trier : {o.label}
            </option>
          ))}
        </FilterSelect>
        {list.data && (
          <Pill tone="b">
            {rows.length} joueur{rows.length > 1 ? 's' : ''}
          </Pill>
        )}
      </Filters>

      <MissingMemberships />
      <div className="mt-2.5">
        <QueryState isPending={list.isPending} error={list.error} refetch={list.refetch}>
          {rows.length ? (
            <CardGrid list={view === 'list'}>
              {rows.map((p) => (
                <Card key={p.id}>
                  <CardRow>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar first={p.firstName} last={p.lastName} photo={p.photoUrl} />
                      <div className="min-w-0">
                        <Link to={`/admin/joueurs/${p.id}`} className="hover:underline">
                          <h3>{fullName(p)}</h3>
                        </Link>
                        <CardText>
                          {p.memberCode && (
                            <>
                              <span className="font-semibold tabular-nums text-fg">{p.memberCode}</span>
                              {p.memberCodeProvisional && <span title="Code provisoire"> *</span>} ·{' '}
                            </>
                          )}
                          {p.age === null ? 'âge inconnu' : `${p.age} ans`} · {p.gender === 'M' ? 'Garçon / Homme' : 'Fille / Femme'}
                        </CardText>
                      </div>
                    </div>
                  </CardRow>
                  <Pills>
                    {p.category && <Pill tone="s">{p.category.name}</Pill>}
                    {p.group ? <Pill tone="g">{p.group.name}</Pill> : !p.archivedAt && <Pill tone="r">Sans groupe</Pill>}
                    {p.derogationReason && <Pill tone="s">Dérogation</Pill>}
                    {!p.archivedAt && !p.enrolled && <Pill tone="r">Non inscrit</Pill>}
                    {!p.archivedAt && p.enrolled && !p.membership && <Pill tone="r">Sans cotisation</Pill>}
                    {!p.birthDate ? <Pill tone="r">Naissance à compléter</Pill> : p.birthYearOnly && <Pill tone="s">Année seule</Pill>}
                    {p.parents.some((x) => isPlaceholderEmail(x.email)) && <Pill tone="s">Email parent à compléter</Pill>}
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
                        <ActionIcon kind="restore" onClick={() => restore.mutate(p.id)} />
                      </>
                    ) : (
                      <>
                        <ActionIcon kind="view" label="Profil" to={`/admin/joueurs/${p.id}`} />
                        <ActionIcon kind="edit" onClick={() => setForm({ open: true, player: p })} />
                        <ActionIcon kind="archive" onClick={() => setToArchive(p)} />
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
        Code « 26TCSAY001 » = année d’inscription + n° ; <b>*</b> = provisoire, recalculé après l’import des années précédentes.
        Suppression = <b>archivage</b> (R8). Nom, naissance, genre et catégorie : modifiables par l’admin seulement (R9). Un
        mineur a toujours au moins un parent lié.
      </Note>

      {president && <MemberCodesModal open={codes} onClose={() => setCodes(false)} />}
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
