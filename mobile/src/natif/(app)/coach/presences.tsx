import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ResolutionPill } from '../../../components/parts';
import { Button, Card, CardRow, CardTitle, Divider, EmptyState, Field, Note, PageHeader, Pill, Pills, QueryState, Screen, Section, Segmented, T } from '../../../components/ui';
import { api } from '../../../lib/api';
import { clock, fDLong, todayIso } from '../../../lib/format';
import type { AttendanceSheet, AttendanceStatus, CoachSession } from '../../../lib/types';
import { useAction } from '../../../lib/useAction';

type Mark = { status: AttendanceStatus; reason: string };

/** Feuille de présence : présent, en retard ou absent pour chaque joueur ; enregistrable pendant la séance en cours. */
function Sheet({ slotId, date }: { slotId: string; date: string }) {
  const sheet = useQuery({ queryKey: ['attendance', slotId, date], queryFn: () => api.get<AttendanceSheet>('/attendance', { slotId, date }) });
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  useEffect(() => {
    if (sheet.data) setMarks(Object.fromEntries(sheet.data.entries.map((e) => [e.playerId, { status: e.status ?? 'PRESENT', reason: e.reason ?? '' }])));
  }, [sheet.data]);
  const save = useAction(
    () =>
      api.put('/attendance', {
        slotId,
        date,
        entries: Object.entries(marks).map(([playerId, m]) => ({ playerId, status: m.status, reason: m.reason.trim() || undefined })),
      }),
    { invalidate: [['sessions'], ['attendance']], success: 'Présences enregistrées.' },
  );
  const d = sheet.data;
  const count = (st: AttendanceStatus) => Object.values(marks).filter((m) => m.status === st).length;

  return (
    <QueryState isPending={sheet.isPending} error={sheet.error} refetch={sheet.refetch}>
      {d && (
        <View style={{ gap: 10 }}>
          <Pills>
            {d.editable ? (
              <Pill tone="g">Pointage ouvert jusqu’à {clock(d.closesAt)}</Pill>
            ) : new Date(d.opensAt) > new Date() ? (
              <Pill tone="s">Pointage à partir de {clock(d.opensAt)}</Pill>
            ) : (
              <Pill tone="r">Pointage fermé depuis {clock(d.closesAt)}</Pill>
            )}
            <Pill tone="g">{`${count('PRESENT')} présent(s)`}</Pill>
            <Pill tone="b">{`${count('LATE')} en retard`}</Pill>
            <Pill tone="r">{`${count('ABSENT')} absent(s)`}</Pill>
          </Pills>
          {d.entries.map((e, i) => {
            const m = marks[e.playerId] ?? { status: 'PRESENT' as AttendanceStatus, reason: '' };
            const set = (patch: Partial<Mark>) => setMarks((x) => ({ ...x, [e.playerId]: { ...m, ...patch } }));
            return (
              <View key={e.playerId} style={{ gap: 8 }}>
                {i > 0 && <Divider />}
                <T w="medium">{`${e.firstName} ${e.lastName}`}</T>
                <Segmented<AttendanceStatus>
                  label={`Présence de ${e.firstName}`}
                  value={m.status}
                  disabled={!d.editable}
                  onChange={(status) => set({ status })}
                  options={[
                    { value: 'PRESENT', label: 'Présent' },
                    { value: 'LATE', label: 'Retard' },
                    { value: 'ABSENT', label: 'Absent' },
                  ]}
                />
                {m.status !== 'PRESENT' && (
                  <Field
                    label={m.status === 'LATE' ? 'Retard : précision (facultatif)' : 'Motif d’absence (facultatif)'}
                    value={m.reason}
                    editable={d.editable}
                    onChangeText={(reason) => set({ reason })}
                  />
                )}
              </View>
            );
          })}
          {d.entries.length === 0 && <T mut>Aucun joueur dans ce groupe.</T>}
          {d.editable && d.entries.length > 0 && (
            <Button variant="primary" full onPress={() => save.mutate()} loading={save.isPending}>
              Enregistrer les présences
            </Button>
          )}
        </View>
      )}
    </QueryState>
  );
}

/** Présences (entraîneur) : séances du jour, séance en cours ouverte au pointage. */
export default function CoachAttendanceScreen() {
  const today = todayIso();
  const q = useQuery({
    queryKey: ['sessions', 'coach', 'today', today],
    queryFn: () => api.get<CoachSession[]>('/sessions', { from: today, to: today }),
    refetchInterval: 60_000,
  });
  const [chosen, setChosen] = useState<string>();
  const sessions = q.data ?? [];
  const current = sessions.filter((s) => s.open && s.resolution !== 'CANCELLED');
  const selected = sessions.find((s) => s.slotId === chosen) ?? current[0];
  const live = selected && selected.open && selected.resolution !== 'CANCELLED' ? selected : undefined;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <PageHeader title="Présences" subtitle="Découvrez vos séances du jour et pointez la séance en cours." />
      <Pills>
        <Pill tone="b">{fDLong(today)}</Pill>
      </Pills>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        <Section title="Séance en cours">
          {live ? (
            <Card>
              <CardRow>
                <CardTitle>{live.groupName}</CardTitle>
                <Pill tone="g">En cours</Pill>
              </CardRow>
              <Pills>
                <Pill tone="b">{`${live.startTime} – ${live.endTime}`}</Pill>
                {live.court ? <Pill tone="g">{live.court.name}</Pill> : null}
                {live.replacing ? <Pill tone="s">Vous remplacez un collègue</Pill> : null}
                <ResolutionPill resolution={live.resolution} replacement={live.replacement} />
              </Pills>
              <Sheet slotId={live.slotId} date={live.date} />
            </Card>
          ) : (
            <EmptyState>Pas de séance en cours : le pointage s’ouvre 15 minutes avant le début de la séance.</EmptyState>
          )}
        </Section>
        <Section title="Séances du jour">
          {sessions.length ? (
            sessions.map((s) => (
              <Card key={s.slotId + s.date} onPress={s.open && s.slotId !== live?.slotId ? () => setChosen(s.slotId) : undefined}>
                <CardRow>
                  <CardTitle>{s.groupName}</CardTitle>
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
                  <Pill tone="b">{`${s.startTime} – ${s.endTime}`}</Pill>
                  {s.court ? <Pill tone="g">{s.court.name}</Pill> : null}
                </Pills>
                <T mut size={13}>{`${s.membersCount} joueur${s.membersCount > 1 ? 's' : ''}`}</T>
              </Card>
            ))
          ) : (
            <EmptyState>Aucune séance aujourd’hui.</EmptyState>
          )}
        </Section>
      </QueryState>
      <Note>
        Le pointage n’est possible que pendant la séance en cours (de 15 minutes avant le début à 30 minutes après la fin). Une erreur sur une séance passée
        se corrige par la direction.
      </Note>
    </Screen>
  );
}
