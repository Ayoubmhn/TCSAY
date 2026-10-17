/** Formats français. Les jours calendaires (« AAAA-MM-JJ ») sont lus en UTC pour éviter tout décalage. */

const TZ_DAY = 'UTC';

/** Langue des dates (suit la langue choisie ; chiffres latins en arabe, comme en Tunisie). */
let LOCALE = 'fr-FR';
export function setDateLocale(lang: 'fr' | 'en' | 'ar'): void {
  LOCALE = lang === 'en' ? 'en-GB' : lang === 'ar' ? 'ar-TN-u-nu-latn' : 'fr-FR';
}
const TZ_CLUB = 'Africa/Tunis';

function dayDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

/** « mer. 7 oct. » (fD du prototype) ; options Intl personnalisables. */
export function fD(iso: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return dayDate(iso).toLocaleDateString(LOCALE, { ...options, timeZone: TZ_DAY });
}

/** « 01/09/2025 » */
export function formatDate(iso: string): string {
  return fD(iso, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Instant → « 2026-10-07 09:30 » à l'heure du club. */
export function formatDateTime(instant: string): string {
  const d = new Date(instant);
  const day = d.toLocaleDateString('sv-SE', { timeZone: TZ_CLUB });
  const time = d.toLocaleTimeString('fr-FR', { timeZone: TZ_CLUB, hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

/** « 2025-09-01T00:00:00.000Z » → « 2025-09-01 » (valeur d'un champ date). */
export function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

/** Aujourd'hui (heure du club) « AAAA-MM-JJ ». */
export function todayIso(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ_CLUB });
}

export function addDays(iso: string, n: number): string {
  const d = dayDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = dimanche … 6 = samedi */
export function weekdayOf(iso: string): number {
  return dayDate(iso).getUTCDay();
}

export const pad = (n: number): string => String(n).padStart(2, '0');

/** « 1 250 DT » (DT du prototype). */
export function DT(n: number): string {
  return `${n.toLocaleString('fr-FR')} DT`;
}

export const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

export const initials = (first: string, last?: string): string => (first[0] + (last ? last[0] : '')).toUpperCase();

export const fullName = (p: { firstName: string; lastName: string }): string => `${p.firstName} ${p.lastName}`;

/** Âge selon l'année de naissance au 31/12 de l'année de référence (règle provisoire). */
export function ageAt(birthIso: string, year: number): number {
  return year - Number(birthIso.slice(0, 4));
}

/** Email provisoire des comptes importés (« …@a-completer.invalid ») : jamais utilisé pour un envoi. */
export const isPlaceholderEmail = (email: string | null | undefined): boolean => Boolean(email?.toLowerCase().endsWith('@a-completer.invalid'));

/** Email à envoyer lors d'une modification : seulement s'il a changé (un email provisoire laissé vide n'est pas envoyé). */
export function changedEmail(before: string | null | undefined, value: string): string | undefined {
  const next = value.trim().toLowerCase();
  if (!next) return undefined;
  return next === (before ?? '').toLowerCase() ? undefined : next;
}

/** Message après enregistrement d'un compte dont l'email a pu changer (nouveaux identifiants envoyés). */
export function savedMessage(base: string, credentials?: { sentTo: string | null } | null): string {
  return credentials?.sentTo ? `${base} Nouveaux identifiants envoyés à ${credentials.sentTo}.` : base;
}
