import { useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth/AuthContext';
import { fD } from '../lib/format';
import type { Planning } from '../lib/types';
import { AttendanceSheetForm } from './AttendanceSheetForm';
import { api } from '../lib/api';
import { useAction } from '../lib/useAction';
import { cancelText, coachLine, nowTunis, reservationLabel, toMin, type PItem } from './planningUtils';
import { Button } from './ui/Button';
import { TextField } from './ui/Field';
import { Modal } from './ui/Modal';
import { Pill, Pills } from './ui/Pill';
import { useToast } from './ui/Toast';

const REASONS = ['Pluie', 'Terrain impraticable', 'Fermeture du club', 'Jour férié'];
const CANCEL_KEYS = [['planning'], ['sessions'], ['session-counter'], ['dashboard']];

/** Annuler une séance (pluie, fermeture…) : motif, familles et entraîneurs prévenus ; elle compte « à rattraper ». */
function CancelSessionModal({ slotId, date, label, onClose }: { slotId: string; date: string; label: string; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('Pluie');
  const [other, setOther] = useState('');
  const [notify, setNotify] = useState(true);
  const text = reason === 'Autre' ? other.trim() : reason;
  const cancel = useAction(() => api.post<{ notified: number }>('/session-changes/cancel', { slotId, date, reason: text, notify }), {
    invalidate: CANCEL_KEYS,
    success: (r) => `Séance annulée${r.notified ? ` : ${r.notified} personne${r.notified > 1 ? 's' : ''} prévenue${r.notified > 1 ? 's' : ''}` : ''}. Elle compte « à rattraper ».`,
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      size="md"
      title="Annuler la séance"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Retour</Button>
          <Button variant="danger" disabled={cancel.isPending} onClick={() => (text ? cancel.mutate() : toast('Motif obligatoire.'))}>
            Annuler la séance
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[14px] text-mut">{label}</p>
        <div role="radiogroup" aria-label="Motif" className="flex flex-wrap gap-1.5">
          {[...REASONS, 'Autre'].map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className={`rounded-full px-3.5 py-2 text-[13.5px] font-medium ${reason === r ? 'bg-toggle text-bg' : 'bg-btn text-fg'}`}
            >
              {r}
            </button>
          ))}
        </div>
        {reason === 'Autre' && <TextField label="Motif *" full maxLength={200} value={other} onChange={(e) => setOther(e.target.value)} />}
        <label className="flex items-center gap-2.5 text-[14px]">
          <input type="checkbox" className="h-4 w-4 accent-pri" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Prévenir les familles et les entraîneurs du groupe
        </label>
        <p className="m-0 text-[12.5px] text-mut">La séance reste affichée « Annulée » avec son motif et compte « à rattraper » dans le compteur des séances.</p>
      </div>
    </Modal>
  );
}

const btn = 'inline-flex items-center justify-center rounded-full px-4 py-[11px] text-[14px] font-semibold';

/** Supprimer une séance ponctuelle (rattrapage, en plus, spéciale) avant son début : motif, familles prévenues. */
function RemoveOneOffModal({ id, label, onClose }: { id: string; label: string; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const remove = useAction(() => api.delete(`/extra-sessions/${id}`, { reason: reason.trim(), notify }), {
    invalidate: CANCEL_KEYS,
    success: 'Séance ponctuelle supprimée.',
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      size="md"
      title="Supprimer la séance ponctuelle"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Retour</Button>
          <Button variant="danger" disabled={remove.isPending} onClick={() => (reason.trim() ? remove.mutate() : toast('Motif obligatoire.'))}>
            Supprimer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[14px] text-mut">{label}</p>
        <TextField label="Motif *" full maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        <label className="flex items-center gap-2.5 text-[14px]">
          <input type="checkbox" className="h-4 w-4 accent-pri" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Prévenir les familles et les entraîneurs du groupe
        </label>
      </div>
    </Modal>
  );
}

/** Fiche d'une séance ou d'une réservation du planning : infos et actions selon les droits. */
export function PlanningDetail({ planning, item, onClose }: { planning: Planning; item: PItem; onClose: () => void }) {
  const me = useMe();
  const can = (...perms: string[]) => me.role === 'ADMIN' && perms.some((p) => me.permissions.includes(p));
  const [sheet, setSheet] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const restore = useAction(
    () => (item.kind === 'session' ? api.delete(`/session-changes/cancel/${item.s.id}/${planning.date}`) : Promise.resolve(null)),
    { invalidate: CANCEL_KEYS, success: 'Séance rétablie.', onSuccess: onClose },
  );
  const court = planning.courts.find((c) => c.id === (item.kind === 'session' ? item.s.court?.id : item.r.courtId));
  const start = item.kind === 'session' ? item.s.startTime : item.r.startTime;
  const end = item.kind === 'session' ? item.s.endTime : item.r.endTime;
  const now = nowTunis();
  const live = now.day === planning.date && now.min >= toMin(start) && now.min < toMin(end);
  const past = now.day > planning.date || (now.day === planning.date && now.min >= toMin(end));
  const date = fD(planning.date, { weekday: 'short', day: 'numeric', month: 'short' });

  if (item.kind === 'session') {
    const s = item.s;
    const a = s.attendance;
    const marked = a ? a.present + a.late + a.absent : 0;
    return (
      <>
        <Modal open={!sheet} size="md" title={s.group.name} onClose={onClose}>
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] text-mut">
                Séance d’entraînement{s.group.kind ? ` · ${s.group.kind === 'LEISURE' ? 'loisirs' : 'compétition'}` : ''}
              </span>
              {s.resolution === 'CANCELLED' ? <Pill tone="r">{s.change && s.change.kind !== 'MOVED' ? cancelText(s).replace('Séance ', '').replace(/^./, (c) => c.toUpperCase()) : 'Annulée'}</Pill> : live ? <Pill tone="r">En cours</Pill> : past ? <Pill tone="s">Terminée</Pill> : <Pill tone="b">À venir</Pill>}
            </div>
            <Pills>
              <Pill tone="b">{date}</Pill>
              <Pill tone="b">
                {start} – {end}
              </Pill>
              <Pill tone="g">
                {court?.name ?? 'Terrain à définir'}
                {court?.lit ? ' ☀' : ''}
              </Pill>
              {s.holiday && <Pill tone="s">{s.holiday}</Pill>}
            </Pills>
            <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[14px]">
              <span className="text-mut">Entraîneur</span>
              <b className="font-semibold">{coachLine(s)}</b>
              <span className="text-mut">Joueurs</span>
              <span>{s.members ?? '—'} inscrit{(s.members ?? 0) > 1 ? 's' : ''}</span>
              <span className="text-mut">Présences</span>
              <span>{a && marked ? `${a.present} présent${a.present > 1 ? 's' : ''} · ${a.late} retard · ${a.absent} absent${a.absent > 1 ? 's' : ''}` : 'Pas encore pointées'}</span>
            </div>
            <div className="flex flex-col gap-2">
              {can('attendance.manage') && s.resolution !== 'CANCELLED' && (
                <button type="button" className={`${btn} bg-pri text-white`} onClick={() => setSheet(true)}>
                  Présences
                </button>
              )}
              <div className="grid grid-cols-2 gap-2">
                {can('absences.manage') && (
                  <Link to="/admin/absences" className={`${btn} bg-btn text-fg`}>
                    ⇄ Remplacer / annuler
                  </Link>
                )}
                {can('groups.manage', 'planning.view', 'players.manage') && (
                  <Link to={`/admin/groupes/${s.group.id}`} className={`${btn} bg-btn text-fg`}>
                    Fiche du groupe · horaires
                  </Link>
                )}
              </div>
              {can('groups.manage') && s.change?.kind === 'CANCELLED' && (
                <button type="button" className={`${btn} bg-btn text-fg`} disabled={restore.isPending} onClick={() => restore.mutate()}>
                  Rétablir la séance
                </button>
              )}
              {can('groups.manage') && s.oneOff && !marked && !past && !live && (
                <button type="button" className={`${btn} bg-[#fdb3b0] text-[#111]`} onClick={() => setRemoving(true)}>
                  Supprimer la séance ponctuelle
                </button>
              )}
              {can('groups.manage') && !s.oneOff && s.resolution !== 'CANCELLED' && !marked && (
                <button type="button" className={`${btn} bg-[#fdb3b0] text-[#111]`} onClick={() => setCancelling(true)}>
                  Annuler la séance (pluie, fermeture…)
                </button>
              )}
            </div>
          </div>
        </Modal>
        <Modal open={sheet} size="lg" title={`Présences · ${s.group.name} · ${date}`} onClose={() => setSheet(false)}>
          {sheet && <AttendanceSheetForm slotId={s.id} date={planning.date} onSaved={() => setSheet(false)} />}
        </Modal>
        {removing && s.oneOff && (
          <RemoveOneOffModal id={s.oneOff.id} label={`${s.group.name} · ${s.holiday ?? 'Séance ponctuelle'} · ${date} · ${start} – ${end}`} onClose={() => { setRemoving(false); onClose(); }} />
        )}
        {cancelling && <CancelSessionModal slotId={s.id} date={planning.date} label={`${s.group.name} · ${date} · ${start} – ${end}`} onClose={() => { setCancelling(false); onClose(); }} />}
      </>
    );
  }

  const r = item.r;
  return (
    <Modal open size="md" title={reservationLabel(r)} onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        <Pills>
          <Pill tone="b">{date}</Pill>
          <Pill tone="b">
            {start} – {end}
          </Pill>
          <Pill tone="g">{court?.name ?? ''}</Pill>
          {live && <Pill tone="r">En cours</Pill>}
        </Pills>
        <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[14px]">
          <span className="text-mut">Type</span>
          <span>{r.match ? (r.type === 'TOURNAMENT' ? 'Match de tournoi' : 'Match') : r.type === 'PRIVATE' ? 'Séance privée (entraîneur)' : 'Loisir'}</span>
          {r.match && (
            <>
              <span className="text-mut">Joueurs</span>
              <b className="font-semibold">{r.match.players}</b>
            </>
          )}
          {!r.match && (
            <>
              <span className="text-mut">Réservé par</span>
              <b className="font-semibold">{r.player ?? r.coach?.name ?? '—'}</b>
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {r.match && (
            <Link to={`/matchs/${r.match.id}`} className={`${btn} col-span-2 bg-pri text-white`}>
              Voir le match
            </Link>
          )}
          {!r.match && can('reservations.manage') && (
            <Link to="/admin/reservations" className={`${btn} col-span-2 bg-btn text-fg`}>
              Gérer les réservations
            </Link>
          )}
        </div>
      </div>
    </Modal>
  );
}

