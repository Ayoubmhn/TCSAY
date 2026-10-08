import { useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { Filters, FilterSelect } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import {
  LOCKED_STATUSES,
  STATUS,
  seasonAction,
  useArchiveSeason,
  useSeasons,
  type Season,
  type SeasonAction,
  type SeasonStatus,
} from './api';
import { SeasonFormModal } from './SeasonFormModal';
import { SeasonStatusModal } from './SeasonStatusModal';

type CardProps = {
  season: Season;
  onAction: (action: SeasonAction) => void;
  onEdit: () => void;
  onArchive: () => void;
  canManage: boolean;
};

function SeasonCard({ season, onAction, onEdit, onArchive, canManage }: CardProps) {
  const { label, tone, text } = STATUS[season.status];
  const archived = Boolean(season.archivedAt);
  const editable = !archived && !LOCKED_STATUSES.includes(season.status);
  const action = seasonAction(season.status);

  return (
    <Card>
      <CardRow>
        <Link to={`/admin/saisons/${season.id}`} className="hover:underline">
          <h3>Saison {season.label}</h3>
        </Link>
        <Pill tone={tone}>{label}</Pill>
      </CardRow>
      <Pills>
        <Pill tone="b">
          Compétitif {formatDate(season.startDate)} → {formatDate(season.endDate)}
        </Pill>
        {season.leisureStartDate && season.leisureEndDate && (
          <Pill tone="s">
            Loisirs {formatDate(season.leisureStartDate)} → {formatDate(season.leisureEndDate)}
          </Pill>
        )}
      </Pills>
      <CardText>{text}</CardText>
      <CardActions>
        <Link
          to={`/admin/saisons/${season.id}`}
          className="inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg"
        >
          {season.status === 'ACTIVE' || season.status === 'DRAFT' ? 'Statistiques' : 'Historique et statistiques'}
        </Link>
        {archived ? (
          <Pill tone="s">Archivée</Pill>
        ) : !canManage ? null : (
          <>
            <Button onClick={() => onAction(action)}>{action.label}</Button>
            {editable && <Button onClick={onEdit}>Modifier</Button>}
            {editable && season.status !== 'ACTIVE' && (
              <Button variant="danger" onClick={onArchive}>
                Archiver
              </Button>
            )}
          </>
        )}
      </CardActions>
    </Card>
  );
}

export function SeasonsPage() {
  const toast = useToast();
  const canManage = useMe().permissions.includes('seasons.manage');
  const [status, setStatus] = useState<SeasonStatus | ''>('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: seasons, isPending, isError, error, refetch } = useSeasons({
    status: status || undefined,
    includeArchived,
  });

  const [form, setForm] = useState<{ open: boolean; season?: Season }>({ open: false });
  const [pending, setPending] = useState<{ season?: Season; action?: SeasonAction }>({});
  const [toArchive, setToArchive] = useState<Season>();
  const archive = useArchiveSeason();

  const confirmArchive = async () => {
    if (!toArchive) return;
    try {
      await archive.mutateAsync({ id: toArchive.id, version: toArchive.version });
      toast('Saison archivée.');
      setToArchive(undefined);
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Saisons"
        subtitle="Découvrez les saisons du club, de l’historique à la prochaine."
        action={
          canManage ? (
            <Button variant="primary" onClick={() => setForm({ open: true })}>
              + Nouvelle saison
            </Button>
          ) : undefined
        }
      />

      <Filters>
        <FilterSelect label="Filtrer par statut" value={status} onChange={(e) => setStatus(e.target.value as SeasonStatus | '')}>
          <option value="">Tous les statuts</option>
          {(Object.keys(STATUS) as SeasonStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Saisons archivées"
          value={includeArchived ? 'all' : 'current'}
          onChange={(e) => setIncludeArchived(e.target.value === 'all')}
        >
          <option value="current">Sans les archivées</option>
          <option value="all">Avec les archivées</option>
        </FilterSelect>
        {seasons && (
          <Pill tone="b">
            {seasons.length} saison{seasons.length > 1 ? 's' : ''}
          </Pill>
        )}
      </Filters>

      <div className="mt-2.5">
        {isPending && <EmptyState>Chargement…</EmptyState>}
        {isError && (
          <EmptyState>
            <p className="mt-0">{errorMessage(error)}</p>
            <Button onClick={() => refetch()}>Réessayer</Button>
          </EmptyState>
        )}
        {seasons?.length === 0 && <EmptyState>Aucune saison.</EmptyState>}
        {seasons && seasons.length > 0 && (
          <CardGrid>
            {seasons.map((season) => (
              <SeasonCard
                key={season.id}
                season={season}
                onAction={(action) => setPending({ season, action })}
                onEdit={() => setForm({ open: true, season })}
                onArchive={() => setToArchive(season)}
                canManage={canManage}
              />
            ))}
          </CardGrid>
        )}
      </div>

      <Note>
        Une seule saison active (R2). Saison clôturée ou historique verrouillée ; réouverture par l’admin avec motif (R1).
        Suppression = <b>archivage</b> (R8).
      </Note>

      <SeasonFormModal open={form.open} season={form.season} onClose={() => setForm({ open: false })} />
      <SeasonStatusModal season={pending.season} action={pending.action} onClose={() => setPending({})} />
      <Modal
        open={Boolean(toArchive)}
        title="Archiver cette saison ?"
        onClose={() => setToArchive(undefined)}
        footer={
          <>
            <Button onClick={() => setToArchive(undefined)}>Annuler</Button>
            <Button variant="primary" data-primary onClick={confirmArchive} disabled={archive.isPending}>
              Archiver
            </Button>
          </>
        }
      >
        <p className="m-0 text-mut">
          La saison {toArchive?.label} sera archivée, pas supprimée (R8). Elle n’apparaîtra plus dans les listes.
        </p>
      </Modal>
    </>
  );
}
