import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth, useMe } from '../auth/AuthContext';
import { BookingGrid, durationText, hhmm, type Pick } from '../components/BookingGrid';
import { KidSelect } from '../components/KidSelect';
import { Button } from '../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState, Kpi } from '../components/ui/Card';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { DayChips } from '../components/ui/DayChips';
import { FilterSelect, Filters } from '../components/ui/Field';
import { KeyValue } from '../components/ui/KeyValue';
import { QueryState } from '../components/ui/Loading';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill, Pills } from '../components/ui/Pill';
import { Section } from '../components/ui/Section';
import { useToast } from '../components/ui/Toast';
import { api } from '../lib/api';
import { addDays, DT, fD, todayIso } from '../lib/format';
import type { CourtRate, Grid, Player, Reservation, Settings, SlotState } from '../lib/types';
import { useAction } from '../lib/useAction';

const BLOCKED: Partial<Record<SlotState, string>> = {
  short: 'Une réservation dure au moins une heure : la demi-heure suivante est occupée. Commencez plus tôt, puis prolongez jusqu’ici.',
  unlit: 'Ce terrain n’est pas éclairé : réservation impossible la nuit.',
  maintenance: 'Terrain en entretien.',
  past: 'Créneau passé : modification impossible (R10).',
  taken: 'Créneau déjà pris : pas de double réservation.',
  group: 'Créneau réservé à un groupe d’entraînement.',
  mine: 'Vous avez déjà réservé ce créneau.',
};

