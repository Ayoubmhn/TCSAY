import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { KidSelect } from '../../components/KidSelect';
import { Calendar } from '../../components/ui/Calendar';
import { Card, CardGrid, CardRow, CardSubtitle, CardText, EmptyState } from '../../components/ui/Card';
import { Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { DAY_NAMES, fD, todayIso } from '../../lib/format';
import type { PlayerSession } from '../../lib/types';

type Data = {
  groups: { id: string; name: string; days: number[]; startTime: string; endTime: string }[];
  sessions: PlayerSession[];
};

function SessionCard({ s }: { s: PlayerSession }) {
  const status = !s.past ? (
    <Pill tone="g">Confirmée</Pill>
  ) : s.attendance === 'ABSENT' ? (
    <Pill tone="r">Absent</Pill>
  ) : s.attendance === 'PRESENT' ? (
    <Pill tone="g">Présent</Pill>
  ) : (
    <Pill tone="s">Non pointé</Pill>
  );
  return (
    <Card>
      <CardRow>
        <h3>{s.groupName}</h3>
        {status}
      </CardRow>
      <Pills>
        <Pill tone="b">{fD(s.date)}</Pill>
        <Pill tone="b">
          {s.startTime} – {s.endTime}
        </Pill>
        {s.court && <Pill tone="g">{s.court.name}</Pill>}
      </Pills>
      {s.coach && (
        <CardText>
          Coach {s.coach.firstName} {s.coach.lastName}
        </CardText>
      )}
    </Card>
  );
}

/** Mes séances (vSes) : calendrier, séances à venir puis passées. */
export function SessionsPage() {
  const { playerId } = useAuth();
  const [day, setDay] = useState(todayIso());
  const q = useQuery({
    queryKey: ['sessions', 'player', playerId],
    queryFn: () => api.get<Data>('/sessions/player', { playerId }),
    enabled: Boolean(playerId),
  });
  const sessions = q.data?.sessions ?? [];
  const up = sessions.filter((s) => !s.past).slice(0, 6);
  const past = sessions.filter((s) => s.past).reverse().slice(0, 6);
  const daySessions = sessions.filter((s) => s.date === day);

  return (
    <>
      <PageHeader title="Mes séances" subtitle="Découvrez vos entraînements à venir et passés." />
      <Filters>
        <KidSelect />
        {q.data?.groups.map((g) => (
          <span key={g.id} className="contents">
            <Pill tone="s">{g.name}</Pill>
            <Pill tone="b">
              {g.days.map((d) => DAY_NAMES[d]).join(' & ')} · {g.startTime}
            </Pill>
          </span>
        ))}
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {q.data && q.data.groups.length === 0 ? (
          <EmptyState>Aucun groupe d’entraînement pour ce joueur.</EmptyState>
        ) : (
          <>
            <div className="mt-2.5 grid grid-cols-1 items-start gap-4 min-[1101px]:grid-cols-[minmax(0,1fr)_300px]">
              <Calendar dots={new Set(sessions.map((s) => s.date))} value={day} onChange={setDay} />
              <Card>
                <CardSubtitle>{fD(day, { weekday: 'long', day: 'numeric', month: 'long' })}</CardSubtitle>
                {daySessions.length ? (
                  daySessions.map((s) => (
                    <div key={s.groupId} className="flex flex-col gap-2.5">
                      <h3>{s.groupName}</h3>
                      <Pills>
                        <Pill tone="b">
                          {s.startTime} – {s.endTime}
                        </Pill>
                        {s.court && <Pill tone="g">{s.court.name}</Pill>}
                      </Pills>
                    </div>
                  ))
                ) : (
                  <span className="text-mut">Pas de séance ce jour.</span>
                )}
              </Card>
            </div>
            <Section title="À venir">
              {up.length ? (
                <CardGrid>
                  {up.map((s) => (
                    <SessionCard key={s.groupId + s.date} s={s} />
                  ))}
                </CardGrid>
              ) : (
                <EmptyState>Aucune séance à venir.</EmptyState>
              )}
            </Section>
            <Section title="Passées">
              {past.length ? (
                <CardGrid>
                  {past.map((s) => (
                    <SessionCard key={s.groupId + s.date} s={s} />
                  ))}
                </CardGrid>
              ) : (
                <EmptyState>Aucune séance passée.</EmptyState>
              )}
            </Section>
          </>
        )}
      </QueryState>
    </>
  );
}
