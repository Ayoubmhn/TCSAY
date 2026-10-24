import type { RawSlot, Timetable } from './types';

/** « 17:30 » → minutes depuis minuit, et l'inverse. */
export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const durationOf = (s: { startTime: string; endTime: string }) => toMin(s.endTime) - toMin(s.startTime);

/** « 1 h 30 », « 45 min », « 3 h ». */
export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** Texte lisible sur une couleur d'entraîneur (clair → texte foncé). */
export function ink(color: string): string {
  const c = color.replace('#', '');
  if (c.length !== 6) return '#111';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111' : '#fff';
}

const overlap = (a: RawSlot, b: RawSlot) => a.day === b.day && toMin(a.startTime) < toMin(b.endTime) && toMin(b.startTime) < toMin(a.endTime);

/** Créneau placé sur la grille avec son groupe (pour les contrôles et l'affichage). */
export type Placed = { groupId: string; groupName: string; slot: RawSlot };

/**
 * Contrôle en direct d'un placement (les mêmes règles sont refaites par le serveur) : heures d'ouverture, terrain éclairé
 * la nuit, conflits de terrain, d'entraîneur ou du groupe lui-même. Renvoie la raison du refus, sinon null.
 */
export function placementProblem(t: Timetable, cand: Placed, others: Placed[]): string | null {
  const s = cand.slot;
  const start = toMin(s.startTime);
  const end = toMin(s.endTime);
  if (start < t.hours.opening * 60 || end > t.hours.closing * 60) return `Hors des heures d’ouverture (${t.hours.opening} h – ${t.hours.closing} h)`;
  if (s.kind === 'TENNIS' && !s.courtId) return 'Choisissez un terrain pour une séance de tennis';
  const court = s.courtId ? t.courts.find((c) => c.id === s.courtId) : null;
  if (court && !court.lit && end > t.hours.nightStart * 60) return `${court.name} n’est pas éclairé après ${t.hours.nightStart} h`;
  for (const o of others) {
    if (!overlap(s, o.slot)) continue;
    if (o.groupId === cand.groupId) return `« ${cand.groupName} » a déjà une séance à ${o.slot.startTime}`;
    if (s.courtId && o.slot.courtId === s.courtId) return `${court?.name ?? 'Terrain'} pris par « ${o.groupName} »`;
    const coach = s.coachIds.find((c) => o.slot.coachIds.includes(c));
    if (coach) {
      const who = t.coaches.find((c) => c.id === coach);
      return `${who ? who.firstName : 'Entraîneur'} déjà avec « ${o.groupName} »`;
    }
  }
  return null;
}
