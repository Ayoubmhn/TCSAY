import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAuth, useMe } from '../../auth/AuthContext';
import { api } from '../../lib/api';
import { addDays, DT, fD, fullName, todayIso } from '../../lib/format';
import type { CourtRate, Grid, Player, Reservation, Settings, SlotState } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { DayStrip } from '../DayStrip';
import { KidSelect } from '../KidSelect';
import { useToast } from '../Toast';
import { Button, Card, CardRow, CardTitle, Confirm, EmptyState, Kpi, Note, PageHeader, Pill, Pills, QueryState, Screen, Section, Select, T } from '../ui';
import { BookingGrid, durationText, hhmm, type Pick } from './BookingGrid';

const BLOCKED: Partial<Record<SlotState, string>> = {
  short: 'Une réservation dure au moins une heure : la demi-heure suivante est occupée. Commencez plus tôt, puis prolongez jusqu’ici.',
  unlit: 'Ce terrain n’est pas éclairé : réservation impossible la nuit.',
  maintenance: 'Terrain en entretien.',
  past: 'Créneau passé : modification impossible (R10).',
  taken: 'Créneau déjà pris : pas de double réservation.',
  group: 'Créneau réservé à un groupe d’entraînement.',
  mine: 'Vous avez déjà réservé ce créneau.',
};

function Line({ label, children }: { label: string; children: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 }}>
      <T mut size={14}>
        {label}
      </T>
      <T w="medium" size={14} style={{ flexShrink: 1, textAlign: 'right' }}>
        {children}
      </T>
    </View>
  );
}

/**
 * Réserver un terrain (vBook) : loisir pour joueur / parent, séance privée avec un élève pour l'entraîneur.
 * Partagé par `/reserver` et `/coach/reserver`. Prix au prorata jour / nuit d'après les tarifs de l'API.
 */
