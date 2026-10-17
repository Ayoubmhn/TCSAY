/**
 * Formats français écrits à la main (indépendants du moteur Intl du téléphone).
 * Les jours « AAAA-MM-JJ » sont lus en UTC ; « maintenant » est pris à l'heure du club (Africa/Tunis, UTC+1, sans heure d'été).
 */
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const DAYS_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
export const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const CLUB_OFFSET_MS = 60 * 60 * 1000;

const dayDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
const clubDate = (d: Date) => new Date(d.getTime() + CLUB_OFFSET_MS);
export const pad = (n: number) => String(n).padStart(2, '0');

/** « mer. 7 oct. » */
export function fD(iso: string): string {
  const d = dayDate(iso);
  return `${DAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}
/** « mercredi 7 octobre » */
export function fDLong(iso: string): string {
  const d = dayDate(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** « 7 oct. 2026 » */
export function fDYear(iso: string): string {
  const d = dayDate(iso);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** Instant → « 07/10/2026 09:30 » à l'heure du club. */
export function formatDateTime(instant: string): string {
  const d = clubDate(new Date(instant));
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** Instant → « 09:30 » à l'heure du club. */
export function clock(instant: string): string {
  const d = clubDate(new Date(instant));
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** Aujourd'hui (heure du club) « AAAA-MM-JJ ». */
export function todayIso(): string {
  return clubDate(new Date()).toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  const d = dayDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekdayOf = (iso: string) => dayDate(iso).getUTCDay();

/** « 1 250 DT » */
export function DT(n: number): string {
  const [int, dec] = (Math.round(n * 1000) / 1000).toString().split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${dec ? `,${dec}` : ''} DT`;
}
/** « 2026-10 » → « Octobre 2026 » */
export const monthLabel = (month: string) => {
  const m = MONTHS[Number(month.slice(5, 7)) - 1];
  return `${m[0].toUpperCase()}${m.slice(1)} ${month.slice(0, 4)}`;
};
export const initials = (first: string, last?: string) => ((first[0] ?? '') + (last?.[0] ?? '')).toUpperCase();
export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();
export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n > 1 ? many : word}`;
