import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardGrid, CardSubtitle, CardTitle } from '../../components/ui/Card';
import { FilterSelect } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, type PillTone } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import {
  LOCKED_STATUSES,
  STATUS_LABEL,
  TRANSITIONS,
  useArchiveSeason,
  useSeasons,
  type Season,
  type SeasonStatus,
} from './api';
import { SeasonFormModal } from './SeasonFormModal';
import { SeasonStatusModal, statusActionLabel } from './SeasonStatusModal';

const STATUS_TONE: Record<SeasonStatus, PillTone> = {
  ACTIVE: 'green',
  DRAFT: 'sand',
  CLOSED: 'blue',
  HISTORICAL: 'blue',
};

function SeasonCard({
  season,
  onEdit,
  onStatus,
  onArchive,
}: {
  season: Season;
  onEdit: () => void;
  onStatus: (to: SeasonStatus) => void;
  onArchive: () => void;
}) {
  const archived = Boolean(season.archivedAt);
  const locked = LOCKED_STATUSES.includes(season.status);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>Saison {season.label}</CardTitle>
          <CardSubtitle>{locked ? 'Verrouillée' : 'Modifiable'}</CardSubtitle>
        </div>
        {archived ? <Pill tone="rose">Archivée</Pill> : <Pill tone={STATUS_TONE[season.status]}>{STATUS_LABEL[season.status]}</Pill>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Pill tone="blue">Du {formatDate(season.startDate)}</Pill>
        <Pill tone="blue">Au {formatDate(season.endDate)}</Pill>
      </div>

      {!archived && (
        <div className="mt-auto flex flex-wrap gap-2">
          {TRANSITIONS[season.status].map((to) => (
            <Button key={to} variant={to === 'ACTIVE' ? 'primary' : 'secondary'} onClick={() => onStatus(to)} className="px-4 py-2">
              {statusActionLabel(season.status, to)}
            </Button>
          ))}
          {!locked && (
            <Button onClick={onEdit} className="px-4 py-2">
              Modifier
            </Button>
          )}
          {season.status !== 'ACTIVE' && (
            <Button variant="ghost" onClick={onArchive} className="px-4 py-2">
              Archiver
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export function SeasonsPage() {
  const toast = useToast();
  const [status, setStatus] = useState<SeasonStatus | ''>('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: seasons, isPending, isError, error, refetch } = useSeasons({
    status: status || undefined,
    includeArchived,
  });

  const [form, setForm] = useState<{ open: boolean; season?: Season }>({ open: false });
  const [statusChange, setStatusChange] = useState<{ season?: Season; target?: SeasonStatus }>({});
  const [toArchive, setToArchive] = useState<Season>();
  const archive = useArchiveSeason();

  const confirmArchive = async () => {
    if (!toArchive) return;
    try {
      await archive.mutateAsync({ id: toArchive.id, version: toArchive.version });
      toast(`Saison ${toArchive.label} archivée.`);
      setToArchive(undefined);
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Saisons"
        subtitle="Découvrez vos saisons"
        action={
          <Button variant="primary" onClick={() => setForm({ open: true })}>
            Nouvelle saison
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect label="Filtrer par statut" value={status} onChange={(e) => setStatus(e.target.value as SeasonStatus | '')}>
          <option value="">Tous les statuts</option>
          {(Object.keys(STATUS_LABEL) as SeasonStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
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
          <span className="text-sm text-mut">
            {seasons.length} saison{seasons.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {isPending && <p className="text-mut">Chargement…</p>}

      {isError && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{errorMessage(error)}</p>
          <Button onClick={() => refetch()}>Réessayer</Button>
        </Card>
      )}

      {seasons?.length === 0 && (
        <Card className="text-center">
          <CardTitle>Aucune saison</CardTitle>
          <p className="mt-1 text-sm text-mut">Créez la première saison du club.</p>
        </Card>
      )}

      {seasons && seasons.length > 0 && (
        <CardGrid>
          {seasons.map((season) => (
            <SeasonCard
              key={season.id}
              season={season}
              onEdit={() => setForm({ open: true, season })}
              onStatus={(target) => setStatusChange({ season, target })}
              onArchive={() => setToArchive(season)}
            />
          ))}
        </CardGrid>
      )}

      <Note>
        Une seule saison peut être active à la fois. Une saison clôturée ou historique est verrouillée : sa réouverture
        exige un motif. Supprimer une saison l’archive, ses données restent conservées.
      </Note>

      <SeasonFormModal open={form.open} season={form.season} onClose={() => setForm({ open: false })} />
      <SeasonStatusModal season={statusChange.season} target={statusChange.target} onClose={() => setStatusChange({})} />
      <Modal
        open={Boolean(toArchive)}
        title={`Archiver la saison ${toArchive?.label ?? ''} ?`}
        onClose={() => setToArchive(undefined)}
        footer={
          <>
            <Button onClick={() => setToArchive(undefined)}>Annuler</Button>
            <Button variant="primary" onClick={confirmArchive} disabled={archive.isPending}>
              Archiver
            </Button>
          </>
        }
      >
        <p className="text-sm text-mut">La saison n’apparaîtra plus dans les listes. Ses données sont conservées.</p>
      </Modal>
    </>
  );
}
