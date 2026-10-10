import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AttendanceSheetForm } from '../../components/AttendanceSheetForm';
import { ResolutionPill } from '../../components/SlotInfo';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { fD, todayIso } from '../../lib/format';
import type { CoachSession } from '../../lib/types';

/**
 * Présences (entraîneur) : les séances du jour, la séance en cours ouverte au pointage
 * (présent, en retard, absent). Les séances passées ne se pointent plus : la direction peut corriger.
 */
export function CoachAttendancePage() {
  const today = todayIso();
  const q = useQuery({
    queryKey: ['sessions', 'coach', 'today', today],
    queryFn: () => api.get<CoachSession[]>('/sessions', { from: today, to: today }),
    refetchInterval: 60_000, // la séance en cours change avec l'heure
  });
  const [chosen, setChosen] = useState<string>();
  const sessions = q.data ?? [];
  const current = sessions.filter((s) => s.open && s.resolution !== 'CANCELLED');
  const selected = sessions.find((s) => s.slotId === chosen) ?? current[0];

  return (
    <>
      <PageHeader title="Présences" subtitle="Découvrez vos séances du jour et pointez la séance en cours." />
      <Pills className="mt-4">
        <Pill tone="b">{fD(today, { weekday: 'long', day: 'numeric', month: 'long' })}</Pill>
      </Pills>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
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

        <Section title="Séances du jour">
          {sessions.length ? (
            <CardGrid>
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
                  {s.open && s.resolution !== 'CANCELLED' && s.slotId !== selected?.slotId && (
                    <CardActions>
                      <Button onClick={() => setChosen(s.slotId)}>Pointer cette séance</Button>
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
        Une erreur sur une séance passée se corrige par la direction.
      </Note>
    </>
  );
}