/** Réserver un terrain (vBook) : loisir pour joueur / parent, séance privée pour le coach. */
export function BookPage() {
  const me = useMe();
  const { playerId: kidId } = useAuth();
  const toast = useToast();
  const isCoach = me.role === 'COACH';
  const type = isCoach ? 'PRIVATE' : 'LEISURE';
  const typeLabel = isCoach ? 'Séance privée' : 'Loisir';

  const [day, setDay] = useState(addDays(todayIso(), 1));
  const [pick, setPick] = useState<Pick | null>(null);
  const [student, setStudent] = useState<string>();
  const [toCancel, setToCancel] = useState<Reservation>();
  const playerId = isCoach ? undefined : kidId;

  const students = useQuery({
    queryKey: ['players', 'coach'],
    queryFn: () => api.get<Player[]>('/players'),
    enabled: isCoach,
  });
  useEffect(() => {
    if (isCoach && !student && students.data?.length) setStudent(students.data[0].id);
  }, [isCoach, student, students.data]);

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
  const nightStart = (settings.data?.nightStartHour ?? 18) * 60;
  const duration = pick ? pick.end - pick.start : 0;
  const nightMinutes = pick ? Math.max(0, pick.end - Math.max(pick.start, nightStart)) : 0;
  const rateOf = (period: 'DAY' | 'NIGHT') => rates.data?.find((r) => r.type === type && r.period === period)?.pricePerHour;
  const price = (() => {
    if (!pick) return undefined;
    const day = rateOf('DAY');
    const night = rateOf('NIGHT');
    if ((nightMinutes < duration && day === undefined) || (nightMinutes > 0 && night === undefined)) return undefined;
    return Math.round((((duration - nightMinutes) * (day ?? 0)) / 60 + (nightMinutes * (night ?? 0)) / 60) * 1000) / 1000;
  })();
  const periodLabel = nightMinutes === 0 ? 'Jour' : nightMinutes === duration ? 'Nuit ☾' : 'Jour et nuit ☾ (prix au prorata)';
  const court = pick ? grid.data?.courts.find((c) => c.id === pick.courtId) : undefined;

  const reserve = useAction(
    () => api.post<Reservation>('/reservations', { courtId: pick!.courtId, date: day, time: hhmm(pick!.start), duration: pick!.end - pick!.start, playerId: isCoach ? student : playerId }),
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

  const studentName = students.data?.find((s) => s.id === student);
  const kidName = me.players.find((p) => p.id === kidId);
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Réserver un terrain"
        subtitle={isCoach ? 'Réservez un court pour une séance privée avec un élève.' : 'Choisissez un jour, puis un créneau libre.'}
      />
      <Filters>
        {isCoach ? (
          <FilterSelect label="Choisir l’élève" value={student} onChange={(e) => setStudent(e.target.value)}>
            {students.data?.map((s) => (
              <option key={s.id} value={s.id}>
                Élève : {s.firstName} {s.lastName}
              </option>
            ))}
          </FilterSelect>
        ) : (
          <KidSelect />
        )}
        <Pill tone="s">{typeLabel}</Pill>
      </Filters>

      <DayChips value={day} onChange={setDay} />
      <Pills className="my-3">
        <Pill tone="g">Libre</Pill>
        <Pill tone="r">Pris</Pill>
        <Pill tone="b">Mes réservations</Pill>
        <Pill tone="s">30 min libres seulement · entretien · sans éclairage</Pill>
        <Pill tone="b">☀ éclairé · ☾ nuit dès {settings.data?.nightStartHour ?? 18}h · de 1 h à 4 h, par demi-heure</Pill>
      </Pills>

      <div className="grid grid-cols-1 items-start gap-4 min-[1101px]:grid-cols-[minmax(0,1fr)_300px]">
        <QueryState isPending={grid.isPending} error={grid.error} refetch={grid.refetch}>
          {grid.data && (
            <BookingGrid
              grid={grid.data}
              pick={pick}
              onPick={setPick}
              onBlocked={(s) => BLOCKED[s] && toast(BLOCKED[s]!)}
              onNotice={toast}
            />
          )}
        </QueryState>
        <Card>
          <h3>Récapitulatif</h3>
          {pick && court ? (
            <>
              <div>
                <KeyValue label="Terrain">{court.name}</KeyValue>
                <KeyValue label="Date">{fD(day)}</KeyValue>
                <KeyValue label="Horaire">
                  {hhmm(pick.start)} – {hhmm(pick.end)} · {durationText(duration)}
                </KeyValue>
                <KeyValue label="Période">{periodLabel}</KeyValue>
                <KeyValue label="Type">{typeLabel}</KeyValue>
                {isCoach && studentName && (
                  <KeyValue label="Élève">
                    {studentName.firstName} {studentName.lastName}
                  </KeyValue>
                )}
                {me.role === 'PARENT' && kidName && <KeyValue label="Pour">{kidName.firstName}</KeyValue>}
              </div>
              <CardRow>
                <span className="text-mut">Prix</span>
                <Kpi>{price !== undefined ? DT(price) : '—'}</Kpi>
              </CardRow>
              <Button variant="primary" onClick={() => reserve.mutate()} disabled={reserve.isPending}>
                Réserver
              </Button>
            </>
          ) : (
            <span className="text-mut">Cliquez un créneau libre (1 h), puis une autre demi-heure du même terrain pour prolonger (jusqu’à 4 h). Flèches du clavier pour vous déplacer.</span>
          )}
        </Card>
      </div>

      <Section title="Mes réservations">
        <QueryState isPending={mine.isPending} error={mine.error} refetch={mine.refetch}>
          {mine.data?.length ? (
            <CardGrid>
              {mine.data.map((r) => {
                const past = new Date(r.startTime).getTime() < now;
                return (
                  <Card key={r.id}>
                    <CardRow>
                      <h3>{r.court.name}</h3>
                      <Pill tone={past ? 's' : 'g'}>{past ? 'Passée' : 'Confirmée'}</Pill>
                    </CardRow>
                    <Pills>
                      <Pill tone="b">{fD(r.date)}</Pill>
                      <Pill tone="b">
                        {r.time} – {r.endTimeLabel}
                      </Pill>
                      <Pill tone="s">{r.type === 'PRIVATE' ? 'Séance privée' : 'Loisir'}</Pill>
                    </Pills>
                    {isCoach && r.player && (
                      <CardText>
                        Élève : {r.player.firstName} {r.player.lastName}
                      </CardText>
                    )}
                    {!past && (
                      <CardActions>
                        <Button variant="danger" onClick={() => setToCancel(r)}>
                          Annuler
                        </Button>
                      </CardActions>
                    )}
                  </Card>
                );
              })}
            </CardGrid>
          ) : (
            <EmptyState>Aucune réservation.</EmptyState>
          )}
        </QueryState>
      </Section>

      <Note>
        Annulation possible jusqu’à <b>{settings.data?.cancelDelayHours ?? 24} h</b> avant le créneau (R10). Un court sans
        éclairage n’est pas réservable la nuit.
        {me.role === 'PARENT' && (
          <>
            {' '}
            Réservation par un parent pour son enfant : <b>à confirmer avec le bureau</b>.
          </>
        )}
      </Note>

      <ConfirmModal
        open={Boolean(toCancel)}
        title="Annuler la réservation ?"
        text={toCancel ? `${toCancel.court.name}, ${fD(toCancel.date)} à ${toCancel.time}. Le créneau redeviendra libre.` : ''}
        cta="Annuler la réservation"
        pending={cancel.isPending}
        onConfirm={() => toCancel && cancel.mutate(toCancel.id)}
        onClose={() => setToCancel(undefined)}
      />
    </>
  );
}
