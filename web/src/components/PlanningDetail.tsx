import { useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth/AuthContext';
import { fD } from '../lib/format';
import type { Planning } from '../lib/types';
import { AttendanceSheetForm } from './AttendanceSheetForm';
import { coachLine, nowTunis, reservationLabel, toMin, type PItem } from './planningUtils';
import { Modal } from './ui/Modal';
import { Pill, Pills } from './ui/Pill';

const btn = 'inline-flex items-center justify-center rounded-full px-4 py-[11px] text-[14px] font-semibold';

/** Fiche d'une séance ou d'une réservation du planning : infos et actions selon les droits. */
export function PlanningDetail({ planning, item, onClose }: { planning: Planning; item: PItem; onClose: () => void }) {
  const me = useMe();
  const can = (...perms: string[]) => me.role === 'ADMIN' && perms.some((p) => me.permissions.includes(p));
  const [sheet, setSheet] = useState(false);
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
              {s.resolution === 'CANCELLED' ? <Pill tone="r">Annulée</Pill> : live ? <Pill tone="r">En cours</Pill> : past ? <Pill tone="s">Terminée</Pill> : <Pill tone="b">À venir</Pill>}
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
            </div>
          </div>
        </Modal>
        <Modal open={sheet} size="lg" title={`Présences · ${s.group.name} · ${date}`} onClose={() => setSheet(false)}>
          {sheet && <AttendanceSheetForm slotId={s.id} date={planning.date} onSaved={() => setSheet(false)} />}
        </Modal>
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

