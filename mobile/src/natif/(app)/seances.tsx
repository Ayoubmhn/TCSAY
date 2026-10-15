import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { KidSelect } from '../../components/KidSelect';
import { coachNames, ResolutionPill } from '../../components/parts';
import { DayStrip } from '../../components/DayStrip';
import { Card, CardRow, CardSubtitle, CardTitle, EmptyState, PageHeader, Pill, Pills, QueryState, Screen, Section, T } from '../../components/ui';
import { api } from '../../lib/api';
import { DAY_NAMES, fD, fDLong, todayIso } from '../../lib/format';
import type { PlayerSession, Slot } from '../../lib/types';

type Data = { groups: { id: string; name: string; slots: Slot[] }[]; sessions: PlayerSession[] };

function SessionCard({ s }: { s: PlayerSession }) {
  const status =
    s.change?.kind === 'POSTPONED' ? (
      <Pill tone="r">Reportée</Pill>
    ) : s.resolution === 'CANCELLED' ? (
      <Pill tone="r">Annulée</Pill>
    ) : !s.past ? (
      <Pill tone="g">Confirmée</Pill>
    ) : s.attendance === 'ABSENT' ? (
      <Pill tone="r">Absent</Pill>
    ) : s.attendance === 'LATE' ? (
      <Pill tone="b">En retard</Pill>
    ) : s.attendance === 'PRESENT' ? (
      <Pill tone="g">Présent</Pill>
    ) : (
      <Pill tone="s">Non pointé</Pill>
    );
  return (
    <Card>
      <CardRow>
        <CardTitle>{s.groupName}</CardTitle>
        {status}
      </CardRow>
      <Pills>
        <ResolutionPill resolution={s.resolution === 'CANCELLED' ? null : s.resolution} replacement={s.replacement} />
        <Pill tone="b">{fD(s.date)}</Pill>
        <Pill tone="b">{`${s.startTime} – ${s.endTime}`}</Pill>
        {s.court ? <Pill tone="g">{s.court.name}</Pill> : null}
        {s.change?.kind === 'MOVED' ? <Pill tone="s">Déplacée : terrain pris par un tournoi</Pill> : null}
      </Pills>
      {s.coaches.length > 0 && (
        <T mut size={13}>
          {coachNames(s.coaches)}
        </T>
      )}
    </Card>
  );
}

/** Mes séances (vSes) : 14 jours, séances à venir puis passées. */
export default function SessionsScreen() {
  const { playerId } = useAuth();
  const [day, setDay] = useState(todayIso());
  const q = useQuery({
    queryKey: ['sessions', 'player', playerId],
    queryFn: () => api.get<Data>('/sessions/player', { playerId }),
    enabled: Boolean(playerId),
  });
  const sessions = q.data?.sessions ?? [];
  const up = sessions.filter((s) => !s.past).slice(0, 8);
  const past = sessions.filter((s) => s.past).reverse().slice(0, 8);
  const daySessions = sessions.filter((s) => s.date === day);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <PageHeader title="Mes séances" subtitle="Découvrez vos entraînements à venir et passés." />
      <KidSelect />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {q.data && q.data.groups.length === 0 ? (
          <EmptyState>Aucun groupe d’entraînement pour ce joueur.</EmptyState>
        ) : (
          <>
            <Pills>
              {q.data?.groups.map((g) => (
                <Pill key={g.id} tone="s">
                  {`${g.name} · ${g.slots.map((x) => `${DAY_NAMES[x.day]} ${x.startTime}`).join(' · ') || 'créneaux à définir'}`}
                </Pill>
              ))}
            </Pills>
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
            <Section title="À venir">
              {up.length ? up.map((s) => <SessionCard key={s.slotId + s.date} s={s} />) : <EmptyState>Aucune séance à venir.</EmptyState>}
            </Section>
            <Section title="Passées">
              {past.length ? past.map((s) => <SessionCard key={s.slotId + s.date} s={s} />) : <EmptyState>Aucune séance passée.</EmptyState>}
            </Section>
          </>
        )}
      </QueryState>
    </Screen>
  );
}
