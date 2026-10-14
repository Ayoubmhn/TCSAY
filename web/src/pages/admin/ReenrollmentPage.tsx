import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Card, CardGrid, CardRow, EmptyState } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import type { Season } from '../../features/seasons/api';

type Plan = 'FULL' | 'SEMESTER' | 'MONTHLY';
type Row = {
  id: string;
  name: string;
  code: string | null;
  parents: string[];
  previous: { category: string; groups: string[]; plan: Plan | null } | null;
  enrolled: { category: string; groups: string[] } | null;
  suggested: { id: string; name: string; age: number } | null;
};
type Data = {
  season: { id: string; label: string; status: string };
  previous: { id: string; label: string } | null;
  players: Row[];
  groups: { id: string; name: string; capacity: number; members: number; categoryId: string | null }[];
  categories: { id: string; name: string }[];
  plans: { value: Plan; label: string }[];
};
type Choice = { on: boolean; categoryId: string; groupId: string; plan: Plan; reason: string };

/**
 * Réinscriptions pour une nouvelle saison : les joueurs (et leurs parents) de la saison précédente d'abord ; pour chaque
 * joueur coché, catégorie proposée (modifiable avec motif), groupe facultatif et mode de paiement demandé à l'affectation.
 */
export function ReenrollmentPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.get<Season[]>('/seasons') });
  const open = (seasons.data ?? []).filter((s) => (s.status === 'DRAFT' || s.status === 'ACTIVE') && !s.archivedAt);
  const seasonId = params.get('saison') || open.find((s) => s.status === 'DRAFT')?.id || open[0]?.id || '';
  const q = useQuery({ queryKey: ['reenrollments', seasonId], queryFn: () => api.get<Data>('/reenrollments', { seasonId }), enabled: Boolean(seasonId) });
  const [filter, setFilter] = useState<'previous' | 'todo' | 'all'>('previous');
  const [search, setSearch] = useState('');
  const [bulkPlan, setBulkPlan] = useState<Plan>('FULL');
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  useEffect(() => setChoices({}), [seasonId]);

  const d = q.data;
  const choice = (r: Row): Choice =>
    choices[r.id] ?? { on: false, categoryId: r.suggested?.id ?? '', groupId: '', plan: r.previous?.plan ?? bulkPlan, reason: '' };
  const set = (r: Row, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [r.id]: { ...choice(r), ...patch } }));

  const rows = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (d?.players ?? [])
      .filter((r) => (filter === 'previous' ? r.previous : filter === 'todo' ? !r.enrolled : true))
      .filter((r) => words.every((w) => `${r.name} ${r.code ?? ''} ${r.parents.join(' ')}`.toLowerCase().includes(w)))
      .sort((a, b) => Number(Boolean(a.enrolled)) - Number(Boolean(b.enrolled)));
  }, [d, filter, search]);
  const selected = rows.filter((r) => !r.enrolled && choice(r).on);

  const save = useAction(
    () =>
      api.post<{ enrolled: number; skipped: { name: string; reason: string }[]; noFee: string[] }>('/reenrollments', {
        seasonId,
        items: selected.map((r) => {
          const c = choice(r);
          return { playerId: r.id, categoryId: c.categoryId || undefined, groupId: c.groupId || undefined, paymentPlan: c.plan, derogationReason: c.reason.trim() || undefined };
        }),
      }),
    {
      invalidate: [['reenrollments'], ['players'], ['installments'], ['groups']],
      success: (r) => `${r.enrolled} joueur(s) réinscrit(s)${r.noFee.length ? ` · ${r.noFee.length} sans cotisation (aucun tarif pour cette saison : Tarifs d’entraînement)` : ''}${r.skipped.length ? ` · ${r.skipped.length} non traité(s) : ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(' ; ')}` : ''}.`,
      onSuccess: () => setChoices({}),
    },
  );

  const submit = () => {
    if (!selected.length) return toast('Cochez au moins un joueur.');
    const missing = selected.find((r) => choice(r).categoryId !== (r.suggested?.id ?? '') && !choice(r).reason.trim());
    if (missing) return toast(`R3 · ${missing.name} : catégorie hors norme, motif obligatoire.`);
    save.mutate();
  };

  return (
    <>
      <PageHeader
        title="Réinscriptions"
        subtitle="Découvrez les joueurs de la saison précédente et inscrivez-les dans la nouvelle saison."
        action={
          <Button variant="primary" onClick={submit} disabled={!selected.length || save.isPending}>
            Réinscrire la sélection ({selected.length})
          </Button>
        }
      />
      <Filters>
        <FilterSelect label="Saison" value={seasonId} onChange={(e) => setParams({ saison: e.target.value })}>
          {open.map((s) => (
            <option key={s.id} value={s.id}>
              Saison {s.label} {s.status === 'DRAFT' ? '(brouillon)' : '(active)'}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Afficher" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="previous">Joueurs de la saison précédente</option>
          <option value="todo">Tous les joueurs pas encore inscrits</option>
          <option value="all">Tous les joueurs</option>
        </FilterSelect>
        <input className="fld w-[220px] text-fg" placeholder="Joueur, parent ou code" aria-label="Rechercher" value={search} onChange={(e) => setSearch(e.target.value)} />
        <FilterSelect label="Mode de paiement par défaut" value={bulkPlan} onChange={(e) => setBulkPlan(e.target.value as Plan)}>
          {(d?.plans ?? []).map((p) => (
            <option key={p.value} value={p.value}>
              Paiement : {p.label.toLowerCase()}
            </option>
          ))}
        </FilterSelect>
      </Filters>
      {!seasonId && !seasons.isPending && <EmptyState>Créez d’abord la nouvelle saison (Saisons › + Nouvelle saison), en brouillon.</EmptyState>}
      <QueryState isPending={q.isPending && Boolean(seasonId)} error={q.error} refetch={q.refetch}>
        {d && (
          <>
            <Pills className="my-[18px]">
              <Pill tone="b">Saison {d.season.label}</Pill>
              {d.previous && <Pill tone="s">Saison précédente {d.previous.label}</Pill>}
              <Pill tone="g">{d.players.filter((r) => r.enrolled).length} déjà inscrit(s)</Pill>
              <Pill tone="r">{d.players.filter((r) => r.previous && !r.enrolled).length} à réinscrire</Pill>
              <button type="button" className="rounded-full bg-btn px-[13px] py-[5px] text-[13px] font-medium" onClick={() => rows.forEach((r) => !r.enrolled && set(r, { on: true, plan: choice(r).plan }))}>
                Tout cocher
              </button>
            </Pills>
            {rows.length ? (
              <CardGrid list>
                {rows.map((r) => {
                  const c = choice(r);
                  const off = c.categoryId !== (r.suggested?.id ?? '');
                  return (
                    <Card key={r.id} className={r.enrolled ? 'opacity-60' : ''}>
                      <CardRow>
                        <label className="flex min-w-0 items-center gap-2.5">
                          <input type="checkbox" className="h-4 w-4 accent-pri" disabled={Boolean(r.enrolled)} checked={Boolean(r.enrolled) || c.on} onChange={(e) => set(r, { on: e.target.checked })} />
                          <h3 className="truncate">{r.name}</h3>
                        </label>
                      </CardRow>
                      <Pills>
                        {r.enrolled ? (
                          <Pill tone="g">Inscrit · {r.enrolled.category}</Pill>
                        ) : (
                          <>
                            {r.previous && <Pill tone="s">Avant : {r.previous.category}{r.previous.groups.length ? ` · ${r.previous.groups.join(', ')}` : ''}</Pill>}
                            {r.parents.length > 0 && <Pill tone="b" className="card-text">{r.parents.join(', ')}</Pill>}
                          </>
                        )}
                      </Pills>
                      {!r.enrolled && c.on && (
                        <div className="flex flex-wrap items-center gap-2">
                          <select className="fld w-auto py-2 text-sm" aria-label="Catégorie" value={c.categoryId} onChange={(e) => set(r, { categoryId: e.target.value })}>
                            {!r.suggested && <option value="">Catégorie…</option>}
                            {d.categories.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name}
                                {cat.id === r.suggested?.id ? ' (proposée)' : ''}
                              </option>
                            ))}
                          </select>
                          <select className="fld w-auto py-2 text-sm" aria-label="Groupe" value={c.groupId} onChange={(e) => set(r, { groupId: e.target.value })}>
                            <option value="">Sans groupe</option>
                            {d.groups.map((g) => (
                              <option key={g.id} value={g.id} disabled={g.members >= g.capacity}>
                                {g.name} ({g.members}/{g.capacity})
                              </option>
                            ))}
                          </select>
                          <select className="fld w-auto py-2 text-sm" aria-label="Mode de paiement" value={c.plan} onChange={(e) => set(r, { plan: e.target.value as Plan })}>
                            {d.plans.map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                          {off && (
                            <input className="fld w-[220px] py-2 text-sm" placeholder="Motif (catégorie hors norme) *" aria-label="Motif" value={c.reason} onChange={(e) => set(r, { reason: e.target.value })} />
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </CardGrid>
            ) : (
              <EmptyState>Aucun joueur pour ce filtre.</EmptyState>
            )}
          </>
        )}
      </QueryState>
      <Note>
        Pour chaque joueur réinscrit : inscription dans la saison, groupe si choisi (capacité respectée, R4), cotisation créée depuis
        le tarif avec le mode de paiement choisi, et notification aux parents. Catégorie différente de celle proposée : motif
        obligatoire (R3).
      </Note>
    </>
  );
}
