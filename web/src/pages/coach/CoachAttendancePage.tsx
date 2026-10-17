import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AttendanceSheetForm } from '../../components/AttendanceSheetForm';
import { SessionPlanForm, SessionReviewCard, useSessionReview } from '../../components/SessionReview';
import { ResolutionPill } from '../../components/SlotInfo';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { cachedAt, sessionOpenLocally } from '../../lib/offline-cache';
import { fD, todayIso } from '../../lib/format';
import type { CoachSession } from '../../lib/types';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { ActionIcon } from '../../components/ui/ActionIcon';

/** Objectif de la séance (chargé avec l'évaluation). */
function PlanCard({ slotId, date }: { slotId: string; date: string }) {
  const q = useSessionReview(slotId, date);
  return (
    <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
      {q.data && <SessionPlanForm review={q.data} />}
    </QueryState>
  );
}

/**
 * Présences (entraîneur) : les séances du jour, la séance en cours ouverte au pointage
 * (présent, en retard, absent). Les séances passées ne se pointent plus : la direction peut corriger.
 */
export function CoachAttendancePage() {
  const [view, setView] = useViewMode('presences');
  const today = todayIso();
  const q = useQuery({
    queryKey: ['sessions', 'coach', 'today', today],
    queryFn: () => api.get<CoachSession[]>('/sessions', { from: today, to: today }),
    refetchInterval: 60_000, // la séance en cours change avec l'heure
  });
  const [chosen, setChosen] = useState<string>();
  const [reviewed, setReviewed] = useState<string>();
  // Sans réseau : séances gardées sur l'appareil, séance en cours recalculée avec l'heure du téléphone.
  const offline = Boolean(cachedAt(q.data));
  const sessions = (q.data ?? []).map((s) => (offline ? { ...s, open: sessionOpenLocally(s.date, s.startTime, s.endTime) } : s));
  const current = sessions.filter((s) => s.open && s.resolution !== 'CANCELLED');
  const selected = sessions.find((s) => s.slotId === chosen) ?? current[0];
  const live = selected && selected.open && selected.resolution !== 'CANCELLED' ? selected : undefined;
  const toReview = sessions.find((s) => s.slotId === reviewed) ?? live;

  return (
    <>
      <PageHeader title="Présences" subtitle="Découvrez vos séances du jour et pointez la séance en cours." action={<ViewToggle value={view} onChange={setView} />} />
      <Pills className="mt-4">
        <Pill tone="b">{fD(today, { weekday: 'long', day: 'numeric', month: 'long' })}</Pill>
        {offline && <Pill tone="s">Hors connexion : pointage gardé puis envoyé au retour du réseau</Pill>}
      </Pills>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {live && (
          <Section title="Objectif de la séance">
            <Card>
              <PlanCard slotId={live.slotId} date={live.date} />
            </Card>
          </Section>
        )}

        <Section title="Séance en cours">
          {selected && selected.open && selected.resolution !== 'CANCELLED' ? (
            <Card>
              <CardRow>
                <h3>{selected.groupName}</h3>
                <Pill tone="g">En cours</Pill>
              </CardRow>
              <Pills>
                <Pill tone="b">
                  {selected.startTime} – {selected.endTime}
                </Pill>
                {selected.court && <Pill tone="g">{selected.court.name}</Pill>}
                {selected.replacing && <Pill tone="s">Vous remplacez un collègue</Pill>}
                <ResolutionPill resolution={selected.resolution} replacement={selected.replacement} />
              </Pills>
              <AttendanceSheetForm slotId={selected.slotId} date={selected.date} />
            </Card>
          ) : (
            <EmptyState>Pas de séance en cours : le pointage s’ouvre 15 minutes avant le début de la séance.</EmptyState>
          )}
        </Section>

        {toReview && (
          <Section title={`Évaluation de la séance · ${toReview.groupName} ${toReview.startTime}`}>
            <Card>
              <SessionReviewCard slotId={toReview.slotId} date={toReview.date} />
            </Card>
          </Section>
        )}

        <Section title="Séances du jour">
          {sessions.length ? (
            <CardGrid list={view === 'list'}>
              {sessions.map((s) => (
                <Card key={s.slotId + s.date}>
                  <CardRow>
                    <h3>{s.groupName}</h3>
                    {s.resolution === 'CANCELLED' ? (
                      <Pill tone="r">Annulée</Pill>
                    ) : s.open ? (
                      <Pill tone="g">En cours</Pill>
                    ) : s.started ? (
                      <Pill tone={s.recorded ? 'g' : 's'}>{s.recorded ? 'Pointée' : 'Terminée'}</Pill>
                    ) : (
                      <Pill tone="b">À venir</Pill>
                    )}
                  </CardRow>
                  <Pills>
                    <Pill tone="b">
                      {s.startTime} – {s.endTime}
                    </Pill>
                    {s.court && <Pill tone="g">{s.court.name}</Pill>}
                    {s.replacing && <Pill tone="s">Remplacement</Pill>}
                    {!s.replacing && <ResolutionPill resolution={s.resolution} replacement={s.replacement} />}
                  </Pills>
                  <CardText>
                    {s.membersCount} joueur{s.membersCount > 1 ? 's' : ''}
                  </CardText>
                  {s.resolution !== 'CANCELLED' && s.started && (
                    <CardActions>
                      {s.open && s.slotId !== selected?.slotId && <ActionIcon kind="attendance" label="Pointer cette séance" primary onClick={() => setChosen(s.slotId)} />}
                      {s.recorded && s.slotId !== toReview?.slotId && <ActionIcon kind="rate" label="Évaluer la séance" onClick={() => setReviewed(s.slotId)} />}
                    </CardActions>
                  )}
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucune séance aujourd’hui.</EmptyState>
          )}
        </Section>
      </QueryState>
      <Note>
        Le pointage n’est possible que pendant la séance en cours (de 15 minutes avant le début à 30 minutes après la fin).
        Une erreur sur une séance passée se corrige par la direction. L’évaluation (5 notes, forme du jour, commentaire pour
        le parent) se fait dans sa propre fenêtre, jusqu’au lendemain soir de la séance.
      </Note>
    </>
  );
}
