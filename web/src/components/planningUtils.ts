import { fullName, pad } from '../lib/format';
import type { Planning } from '../lib/types';

export type PSession = Planning['sessions'][number];
export type PReservation = Planning['reservations'][number];
export type PItem = { kind: 'session'; s: PSession } | { kind: 'reservation'; r: PReservation };

export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
/** « 08h », « 09h30 ». */
export const short = (min: number) => `${pad(Math.floor(min / 60))}h${min % 60 ? pad(min % 60) : ''}`;

/** Minutes depuis minuit, heure de Tunis. */
export function nowTunis(): { day: string; min: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, min: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

/** Entraîneur qui assure la séance (remplaçant si l'entraîneur est absent et remplacé). */
export const leadCoach = (s: PSession) => (s.resolution === 'REPLACED' && s.replacement ? s.replacement : s.coaches[0]);
export const coachNames = (s: PSession) => s.coaches.map((c) => fullName(c).trim()).join(', ');

/** Texte de l'entraîneur sur une séance (à affecter, remplacé, physique, annulée). */
export function coachLine(s: PSession) {
  if (s.resolution === 'CANCELLED') return cancelText(s);
  if (s.resolution === 'REPLACED' && s.replacement) return `${coachNames(s)} ⇄ remplacé par ${fullName(s.replacement).trim()}`;
  if (s.resolution === 'PHYSICAL') return `${coachNames(s)} · séance physique`;
  return coachNames(s) || 'Entraîneur à affecter';
}

export const reservationLabel = (r: PReservation) =>
  r.match ? (r.match.title ?? (r.type === 'TOURNAMENT' ? 'Tournoi' : 'Match')) : r.type === 'PRIVATE' ? 'Séance privée' : r.type === 'TOURNAMENT' ? 'Tournoi' : 'Réservé · loisir';

/** Éléments d'un terrain, triés par heure (séances annulées gardées, barrées). */
export function courtItems(p: Planning, courtId: string): PItem[] {
  const items: PItem[] = [
    ...p.sessions.filter((s) => s.court?.id === courtId).map((s) => ({ kind: 'session' as const, s })),
    ...p.reservations.filter((r) => r.courtId === courtId).map((r) => ({ kind: 'reservation' as const, r })),
  ];
  const start = (i: PItem) => toMin(i.kind === 'session' ? i.s.startTime : i.r.startTime);
  return items.sort((a, b) => start(a) - start(b));
}

/** Plages libres d'un terrain (séances annulées libèrent le terrain ; sans éclairage : rien après le début de la nuit). */
export function freeRanges(p: Planning, court: Planning['courts'][number]): [number, number][] {
  if (!court.active || court.maintenance) return [];
  const open = p.openingHour * 60;
  const close = (court.lit ? p.closingHour : Math.min(p.closingHour, p.nightStartHour)) * 60;
  const busy = courtItems(p, court.id)
    .filter((i) => !(i.kind === 'session' && i.s.resolution === 'CANCELLED'))
    .map((i) => (i.kind === 'session' ? [toMin(i.s.startTime), toMin(i.s.endTime)] : [toMin(i.r.startTime), toMin(i.r.endTime)]) as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let t = open;
  for (const [a, b] of busy) {
    if (a > t) out.push([t, Math.min(a, close)]);
    t = Math.max(t, b);
  }
  if (t < close) out.push([t, close]);
  return out.filter(([a, b]) => b - a >= 30);
}

export const rangesText = (r: [number, number][]) => r.map(([a, b]) => `${short(a)}–${short(b)}`).join(' · ');

/** Minutes occupées d'un terrain (pour la vue Semaine). */
export function busyMinutes(p: Planning, courtId: string) {
  return courtItems(p, courtId)
    .filter((i) => !(i.kind === 'session' && i.s.resolution === 'CANCELLED'))
    .reduce((n, i) => n + (i.kind === 'session' ? toMin(i.s.endTime) - toMin(i.s.startTime) : toMin(i.r.endTime) - toMin(i.r.startTime)), 0);
}

/** Couleur de la barre d'une séance ou d'une réservation. */
export function itemColor(i: PItem) {
  if (i.kind === 'reservation') return i.r.match ? 'var(--pb)' : 'var(--pr)';
  if (i.s.resolution === 'PHYSICAL') return 'var(--ps)';
  return leadCoach(i.s)?.color ?? 'var(--ps)';
}

/** Motif d'une séance annulée : par le club (pluie, fermeture), reportée par un tournoi ou entraîneur absent. */
export function cancelText(s: Planning['sessions'][number]): string {
  if (s.change?.kind === 'CANCELLED') return `Séance annulée (${s.change.reason})`;
  if (s.change?.kind === 'POSTPONED') return 'Séance reportée (terrain pris par un tournoi)';
  return 'Séance annulée (entraîneur absent)';
}
