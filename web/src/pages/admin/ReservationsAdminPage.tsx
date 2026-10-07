import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { DayChips } from '../../components/ui/DayChips';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { addDays, fD, fullName, pad, todayIso } from '../../lib/format';
import type { Reservation } from '../../lib/types';
import { useAction } from '../../lib/useAction';

/** Réservations (vAres) : par jour, annulation forcée avec motif. */
export function ReservationsAdminPage() {
  const [day, setDay] = useState(addDays(todayIso(), 1));
  const [toCancel, setToCancel] = useState<Reservation>();
  const q = useQuery({ queryKey: ['reservations', 'day', day], queryFn: () => api.get<Reservation[]>('/reservations', { date: day }) });
  const cancel = useAction((motif: string) => api.post(`/reservations/${toCancel!.id}/cancel`, { reason: motif }), {
    invalidate: [['reservations'], ['grid'], ['audit'], ['emails'], ['courts']],
    success: 'Réservation annulée. Email envoyé.',
    onSuccess: () => setToCancel(undefined),
  });

  return (
    <>
      <PageHeader title="Réservations" subtitle="Découvrez les réservations par jour." />
      <div className="mt-[18px]">
        <DayChips value={day} onChange={setDay} />
      </div>
      <div className="mt-3.5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid>
              {q.data.map((r) => (
                <Card key={r.id}>
                  <CardRow>
                    <h3>
                      {r.court.name} · {pad(r.hour)}:00
                    </h3>
                    <Pill tone="g">Confirmée</Pill>
                  </CardRow>
                  <Pills>
                    <Pill tone="s">{r.type === 'PRIVATE' ? 'Séance privée' : 'Loisir'}</Pill>
                    <Pill tone="b">{fD(r.date)}</Pill>
                  </Pills>
                  <CardText>
                    {r.player ? fullName(r.player) : '—'} · réservé par {r.bookedBy ?? '—'}
                    {r.coach ? ` · coach ${fullName(r.coach)}` : ''}
                  </CardText>
                  <CardActions>
                    <Button variant="danger" onClick={() => setToCancel(r)}>
                      Annulation forcée
                    </Button>
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucune réservation ce jour.</EmptyState>
          )}
        </QueryState>
      </div>
      <Note>L’admin peut forcer une annulation à moins de 24 h, avec motif. Pas de double réservation : clé unique terrain + heure.</Note>
      <ConfirmModal
        open={Boolean(toCancel)}
        title="Annulation forcée"
        text={
          toCancel
            ? `${toCancel.court.name}, ${fD(toCancel.date)} à ${pad(toCancel.hour)}h${toCancel.player ? ` pour ${fullName(toCancel.player)}` : ''}. Le joueur sera prévenu par email.`
            : ''
        }
        cta="Forcer l’annulation"
        withMotif
        pending={cancel.isPending}
        onConfirm={(motif) => cancel.mutate(motif)}
        onClose={() => setToCancel(undefined)}
      />
    </>
  );
}
