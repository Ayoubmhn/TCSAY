import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AttendanceSheetForm } from '../../components/AttendanceSheetForm';
import { CoachChip, ResolutionPill } from '../../components/SlotInfo';
import { Button } from '../../components/ui/Button';
import { Calendar } from '../../components/ui/Calendar';
import { Card, CardActions, CardGrid, CardRow, CardSubtitle, CardText, EmptyState } from '../../components/ui/Card';
import { Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { addDays, fD, todayIso } from '../../lib/format';
import type { CoachSession, Group } from '../../lib/types';

/** Feuille de présence d'une séance (modale « Présences »). */
function AttendanceModal({ session, onClose }: { session?: CoachSession; onClose: () => void }) {
  return (
    <Modal open={Boolean(session)} title="Présences" size="lg" onClose={onClose}>
      {session && (
        <>
          <Pills>
            <Pill tone="s">{session.groupName}</Pill>
            <Pill tone="b">{fD(session.date)}</Pill>
            <Pill tone="b">{session.startTime}</Pill>
          </Pills>
          <AttendanceSheetForm slotId={session.slotId} date={session.date} onSaved={onClose} />
        </>
      )}
    </Modal>
  );
}

function SessionCard({ s, onAttendance }: { s: CoachSession; onAttendance: () => void }) {
  return (
    <Card>
      <CardRow>
        <h3>{s.groupName}</h3>
        {s.resolution === 'CANCELLED' ? (
          <Pill tone="r">Annulée</Pill>
        ) : s.open ? (
          <Pill tone="g">En cours</Pill>
        ) : s.started ? (
          <Pill tone={s.recorded ? 'g' : 's'}>{s.recorded ? 'Pointée' : 'Passée'}</Pill>
        ) : (
          <Pill tone="g">Confirmée</Pill>
        )}
      </CardRow>
      <Pills>
        <Pill tone="b">{fD(s.date)}</Pill>
        <Pill tone="b">
          {s.startTime} – {s.endTime}
        </Pill>
        {s.court && <Pill tone="g">{s.court.name}</Pill>}
        {s.replacing ? <Pill tone="s">Vous remplacez</Pill> : <ResolutionPill resolution={s.resolution} replacement={s.replacement} />}
      </Pills>
      <CardText>
        {s.membersCount} joueur{s.membersCount > 1 ? 's' : ''}
        {s.category ? ` · ${s.category}` : ''}
      </CardText>
      {s.coaches.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {s.coaches.map((c) => (
            <CoachChip key={c.id} coach={c} />
          ))}
        </div>
      )}
      <CardActions>
        <Button
          onClick={onAttendance}
          disabled={!s.started || s.resolution === 'CANCELLED'}
          title={s.open ? undefined : 'Pointage pendant la séance en cours seulement'}
        >
          Présences
        </Button>
      </CardActions>
    </Card>
  );
}

/** Mes séances coach (vCSes) : calendrier, à venir, passées, pointage. */
export function CoachSessionsPage() {
  const [day, setDay] = useState(todayIso());
  const [sheetFor, setSheetFor] = useState<CoachSession>();
  const groups = useQuery({ queryKey: ['groups', 'coach'], queryFn: () => api.get<Group[]>('/groups') });
  const sessions = useQuery({
    queryKey: ['sessions', 'coach'],
    queryFn: () => api.get<CoachSession[]>('/sessions', { from: addDays(todayIso(), -14), to: addDays(todayIso(), 14) }),
  });
  const all = sessions.data ?? [];
  const up = all.filter((s) => !s.started).slice(0, 8);
  const past = all.filter((s) => s.started).reverse().slice(0, 8);
  const daySessions = all.filter((s) => s.date === day);

  return (
    <>
      <PageHeader title="Mes séances" subtitle="Découvrez vos groupes et pointez les présences." />
      <Filters>
        {groups.data?.map((g) => (
          <Pill key={g.id} tone="s">
            {g.name} · {g.members.length}/{g.capacity}
          </Pill>
        ))}
      </Filters>
      <QueryState isPending={sessions.isPending} error={sessions.error} refetch={sessions.refetch}>
        <div className="mt-2.5 grid grid-cols-1 items-start gap-4 min-[1101px]:grid-cols-[minmax(0,1fr)_300px]">
          <Calendar dots={new Set(all.map((s) => s.date))} value={day} onChange={setDay} />
          <Card>
            <CardSubtitle>{fD(day, { weekday: 'long', day: 'numeric', month: 'long' })}</CardSubtitle>
            {daySessions.length ? (
              daySessions.map((s) => (
                <div key={s.slotId} className="flex flex-col gap-2.5">
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
                <SessionCard key={s.slotId + s.date} s={s} onAttendance={() => setSheetFor(s)} />
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
                <SessionCard key={s.slotId + s.date} s={s} onAttendance={() => setSheetFor(s)} />
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucune séance passée.</EmptyState>
          )}
        </Section>
      </QueryState>
      <AttendanceModal session={sheetFor} onClose={() => setSheetFor(undefined)} />
    </>
  );
}
