import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { FilterSelect, Filters, FormGrid, SelectField, TextArea, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { fD, formatDateTime, fullName, todayIso } from '../../lib/format';
import type { Coach, CoachAbsence, CoachSession } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const STATUS = {
  PENDING: { label: 'En attente de validation', tone: 's' },
  APPROVED: { label: 'Validée', tone: 'g' },
  REJECTED: { label: 'Refusée', tone: 'r' },
} as const;
const KEYS = [['coach-absences'], ['sessions'], ['planning'], ['salary-estimate'], ['salaries'], ['coach-profile']];

/** Déclaration d'une absence : date, séance concernée (ou toute la journée), motif, prévenir les groupes. */
function DeclareModal({ open, admin, onClose }: { open: boolean; admin: boolean; onClose: () => void }) {
  const toast = useToast();
  const [coachId, setCoachId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [slotId, setSlotId] = useState('');
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  useEffect(() => {
    if (!open) return;
    setCoachId('');
    setDate(todayIso());
    setSlotId('');
    setReason('');
    setNotify(true);
  }, [open]);

  const coaches = useQuery({ queryKey: ['coaches'], queryFn: () => api.get<Coach[]>('/coaches'), enabled: open && admin });
  const sessions = useQuery({
    queryKey: ['sessions', 'absence', coachId, date],
    queryFn: () => api.get<CoachSession[]>('/sessions', { from: date, to: date, coachId: admin ? coachId : undefined }),
    enabled: open && Boolean(date) && (!admin || Boolean(coachId)),
  });

  const save = useAction(
    () => api.post('/coach-absences', { date, slotId: slotId || undefined, reason: reason.trim(), notifyGroups: notify, coachId: admin ? coachId : undefined }),
    {
      invalidate: KEYS,
      success: admin ? 'Absence enregistrée et validée.' : 'Absence déclarée : en attente de validation par l’administration.',
      onSuccess: onClose,
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (admin && !coachId) return toast('Entraîneur obligatoire.');
    if (!date) return toast('Date obligatoire.');
    if (!reason.trim()) return toast('Le motif est obligatoire.');
    save.mutate();
  };

  return (
    <Modal
      open={open}
      title={admin ? 'Saisir une absence' : 'Déclarer une absence'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="absence-form" disabled={save.isPending}>
            {admin ? 'Enregistrer' : 'Déclarer'}
          </Button>
        </>
      }
    >
      <FormGrid id="absence-form" onSubmit={submit}>
        {admin && (
          <SelectField label="Entraîneur *" full value={coachId} onChange={(e) => setCoachId(e.target.value)}>
            <option value="">Choisir…</option>
            {coaches.data
              ?.filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {fullName(c).trim()}
                </option>
              ))}
          </SelectField>
        )}
        <TextField label="Date *" type="date" min={admin ? undefined : todayIso()} value={date} onChange={(e) => (setDate(e.target.value), setSlotId(''))} />
        <SelectField label="Séance concernée" value={slotId} onChange={(e) => setSlotId(e.target.value)}>
          <option value="">Toute la journée{sessions.data ? ` (${sessions.data.length} séance${sessions.data.length > 1 ? 's' : ''})` : ''}</option>
          {sessions.data?.map((s) => (
            <option key={s.slotId} value={s.slotId}>
              {s.groupName} · {s.startTime}–{s.endTime}
            </option>
          ))}
        </SelectField>
        <TextArea label="Motif *" full value={reason} onChange={(e) => setReason(e.target.value)} />
        <label className="col-span-full flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-[18px] w-[18px] accent-pri" />
          Prévenir mes groupes par email (joueurs et parents) {admin ? 'maintenant' : 'après validation'}
        </label>
      </FormGrid>
    </Modal>
  );
}

function AbsenceCard({ a, admin, onDecide }: { a: CoachAbsence; admin: boolean; onDecide?: (a: CoachAbsence, approve: boolean) => void }) {
  return (
    <Card>
      <CardRow>
        <h3 className="flex items-center gap-2">
          {admin && <span aria-hidden="true" className="h-3 w-3 flex-none rounded-full" style={{ background: a.coach.color }} />}
          {admin ? fullName(a.coach).trim() : fD(a.date, { weekday: 'long', day: 'numeric', month: 'long' })}
        </h3>
        <Pill tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Pill>
      </CardRow>
      <Pills>
        {admin && <Pill tone="b">{fD(a.date, { weekday: 'short', day: 'numeric', month: 'short' })}</Pill>}
        <Pill tone="b">{a.slot ? `${a.slot.group.name} · ${a.slot.startTime}–${a.slot.endTime}` : 'Toute la journée'}</Pill>
        {a.notifyGroups && <Pill tone="s">Groupes prévenus{a.status === 'PENDING' ? ' après validation' : ''}</Pill>}
      </Pills>
      <CardText>{a.reason}</CardText>
      {a.decisionNote && <CardText>Décision : {a.decisionNote}</CardText>}
      {a.decidedBy && <CardText>Par {a.decidedBy}</CardText>}
      {!a.decidedBy && <CardText>Déclarée le {formatDateTime(a.createdAt)}</CardText>}
      {admin && a.status === 'PENDING' && onDecide && (
        <CardActions>
          <Button variant="primary" onClick={() => onDecide(a, true)}>
            Valider
          </Button>
          <Button variant="danger" onClick={() => onDecide(a, false)}>
            Refuser
          </Button>
        </CardActions>
      )}
    </Card>
  );
}

/**
 * Absences des entraîneurs. Coach : déclaration et suivi. Admin : validation (l'absence compte alors pour le salaire
 * et les groupes sont prévenus si demandé), refus, saisie directe.
 */
export function CoachAbsencesPage({ admin = false }: { admin?: boolean }) {
  const [status, setStatus] = useState<'' | CoachAbsence['status']>('');
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<{ a: CoachAbsence; approve: boolean }>();
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['coach-absences', status], queryFn: () => api.get<CoachAbsence[]>('/coach-absences', { status: status || undefined }) });
  const decide = useAction(
    () => api.post<CoachAbsence & { notified?: number }>(`/coach-absences/${decision!.a.id}/${decision!.approve ? 'approve' : 'reject'}`, { note: note.trim() || undefined }),
    {
      invalidate: [...KEYS, ['emails'], ['audit']],
      success: (r) =>
        r.status === 'APPROVED' ? `Absence validée.${r.notified ? ` ${r.notified} email(s) envoyé(s) aux groupes.` : ''}` : 'Absence refusée.',
      onSuccess: () => setDecision(undefined),
    },
  );
  const rows = q.data ?? [];
  const pending = rows.filter((a) => a.status === 'PENDING');
  const others = rows.filter((a) => a.status !== 'PENDING');

  return (
    <>
      <PageHeader
        title={admin ? 'Absences des entraîneurs' : 'Mes absences'}
        subtitle={admin ? 'Découvrez les absences déclarées et validez-les.' : 'Déclarez une absence : elle est validée par l’administration.'}
        action={
          <Button variant="primary" onClick={() => setOpen(true)}>
            {admin ? '+ Saisir une absence' : '+ Déclarer une absence'}
          </Button>
        }
      />
      <Filters>
        <FilterSelect label="Statut" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">Tous les statuts</option>
          <option value="PENDING">En attente</option>
          <option value="APPROVED">Validées</option>
          <option value="REJECTED">Refusées</option>
        </FilterSelect>
        {pending.length > 0 && <Pill tone="s">{pending.length} en attente</Pill>}
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {pending.length > 0 && (
          <Section title="En attente de validation">
            <CardGrid>
              {pending.map((a) => (
                <AbsenceCard key={a.id} a={a} admin={admin} onDecide={(x, approve) => (setNote(''), setDecision({ a: x, approve }))} />
              ))}
            </CardGrid>
          </Section>
        )}
        <Section title="Historique">
          {others.length ? (
            <CardGrid>
              {others.map((a) => (
                <AbsenceCard key={a.id} a={a} admin={admin} />
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucune absence.</EmptyState>
          )}
        </Section>
      </QueryState>
      <Note>
        Une absence validée est déduite du salaire du mois (séances non assurées) et la séance apparaît barrée au planning.
        {admin ? '' : ' Vos groupes ne sont prévenus qu’après la validation par l’administration.'}
      </Note>
      <DeclareModal open={open} admin={admin} onClose={() => setOpen(false)} />
      <Modal
        open={Boolean(decision)}
        title={decision?.approve ? 'Valider cette absence ?' : 'Refuser cette absence ?'}
        onClose={() => setDecision(undefined)}
        footer={
          <>
            <Button onClick={() => setDecision(undefined)}>Annuler</Button>
            <Button variant={decision?.approve ? 'primary' : 'danger'} onClick={() => decide.mutate()} disabled={decide.isPending}>
              {decision?.approve ? 'Valider' : 'Refuser'}
            </Button>
          </>
        }
      >
        {decision && (
          <p className="m-0 text-mut">
            {fullName(decision.a.coach).trim()} · {fD(decision.a.date, { weekday: 'long', day: 'numeric', month: 'long' })}
            {decision.approve && decision.a.notifyGroups ? ' · les groupes concernés seront prévenus par email.' : ''}
          </p>
        )}
        <TextField label="Note (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </>
  );
}
