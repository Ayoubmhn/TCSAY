import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardGrid, CardRow } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import type { Category } from '../../lib/types';

export const FAMILY_LABEL: Record<Category['family'], string> = {
  YOUTH: 'Jeunes',
  ADULT: 'Adultes',
  VETERAN: 'Vétérans',
  CORPORATE: 'Entreprise',
  PADEL: 'Padel',
  LEISURE: 'Loisirs',
};

const GENDER_LABEL = { M: 'Masculin', F: 'Féminin', MIXED: 'Mixte' } as const;

/** Catégories (vCats) : 29 catégories par paires garçon / fille. */
export function CategoriesPage() {
  const [family, setFamily] = useState<'all' | Category['family']>('all');
  const q = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories') });
  const list = (q.data ?? []).filter((c) => family === 'all' || c.family === family);

  return (
    <>
      <PageHeader title="Catégories" subtitle="Découvrez les 29 catégories, par paires garçon / fille." />
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
          <CardGrid>
            {list.map((c) => (
              <Card key={c.id}>
                <CardRow>
                  <h3>{c.name}</h3>
                  <Pill tone="b">{c.pairCode}</Pill>
                </CardRow>
                <Pills>
                  <Pill tone="s">{FAMILY_LABEL[c.family]}</Pill>
                  <Pill tone="g">{GENDER_LABEL[c.gender]}</Pill>
                  <Pill tone="b">{c.playersCount} joueur(s)</Pill>
                </Pills>
                {c.note && (
                  <Pill tone="r" className="self-start">
                    {c.note}
                  </Pill>
                )}
              </Card>
            ))}
          </CardGrid>
        </QueryState>
      </div>
      <Note>
        Calcul provisoire : âge selon l’année de naissance au 31/12 de la saison. <b>À confirmer avec le bureau</b> (âge atteint
        ou année de naissance, date de référence).
      </Note>
    </>
  );
}
