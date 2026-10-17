import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Card, CardGrid, CardSubtitle, EmptyState, Kpi } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { api } from '../../lib/api';
import { ComplaintCard } from './ComplaintsPage';
import { CATEGORIES, type Complaint, type ComplaintStats } from './types';

const LINK_BTN = 'inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg';

/** Responsables : réclamations de leurs catégories (urgentes d'abord), indicateurs du bureau. */
export function ComplaintsAdminPage() {
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open');
  const [category, setCategory] = useState('');
  const [view, setView] = useViewMode('reclamations-admin');
  const list = useQuery({ queryKey: ['complaints', 'handle', state, category], queryFn: () => api.get<Complaint[]>('/complaints', { state, category }) });
  const stats = useQuery({ queryKey: ['complaints', 'stats'], queryFn: () => api.get<ComplaintStats>('/complaints/stats') });
  const s = stats.data;
  return (
    <>
      <PageHeader
        title="Réclamations"
        subtitle="Découvrez les réclamations et suggestions de vos catégories."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            <Link to="/reclamations" className={LINK_BTN}>
              Mes réclamations
            </Link>
          </div>
        }
      />
      {s && (
        <div className="mt-4 grid grid-cols-2 gap-3 min-[861px]:grid-cols-4">
          <Card>
            <CardSubtitle>Ouvertes</CardSubtitle>
            <Kpi>{s.open}</Kpi>
            {s.urgent > 0 && <Pill tone="r">{s.urgent} urgente(s)</Pill>}
          </Card>
          <Card>
            <CardSubtitle>Sans réponse &gt; 72 h</CardSubtitle>
            <Kpi>{s.late}</Kpi>
          </Card>
          <Card>
            <CardSubtitle>Temps moyen de traitement</CardSubtitle>
            <Kpi>{s.averageHours === null ? '—' : s.averageHours < 48 ? `${s.averageHours} h` : `${Math.round(s.averageHours / 24)} j`}</Kpi>
          </Card>
          <Card>
            <CardSubtitle>Satisfaction</CardSubtitle>
            <Kpi>{s.satisfaction === null ? '—' : `${s.satisfaction} %`}</Kpi>
          </Card>
        </div>
      )}
      {s && s.byCategory.length > 0 && (
        <Pills className="mt-3">
          {s.byCategory.map((c) => (
            <Pill key={c.category} tone="s">
              {c.label} · {c.count}
            </Pill>
          ))}
          <Pill tone="b">{s.total90} sur 90 jours</Pill>
        </Pills>
      )}
      <Section title="Liste">
        <Filters>
          <FilterSelect label="État" value={state} onChange={(e) => setState(e.target.value as typeof state)}>
            <option value="open">Ouvertes</option>
            <option value="closed">Closes</option>
            <option value="all">Toutes</option>
          </FilterSelect>
          <FilterSelect label="Catégorie" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Toutes les catégories</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </FilterSelect>
        </Filters>
        <div className="mt-3">
          <QueryState isPending={list.isPending} error={list.error} refetch={list.refetch}>
            {list.data?.length ? (
              <CardGrid list={view === 'list'}>
                {list.data.map((c) => (
                  <ComplaintCard key={c.id} c={c} to={`/admin/reclamations/${c.id}`} />
                ))}
              </CardGrid>
            ) : (
              <EmptyState>{state === 'open' ? 'Aucune réclamation en attente.' : 'Aucune réclamation.'}</EmptyState>
            )}
          </QueryState>
        </div>
      </Section>
      <div className="mt-4">
        <Note>
          Chaque catégorie arrive à son responsable (caisse, réservations, direction technique, terrains) ; « Comportement » et les signalements urgents
          vont au président. La personne visée ne voit jamais la réclamation. Rappel automatique après 72 h sans réponse.
        </Note>
      </div>
    </>
  );
}
