import { useQuery } from '@tanstack/react-query';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { useState } from 'react';
import { Card, CardGrid, CardRow } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { categoryPairs } from '../../lib/categories';
import type { Category } from '../../lib/types';

export const FAMILY_LABEL: Record<Category['family'], string> = {
  YOUTH: 'Jeunes',
  ADULT: 'Adultes',
  VETERAN: 'Vétérans',
  CORPORATE: 'Entreprise',
  PADEL: 'Padel',
  LEISURE: 'Loisirs',
};

/** Catégories (vCats) : une carte par paire garçons / filles (les inscriptions restent par genre). */
export function CategoriesPage() {
  const [view, setView] = useViewMode('categories');
  const [family, setFamily] = useState<'all' | Category['family']>('all');
  const q = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories') });
  const list = categoryPairs(q.data ?? []).filter((c) => family === 'all' || c.family === family);

  return (
    <>
      <PageHeader action={<ViewToggle value={view} onChange={setView} />} title="Catégories" subtitle="Découvrez les catégories, garçons et filles réunis par âge." />
      <Filters>
        <FilterSelect label="Filtrer par famille" value={family} onChange={(e) => setFamily(e.target.value as typeof family)}>
          <option value="all">Toutes</option>
          {(Object.keys(FAMILY_LABEL) as Category['family'][]).map((f) => (
            <option key={f} value={f}>
              {FAMILY_LABEL[f]}
            </option>
          ))}
        </FilterSelect>
        {q.data && (
          <Pill tone="b">
            {list.length} catégorie{list.length > 1 ? 's' : ''}
          </Pill>
        )}
      </Filters>
      <div className="mt-2.5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          <CardGrid list={view === 'list'}>
            {list.map((c) => {
              const mixed = c.categories.length === 1;
              return (
                <Card key={c.code}>
                  <CardRow>
                    <h3>{c.name}</h3>
                    <Pill tone="b">{c.playersCount} joueur{c.playersCount > 1 ? 's' : ''}</Pill>
                  </CardRow>
                  <Pills>
                    <Pill tone="s">{FAMILY_LABEL[c.family]}</Pill>
                    {mixed ? (
                      <Pill tone="g">{c.categories[0].gender === 'MIXED' ? 'Mixte' : c.categories[0].gender === 'F' ? 'Filles' : 'Garçons'}</Pill>
                    ) : (
                      <>
                        <Pill tone="g">Garçons {c.boys}</Pill>
                        <Pill tone="g">Filles {c.girls}</Pill>
                      </>
                    )}
                  </Pills>
                  {!mixed && c.playersCount > 0 && (
                    <div className="flex h-2 overflow-hidden rounded-full bg-fld" role="img" aria-label={`${c.boys} garçons, ${c.girls} filles`}>
                      <span className="bg-pri" style={{ width: `${(c.boys / c.playersCount) * 100}%` }} />
                      <span className="bg-pr" style={{ width: `${(c.girls / c.playersCount) * 100}%` }} />
                    </div>
                  )}
                  {c.note && (
                    <Pill tone="r" className="self-start">
                      {c.note}
                    </Pill>
                  )}
                </Card>
              );
            })}
          </CardGrid>
        </QueryState>
      </div>
      <Note>
        Calcul provisoire : âge selon l’année de naissance au 31/12 de la saison. <b>À confirmer avec le bureau</b> (âge atteint
        ou année de naissance, date de référence). Les inscriptions restent par genre : le formulaire joueur choisit la catégorie de la paire d’après le genre, et le tarif est commun à la paire.
      </Note>
    </>
  );
}