export function BookScreen({ coach }: { coach: boolean }) {
  const me = useMe();
  const { playerId: kidId } = useAuth();
  const toast = useToast();
  const type = coach ? 'PRIVATE' : 'LEISURE';
  const typeLabel = coach ? 'Séance privée' : 'Loisir';

  const [day, setDay] = useState(addDays(todayIso(), 1));
  const [pick, setPick] = useState<Pick | null>(null);
  const [student, setStudent] = useState<string>();
  const [toCancel, setToCancel] = useState<Reservation>();
  const playerId = coach ? undefined : kidId;

  const students = useQuery({
    queryKey: ['players', 'coach'],
    queryFn: () => api.get<Player[]>('/players'),
    enabled: coach,
  });
  useEffect(() => {
    if (coach && !student && students.data?.length) setStudent(students.data[0].id);
  }, [coach, student, students.data]);

  const grid = useQuery({
    queryKey: ['grid', day, playerId],
    queryFn: () => api.get<Grid>('/reservations/grid', { date: day, playerId }),
  });
  const rates = useQuery({ queryKey: ['court-rates'], queryFn: () => api.get<CourtRate[]>('/court-rates') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
  const mine = useQuery({
    queryKey: ['reservations', 'mine', playerId],
    queryFn: () => api.get<Reservation[]>('/reservations/mine', { playerId }),
  });

  useEffect(() => setPick(null), [day, playerId]);

  // Durée choisie (1 h au moins), prix au prorata jour / nuit (ex. 17:30–19:00 : 30 min de jour + 1 h de nuit).
  const nightHour = settings.data?.nightStartHour ?? grid.data?.nightStartHour ?? 18;
  const nightStart = nightHour * 60;
  const duration = pick ? pick.end - pick.start : 0;
  const nightMinutes = pick ? Math.max(0, pick.end - Math.max(pick.start, nightStart)) : 0;
  const rateOf = (period: 'DAY' | 'NIGHT') => rates.data?.find((r) => r.type === type && r.period === period)?.pricePerHour;
  const price = (() => {
    if (!pick) return undefined;
    const dayRate = rateOf('DAY');
    const nightRate = rateOf('NIGHT');
    if ((nightMinutes < duration && dayRate === undefined) || (nightMinutes > 0 && nightRate === undefined)) return undefined;
    return Math.round((((duration - nightMinutes) * (dayRate ?? 0)) / 60 + (nightMinutes * (nightRate ?? 0)) / 60) * 1000) / 1000;
  })();
  const periodLabel = nightMinutes === 0 ? 'Jour' : nightMinutes === duration ? 'Nuit ☾' : 'Jour et nuit ☾ (prix au prorata)';
  const court = pick ? grid.data?.courts.find((c) => c.id === pick.courtId) : undefined;

  const reserve = useAction(
    () =>
      api.post<Reservation>('/reservations', {
        courtId: pick!.courtId,
        date: day,
        time: hhmm(pick!.start),
        duration: pick!.end - pick!.start,
        playerId: coach ? student : playerId,
      }),
    {
      invalidate: [['grid'], ['reservations'], ['overview']],
      success: (r) => `Réservation confirmée : ${r.court.name}, ${fD(r.date)} de ${r.time} à ${r.endTimeLabel}.`,
      onSuccess: () => setPick(null),
    },
  );
  const cancel = useAction((id: string) => api.post(`/reservations/${id}/cancel`), {
    invalidate: [['grid'], ['reservations'], ['overview']],
    success: 'Réservation annulée.',
    onSuccess: () => setToCancel(undefined),
  });

  const studentRow = students.data?.find((s) => s.id === student);
  const kid = me.players.find((p) => p.id === kidId);
  const isParent = me.space === 'parent';
  const now = Date.now();
  const refreshing = grid.isRefetching || mine.isRefetching;

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        void grid.refetch();
        void mine.refetch();
        void rates.refetch();
        void settings.refetch();
        if (coach) void students.refetch();
      }}
    >
      <PageHeader
        title="Réserver un terrain"
        subtitle={coach ? 'Réservez un court pour une séance privée avec un élève.' : 'Choisissez un jour, puis un créneau libre.'}
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {coach ? (
          <Select
            label="Choisir l’élève"
            value={student}
            options={(students.data ?? []).map((s) => ({ value: s.id, label: `Élève : ${fullName(s)}` }))}
            onChange={setStudent}
          />
        ) : null}
        <Pill tone="s">{typeLabel}</Pill>
      </View>
      {!coach && <KidSelect />}
      {coach && students.data && students.data.length === 0 ? <T mut size={13}>Aucun élève dans vos groupes.</T> : null}

      <DayStrip value={day} onChange={setDay} />
      <Pills>
        <Pill tone="g">Libre</Pill>
        <Pill tone="r">Pris</Pill>
        <Pill tone="b">Mes réservations</Pill>
        <Pill tone="s">30 min libres seulement · entretien · sans éclairage</Pill>
        <Pill tone="b">{`☀ éclairé · ☾ nuit dès ${nightHour}h · de 1 h à 4 h, par demi-heure`}</Pill>
      </Pills>

      <QueryState isPending={grid.isPending} error={grid.error} refetch={grid.refetch}>
        {grid.data &&
          (grid.data.courts.length ? (
            <BookingGrid grid={grid.data} pick={pick} onPick={setPick} onBlocked={(s) => BLOCKED[s] && toast(BLOCKED[s]!)} onNotice={toast} />
          ) : (
            <EmptyState>Aucun terrain disponible.</EmptyState>
          ))}
      </QueryState>

      <Card>
        <CardTitle>Récapitulatif</CardTitle>
        {pick && court ? (
          <>
            <View>
              <Line label="Terrain">{court.name}</Line>
              <Line label="Date">{fD(day)}</Line>
              <Line label="Horaire">{`${hhmm(pick.start)} – ${hhmm(pick.end)} · ${durationText(duration)}`}</Line>
              <Line label="Période">{periodLabel}</Line>
              <Line label="Type">{typeLabel}</Line>
              {coach && studentRow ? <Line label="Élève">{fullName(studentRow)}</Line> : null}
              {isParent && kid ? <Line label="Pour">{kid.firstName}</Line> : null}
            </View>
            <CardRow>
              <T mut>Prix</T>
              <Kpi>{price !== undefined ? DT(price) : '—'}</Kpi>
            </CardRow>
            <Button variant="primary" full onPress={() => reserve.mutate()} loading={reserve.isPending} disabled={coach && !student}>
              Réserver
            </Button>
          </>
        ) : (
          <T mut size={14}>
            Touchez un créneau libre (1 h), puis une autre demi-heure du même terrain pour prolonger (jusqu’à 4 h).
          </T>
        )}
      </Card>

      <Section title="Mes réservations">
        <QueryState isPending={mine.isPending} error={mine.error} refetch={mine.refetch}>
          {mine.data?.length ? (
            mine.data.map((r) => {
              const past = new Date(r.startTime).getTime() < now;
              return (
                <Card key={r.id}>
                  <CardRow>
                    <CardTitle>{r.court.name}</CardTitle>
                    <Pill tone={past ? 's' : 'g'}>{past ? 'Passée' : 'Confirmée'}</Pill>
                  </CardRow>
                  <Pills>
                    <Pill tone="b">{fD(r.date)}</Pill>
                    <Pill tone="b">{`${r.time} – ${r.endTimeLabel}`}</Pill>
                    <Pill tone="s">{r.type === 'PRIVATE' ? 'Séance privée' : r.type === 'TOURNAMENT' ? 'Tournoi' : 'Loisir'}</Pill>
                  </Pills>
                  {coach && r.player ? (
                    <T mut size={13}>
                      {`Élève : ${fullName(r.player)}`}
                    </T>
                  ) : null}
                  {!past && (
                    <Button variant="danger" onPress={() => setToCancel(r)}>
                      Annuler la réservation
                    </Button>
                  )}
                </Card>
              );
            })
          ) : (
            <EmptyState>Aucune réservation.</EmptyState>
          )}
        </QueryState>
      </Section>

      <Note>
        {`Annulation possible jusqu’à ${settings.data?.cancelDelayHours ?? 24} h avant le créneau (R10). Un court sans éclairage n’est pas réservable la nuit.`}
        {isParent ? ' Réservation par un parent pour son enfant : à confirmer avec le bureau.' : ''}
      </Note>

      <Confirm
        open={Boolean(toCancel)}
        title="Annuler la réservation ?"
        message={toCancel ? `${toCancel.court.name}, ${fD(toCancel.date)} à ${toCancel.time}. Le créneau redeviendra libre.` : ''}
        confirmLabel="Annuler la réservation"
        danger
        onConfirm={() => toCancel && cancel.mutate(toCancel.id)}
        onClose={() => setToCancel(undefined)}
      />
    </Screen>
  );
}
