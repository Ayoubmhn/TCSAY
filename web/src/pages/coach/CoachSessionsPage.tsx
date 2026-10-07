import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Calendar } from '../../components/ui/Calendar';
import { Card, CardActions, CardGrid, CardRow, CardSubtitle, CardText, EmptyState } from '../../components/ui/Card';
import { Filters, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { Segmented } from '../../components/ui/Segmented';
import { api } from '../../lib/api';
import { addDays, fD, todayIso } from '../../lib/format';
import type { AttendanceSheet, CoachSession, Group } from '../../lib/types';
import { useAction } from '../../lib/useAction';

/** Feuille de présence d'une séance (modale « Présences »). */
function AttendanceModal({ session, onClose }: { session?: CoachSession; onClose: () => void }) {
  const sheet = useQuery({
    queryKey: ['attendance', session?.groupId, session?.date],
    queryFn: () => api.get<AttendanceSheet>('/attendance', { groupId: session!.groupId, date: session!.date }),
    enabled: Boolean(session),
  });
  const [marks, setMarks] = useState<Record<string, { present: boolean; reason: string }>>({});
  useEffect(() => {
    if (sheet.data) {
      setMarks(
        Object.fromEntries(
          sheet.data.entries.map((e) => [e.playerId, { present: e.present !== false, reason: e.reason ?? '' }]),
        ),
      );
    }
  }, [sheet.data]);

  const save = useAction(
    () =>
      api.put('/attendance', {
        groupId: session!.groupId,
        date: session!.date,
        entries: Object.entries(marks).map(([playerId, m]) => ({ playerId, present: m.present, reason: m.reason || undefined })),
      }),
    { invalidate: [['sessions'], ['attendance']], success: 'Présences enregistrées.', onSuccess: onClose },
  );

  return (
    <Modal
      open={Boolean(session)}
      title="Présences"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={() => save.mutate()} disabled={save.isPending || !sheet.data}>
            Enregistrer
          </Button>
        </>
      }
    >
      {session && (
        <Pills>
          <Pill tone="s">{session.groupName}</Pill>
          <Pill tone="b">{fD(session.date)}</Pill>
          <Pill tone="b">{session.startTime}</Pill>
        </Pills>
      )}
      <QueryState isPending={sheet.isPending} error={sheet.error}>
        <div>
          {sheet.data?.entries.map((e) => {
            const m = marks[e.playerId] ?? { present: true, reason: '' };
            return (
              <div key={e.playerId} className="flex flex-col gap-2 border-b-[1.5px] border-line py-2.5 last:border-b-0">
                <div className="flex items-center justify-between gap-2.5">
                  <span>
                    {e.firstName} {e.lastName}
                  </span>
                  <Segmented
                    label={`Présence de ${e.firstName}`}
                    value={m.present ? 'P' : 'A'}
                    onChange={(v) => setMarks((x) => ({ ...x, [e.playerId]: { ...m, present: v === 'P' } }))}
                    options={[
                      { value: 'P', label: 'Présent' },
                      { value: 'A', label: 'Absent' },
                    ]}
                  />
                </div>
                {!m.present && (
                  <TextField
                    label="Motif d’absence (facultatif)"
                    value={m.reason}
                    onChange={(ev) => setMarks((x) => ({ ...x, [e.playerId]: { ...m, reason: ev.target.value } }))}
                  />
                )}
              </div>
            );
          })}
          {sheet.data?.entries.length === 0 && <span className="text-mut">Aucun joueur dans ce groupe.</span>}
        </div>
      </QueryState>
    </Modal>
  );
}

function SessionCard({ s, onAttendance }: { s: CoachSession; onAttendance: () => void }) {
  return (
    <Card>
      <CardRow>
        <h3>{s.groupName}</h3>
        {s.started ? <Pill tone={s.recorded ? 'g' : 's'}>{s.recorded ? 'Pointée' : 'Passée'}</Pill> : <Pill tone="g">Confirmée</Pill>}
      </CardRow>
      <Pills>
        <Pill tone="b">{fD(s.date)}</Pill>
        <Pill tone="b">
          {s.startTime} – {s.endTime}
        </Pill>
        {s.court && <Pill tone="g">{s.court.name}</Pill>}
      </Pills>
      <CardText>
        {s.membersCount} joueur{s.membersCount > 1 ? 's' : ''} · {s.category.name}
      </CardText>
      <CardActions>
        <Button onClick={onAttendance} disabled={!s.started} title={s.started ? undefined : 'Disponible le jour de la séance'}>
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
                <SessionCard key={s.groupId + s.date} s={s} onAttendance={() => setSheetFor(s)} />
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
                <SessionCard key={s.groupId + s.date} s={s} onAttendance={() => setSheetFor(s)} />
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
