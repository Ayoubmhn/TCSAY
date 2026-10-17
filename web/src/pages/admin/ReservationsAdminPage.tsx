import { useQuery } from '@tanstack/react-query';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { DayChips } from '../../components/ui/DayChips';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { fD, fullName, todayIso } from '../../lib/format';
import type { Reservation } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { ActionIcon } from '../../components/ui/ActionIcon';

type Security = {
  alerts: { level: 'warn' | 'info'; text: string; userId?: string }[];
  blocks: { id: string; user: { id: string; name: string; email: string | null }; reason: string; until: string; automatic: boolean; by: string | null }[];
};

/** Sécurité des réservations : alertes, comptes bloqués (débloquer). */
function SecurityPanel({ onBlock }: { onBlock: (userId: string, name: string) => void }) {
  const q = useQuery({ queryKey: ['reservations', 'security'], queryFn: () => api.get<Security>('/reservations/security') });
  const lift = useAction((id: string) => api.post(`/reservations/blocks/${id}/lift`), { invalidate: [['reservations']], success: 'Compte débloqué.' });
  const d = q.data;
  if (!d || (!d.alerts.length && !d.blocks.length)) return null;
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 min-[861px]:grid-cols-2">
      {d.alerts.length > 0 && (
        <Card className="gap-2">
          <h3>Alertes de sécurité</h3>
          {d.alerts.map((a, i) => (
            <div key={i} className={`flex items-center justify-between gap-2 rounded-[14px] px-3 py-2 text-[13.5px] ${a.level === 'warn' ? 'bg-topay' : 'bg-fld'}`}>
              <span>
                {a.level === 'warn' ? '⚠️ ' : 'ℹ️ '}
                {a.text}
              </span>
              {a.userId && <ActionIcon kind="deactivate" label="Bloquer ce compte" onClick={() => onBlock(a.userId!, a.text.split(' :')[0])} />}
            </div>
          ))}
        </Card>
      )}
      {d.blocks.length > 0 && (
        <Card className="gap-2">
          <h3>Comptes bloqués</h3>
          {d.blocks.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 rounded-[14px] bg-fld px-3 py-2">
              <span className="min-w-0">
                <b className="block truncate text-[14px]">{b.user.name}</b>
                <span className="block text-[12.5px] text-mut">
                  Jusqu’au {fD(b.until.slice(0, 10), { day: 'numeric', month: 'short' })} · {b.reason} · {b.by ?? '—'}
                </span>
              </span>
              <Button onClick={() => lift.mutate(b.id)} disabled={lift.isPending}>
                Débloquer
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/** Réservations (vAres) : par jour, annulation forcée avec motif, absence sans annuler, blocage d'un compte. */
export function ReservationsAdminPage() {
  const [view, setView] = useViewMode('reservations');
  const me = useMe();
  const [day, setDay] = useState(todayIso());
  const [toCancel, setToCancel] = useState<Reservation>();
  const [blocking, setBlocking] = useState<{ userId: string; name: string }>();
  const [blockForm, setBlockForm] = useState({ reason: '', days: '15' });
  const noShow = useAction((r: Reservation) => api.post<{ blocked: boolean }>(`/reservations/${r.id}/no-show`), {
    invalidate: [['reservations']],
    success: (x) => (x.blocked ? 'Absence signalée : compte bloqué automatiquement (règle du club).' : 'Absence sans annuler signalée.'),
  });
  const block = useAction(() => api.post('/reservations/blocks', { userId: blocking!.userId, reason: blockForm.reason, days: Number(blockForm.days) }), {
    invalidate: [['reservations']],
    success: 'Compte bloqué de la réservation : il est prévenu.',
    onSuccess: () => (setBlocking(undefined), setBlockForm({ reason: '', days: '15' })),
  });
  const q = useQuery({ queryKey: ['reservations', 'day', day], queryFn: () => api.get<Reservation[]>('/reservations', { date: day }) });
  const cancel = useAction((motif: string) => api.post(`/reservations/${toCancel!.id}/cancel`, { reason: motif }), {
    invalidate: [['reservations'], ['grid'], ['audit'], ['emails'], ['courts']],
    success: 'Réservation annulée. Email envoyé.',
    onSuccess: () => setToCancel(undefined),
  });

  return (
    <>
      <PageHeader
        action={
          <div className="flex flex-wrap items-center gap-2">
            {me.permissions.includes('permissions.manage') && (
              <Link to="/admin/regles-reservation" className="rounded-full bg-btn px-4 py-[9px] text-sm font-semibold">
                Règles de réservation
              </Link>
            )}
            <ViewToggle value={view} onChange={setView} />
          </div>
        }
        title="Réservations"
        subtitle="Découvrez les réservations par jour."
      />
      <SecurityPanel onBlock={(userId, name) => setBlocking({ userId, name })} />
      <div className="mt-[18px]">
        <DayChips value={day} onChange={setDay} />
      </div>
      <div className="mt-3.5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid list={view === 'list'}>
              {q.data.map((r) => (
                <Card key={r.id}>
                  <CardRow>
                    <h3>
                      {r.court.name} · {r.time} – {r.endTimeLabel}
                    </h3>
                    {r.noShow ? <Pill tone="r">Absent sans annuler</Pill> : <Pill tone="g">Confirmée</Pill>}
                  </CardRow>
                  <Pills>
                    <Pill tone="s">{r.type === 'PRIVATE' ? 'Séance privée' : r.type === 'TOURNAMENT' ? 'Tournoi' : r.type === 'MATCH' ? 'Match' : 'Loisir'}</Pill>
                    <Pill tone="b">{fD(r.date)}</Pill>
                  </Pills>
                  <CardText>
                    {r.player ? fullName(r.player) : '—'} · réservé par {r.bookedBy ?? '—'}
                    {r.coach ? ` · coach ${fullName(r.coach)}` : ''}
                  </CardText>
                  <CardActions>
                    {new Date(r.startTime) > new Date() && <ActionIcon kind="cancel" label="Annulation forcée" onClick={() => setToCancel(r)} />}
                    {new Date(r.startTime) <= new Date() && !r.noShow && (r.type === 'LEISURE' || r.type === 'PRIVATE') && (
                      <ActionIcon kind="refuse" label="Absent sans annuler" onClick={() => noShow.mutate(r)} disabled={noShow.isPending} />
                    )}
                    {r.bookedById && (r.type === 'LEISURE' || r.type === 'PRIVATE') && (
                      <ActionIcon kind="deactivate" label="Bloquer ce compte" onClick={() => setBlocking({ userId: r.bookedById!, name: r.bookedBy ?? 'ce compte' })} />
                    )}
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucune réservation ce jour.</EmptyState>
          )}
        </QueryState>
      </div>
      <Note>
        L’admin peut forcer une annulation à moins de 24 h, avec motif. Pas de double réservation : clé unique terrain + heure. « Absent sans annuler » et les
        annulations répétées bloquent le compte automatiquement selon les règles du club ; un compte bloqué est prévenu et peut être débloqué ici.
      </Note>
      <Modal
        open={Boolean(blocking)}
        title={`Bloquer ${blocking?.name ?? ''} de la réservation`}
        onClose={() => setBlocking(undefined)}
        footer={
          <>
            <Button onClick={() => setBlocking(undefined)}>Annuler</Button>
            <Button variant="danger" data-primary onClick={() => block.mutate()} disabled={!blockForm.reason.trim() || block.isPending}>
              Bloquer
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <TextField label="Motif (visible par le compte)" value={blockForm.reason} maxLength={200} onChange={(e) => setBlockForm((f) => ({ ...f, reason: e.target.value }))} />
          <SelectField label="Durée" value={blockForm.days} onChange={(e) => setBlockForm((f) => ({ ...f, days: e.target.value }))}>
            {['7', '15', '30', '60', '90'].map((d) => (
              <option key={d} value={d}>
                {d} jours
              </option>
            ))}
          </SelectField>
        </div>
      </Modal>
      <ConfirmModal
        open={Boolean(toCancel)}
        title="Annulation forcée"
        text={
          toCancel
            ? `${toCancel.court.name}, ${fD(toCancel.date)} à ${toCancel.time}${toCancel.player ? ` pour ${fullName(toCancel.player)}` : ''}. Le joueur sera prévenu par email.`
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
