import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Dots } from '../../components/SessionReview';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { FilterSelect, Filters, TextArea, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { useMe } from '../../auth/AuthContext';
import { Section } from '../../components/ui/Section';
import { AlertList, useTechOverview } from '../admin/TechOverviewPage';
import { api } from '../../lib/api';
import type { Evaluation, EvaluationCriterion } from '../../lib/types';
import { useAction } from '../../lib/useAction';

type Criteria = { criteria: EvaluationCriterion[]; periods: { key: string; label: string }[] };
type GroupRow = { id: string; name: string; members: number };
type PlayerRow = {
  id: string;
  firstName: string;
  lastName: string;
  level: string | null;
  sessions: number;
  sessionsAverage: number | null;
  evaluation: Evaluation | null;
};
type GroupSheet = { group: { id: string; name: string }; period: string; players: PlayerRow[] };

const nb = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Période en cours selon le mois (T1 sept.–déc., T2 janv.–mars, T3 avr.–juin, été). */
function currentPeriod(): string {
  const m = new Date().getMonth() + 1;
  return m >= 9 ? 'T1' : m <= 3 ? 'T2' : m <= 6 ? 'T3' : 'ETE';
}

/**
 * Bilans de période : l'entraîneur (ses groupes) ou la direction technique rédige le bilan trimestriel de chaque joueur
 * dans une fenêtre dédiée ; la direction valide le niveau proposé.
 */
export function EvaluationsPage({ admin = false }: { admin?: boolean }) {
  const me = useMe();
  const canValidate = admin && me.permissions.includes('evaluations.manage');
  const meta = useQuery({ queryKey: ['evaluation-criteria'], queryFn: () => api.get<Criteria>('/evaluations/criteria') });
  const groups = useQuery({ queryKey: ['evaluation-groups'], queryFn: () => api.get<GroupRow[]>('/evaluations/groups') });
  const [groupId, setGroupId] = useState('');
  const [period, setPeriod] = useState(currentPeriod());
  const [view, setView] = useViewMode('bilans');
  const [editing, setEditing] = useState<PlayerRow>();
  const gid = groupId || groups.data?.[0]?.id || '';
  const sheet = useQuery({
    queryKey: ['evaluation-group', gid, period],
    queryFn: () => api.get<GroupSheet>('/evaluations/group', { groupId: gid, period }),
    enabled: Boolean(gid),
  });
  const validate = useAction((id: string) => api.post<{ level: string }>(`/evaluations/${id}/validate-level`), {
    invalidate: [['evaluation-group']],
    success: (r) => `Niveau ${r.level} validé.`,
  });
  const overview = useTechOverview();
  const alerts = !admin ? (overview.data?.alerts ?? []) : [];
  const players = sheet.data?.players ?? [];
  const done = players.filter((p) => p.evaluation).length;

  return (
    <>
      <PageHeader
        title="Bilans des joueurs"
        subtitle="Découvrez et rédigez le bilan de chaque joueur pour la période."
        action={<ViewToggle value={view} onChange={setView} />}
      />
      {alerts.length > 0 && (
        <Section title={`Joueurs à suivre · ${alerts.length}`}>
          <AlertList alerts={alerts} linkPlayers={false} />
        </Section>
      )}
      <Filters>
        <FilterSelect label="Groupe" value={gid} onChange={(e) => setGroupId(e.target.value)}>
          {(groups.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.members})
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Période" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {(meta.data?.periods ?? []).map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </FilterSelect>
        {sheet.data && <Pill tone={done === players.length && done > 0 ? 'g' : 's'}>{done}/{players.length} bilan(s)</Pill>}
      </Filters>
      <div className="mt-2.5">
        <QueryState isPending={groups.isPending || (Boolean(gid) && sheet.isPending)} error={groups.error ?? sheet.error} refetch={sheet.refetch}>
          {!gid ? (
            <EmptyState>Aucun groupe.</EmptyState>
          ) : players.length ? (
            <CardGrid list={view === 'list'}>
              {players.map((p) => {
                const e = p.evaluation;
                return (
                  <Card key={p.id}>
                    <CardRow>
                      <h3>
                        {p.firstName} {p.lastName}
                      </h3>
                    </CardRow>
                    <Pills>
                      {p.level ? <Pill tone="s">Niveau {p.level}</Pill> : <Pill tone="s">Niveau à définir</Pill>}
                      {p.sessionsAverage !== null && (
                        <Pill tone="b">
                          Séances {nb(p.sessionsAverage)}/5 ({p.sessions})
                        </Pill>
                      )}
                      {e ? <Pill tone="g">Bilan {e.average !== null ? `${nb(e.average)}/5` : 'rédigé'}</Pill> : <Pill tone="r">Bilan à faire</Pill>}
                      {e?.proposedLevel && !e.levelValidated && <Pill tone="s">Niveau proposé {e.proposedLevel}</Pill>}
                      {e?.shared && <Pill tone="b">Partagé</Pill>}
                    </Pills>
                    {e?.goals && <CardText>Objectifs : {e.goals}</CardText>}
                    <CardActions>
                      <ActionIcon kind={e ? 'edit' : 'add'} label={e ? 'Modifier le bilan' : 'Rédiger le bilan'} onClick={() => setEditing(p)} />
                      {canValidate && e?.proposedLevel && !e.levelValidated && (
                        <ActionIcon kind="check" label={`Valider le niveau ${e.proposedLevel}`} primary onClick={() => validate.mutate(e.id)} disabled={validate.isPending} />
                      )}
                    </CardActions>
                  </Card>
                );
              })}
            </CardGrid>
          ) : (
            <EmptyState>Aucun joueur dans ce groupe.</EmptyState>
          )}
        </QueryState>
      </div>
      <Note>
        Bilan noté de 1 à 5 (critère vide = non évalué) ; un point fort, un point à travailler et des objectifs pour la période
        suivante. Le niveau proposé n’est appliqué qu’après validation par la direction technique. « Partager » le rend visible
        au parent et au joueur.
      </Note>
      {editing && meta.data && sheet.data && (
        <EvaluationModal
          player={editing}
          period={period}
          periodLabel={meta.data.periods.find((p) => p.key === period)?.label ?? period}
          criteria={meta.data.criteria}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}

/** Fenêtre du bilan d'un joueur : critères par famille, commentaires, niveau proposé, partage. */
function EvaluationModal({
  player,
  period,
  periodLabel,
  criteria,
  onClose,
}: {
  player: PlayerRow;
  period: string;
  periodLabel: string;
  criteria: EvaluationCriterion[];
  onClose: () => void;
}) {
  const e = player.evaluation;
  const [scores, setScores] = useState<Record<string, number>>(e?.scores ?? {});
  const [strengths, setStrengths] = useState(e?.strengths ?? '');
  const [toWork, setToWork] = useState(e?.toWork ?? '');
  const [goals, setGoals] = useState(e?.goals ?? '');
  const [level, setLevel] = useState(e?.proposedLevel ?? player.level ?? '');
  const [shared, setShared] = useState(e?.shared ?? true);
  useEffect(() => setScores(e?.scores ?? {}), [e?.scores]);

  const save = useAction(
    () =>
      api.put<{ average: number }>('/evaluations', {
        playerId: player.id,
        period,
        scores,
        strengths: strengths.trim() || undefined,
        toWork: toWork.trim() || undefined,
        goals: goals.trim() || undefined,
        proposedLevel: level.trim() || undefined,
        shared,
      }),
    { invalidate: [['evaluation-group'], ['progress']], success: 'Bilan enregistré.', onSuccess: onClose },
  );
  const families = [...new Set(criteria.map((c) => c.family))];
  const rated = Object.keys(scores).length;

  return (
    <Modal
      open
      size="xl"
      title={`Bilan · ${player.firstName} ${player.lastName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={() => save.mutate()} disabled={!rated || save.isPending}>
            Enregistrer le bilan
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Pills>
          <Pill tone="b">{periodLabel}</Pill>
          {player.sessionsAverage !== null && (
            <Pill tone="b">
              Moyenne des séances {nb(player.sessionsAverage)}/5 ({player.sessions})
            </Pill>
          )}
          <Pill tone={rated ? 'g' : 's'}>
            {rated}/{criteria.length} critère(s) notés
          </Pill>
        </Pills>
        <div className="grid grid-cols-1 gap-3.5 min-[761px]:grid-cols-2">
          {families.map((f) => (
            <div key={f} className="flex flex-col gap-2 rounded-[20px] border-[1.5px] border-line p-3.5">
              <h3>{f}</h3>
              {criteria
                .filter((c) => c.family === f)
                .map((c) => (
                  <div key={c.key} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-mut">{c.label}</span>
                    <Dots
                      label={c.label}
                      value={scores[c.key] ?? 0}
                      disabled={false}
                      onChange={(v) =>
                        setScores((s) => {
                          const next = { ...s };
                          if (next[c.key] === v) delete next[c.key];
                          else next[c.key] = v;
                          return next;
                        })
                      }
                    />
                  </div>
                ))}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-2">
          <TextArea label="Point fort" value={strengths} maxLength={500} onChange={(ev) => setStrengths(ev.target.value)} />
          <TextArea label="À travailler" value={toWork} maxLength={500} onChange={(ev) => setToWork(ev.target.value)} />
          <TextArea label="Objectifs de la période suivante" value={goals} maxLength={500} full onChange={(ev) => setGoals(ev.target.value)} />
          <TextField
            label={`Niveau proposé${player.level ? ` (actuel : ${player.level})` : ''}`}
            placeholder="ex. Orange 2"
            value={level}
            maxLength={40}
            onChange={(ev) => setLevel(ev.target.value)}
          />
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={shared} onChange={(ev) => setShared(ev.target.checked)} />
            Partager avec le parent et le joueur
          </label>
        </div>
        {e?.levelValidated && e.proposedLevel === level && <Pill tone="g">Niveau validé par {e.levelValidatedBy}</Pill>}
      </div>
    </Modal>
  );
}
