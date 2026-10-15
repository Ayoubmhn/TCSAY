import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { DayStrip } from '../../../components/DayStrip';
import { coachNames, ResolutionPill } from '../../../components/parts';
import { Button, Card, CardRow, CardSubtitle, CardTitle, EmptyState, PageHeader, Pill, Pills, QueryState, Screen, Section, T } from '../../../components/ui';
import { api } from '../../../lib/api';
import { addDays, fD, fDLong, todayIso } from '../../../lib/format';
import type { CoachSession } from '../../../lib/types';

function SessionCard({ s }: { s: CoachSession }) {
  return (
    <Card>
      <CardRow>
        <CardTitle>{s.groupName}</CardTitle>
        {s.resolution === 'CANCELLED' ? (
          <Pill tone="r">Annulée</Pill>
        ) : s.change?.kind === 'POSTPONED' ? (
          <Pill tone="r">Reportée</Pill>
        ) : s.open ? (
          <Pill tone="g">En cours</Pill>
        ) : s.started ? (
          <Pill tone={s.recorded ? 'g' : 's'}>{s.recorded ? 'Pointée' : 'Non pointée'}</Pill>
        ) : (
          <Pill tone="b">À venir</Pill>
        )}
      </CardRow>
      <Pills>
        <Pill tone="b">{fD(s.date)}</Pill>
        <Pill tone="b">{`${s.startTime} – ${s.endTime}`}</Pill>
        {s.court ? <Pill tone="g">{s.court.name}</Pill> : null}
        {s.replacing ? <Pill tone="s">Remplacement</Pill> : <ResolutionPill resolution={s.resolution === 'CANCELLED' ? null : s.resolution} replacement={s.replacement} />}
        {s.change?.kind === 'MOVED' ? <Pill tone="s">Déplacée (tournoi)</Pill> : null}
      </Pills>
      <T mut size={13}>
        {`${s.membersCount}/${s.capacity} joueurs${s.category ? ` · ${s.category}` : ''}${s.coaches.length > 1 ? ` · ${coachNames(s.coaches)}` : ''}`}
      </T>
      {s.open && s.resolution !== 'CANCELLED' && (
        <Button variant="primary" onPress={() => router.push('/coach/presences')}>
          Présences
        </Button>
      )}
    </Card>
  );
}

/** Mes séances (vCSes) : 14 jours, « À venir » puis « Passées » ; bouton Présences sur la séance en cours. */
export default function CoachSessionsScreen() {
  const today = todayIso();
  const [day, setDay] = useState(today);
  const q = useQuery({
    queryKey: ['sessions', 'coach', 'range', today],
    queryFn: () => api.get<CoachSession[]>('/sessions', { from: addDays(today, -14), to: addDays(today, 14) }),
  });
  const sessions = q.data ?? [];
  const up = sessions.filter((s) => s.date >= today && !(s.started && !s.open)).slice(0, 10);
  const past = sessions.filter((s) => s.started && !s.open).reverse().slice(0, 10);
  const daySessions = sessions.filter((s) => s.date === day);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <PageHeader title="Mes séances" subtitle="Découvrez vos séances à venir et passées." />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        <DayStrip value={day} onChange={setDay} dots={new Set(sessions.map((s) => s.date))} />
        <Card>
          <CardSubtitle>{fDLong(day)}</CardSubtitle>
          {daySessions.length ? (
            daySessions.map((s) => (
              <Pills key={s.slotId}>
                <Pill tone="s">{s.groupName}</Pill>
                <Pill tone="b">{`${s.startTime} – ${s.endTime}`}</Pill>
                {s.court ? <Pill tone="g">{s.court.name}</Pill> : null}
              </Pills>
            ))
          ) : (
            <T mut>Pas de séance ce jour.</T>
          )}
        </Card>
        <Section title="À venir">{up.length ? up.map((s) => <SessionCard key={s.slotId + s.date} s={s} />) : <EmptyState>Aucune séance à venir.</EmptyState>}</Section>
        <Section title="Passées">{past.length ? past.map((s) => <SessionCard key={s.slotId + s.date} s={s} />) : <EmptyState>Aucune séance passée.</EmptyState>}</Section>
      </QueryState>
    </Screen>
  );
}
