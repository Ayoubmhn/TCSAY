import { BadRequestException } from '@nestjs/common';

/**
 * Deux sortes de dates :
 * - jour calendaire (colonne DATE) : minuit UTC, manipulé en « AAAA-MM-JJ » ;
 * - instant (réservation, séance) : heure locale du club (process.env.TZ = Africa/Tunis).
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const pad = (n: number): string => String(n).padStart(2, '0');

/** « 2026-10-07 » → Date minuit UTC (colonne DATE). */
export function dayFromIso(value: string): Date {
  if (!DAY_RE.test(value)) throw new BadRequestException('Date attendue au format AAAA-MM-JJ.');
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Date invalide.');
  return d;
}

/** Date minuit UTC (colonne DATE) → « 2026-10-07 ». */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Aujourd'hui (heure du club) → « 2026-10-07 ». */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Jour calendaire + n jours. */
export function addDaysIso(value: string, n: number): string {
  const d = dayFromIso(value);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

/** Jour de la semaine d'un jour calendaire : 0 = dimanche … 6 = samedi. */
export function weekday(value: string): number {
  return dayFromIso(value).getUTCDay();
}

/** Instant local du club : « 2026-10-07 » + « 17:30 » (ou heure entière). */
export function localInstant(day: string, time: string | number): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = typeof time === 'number' ? [time, 0] : time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0);
}

/** Instant → jour local du club « AAAA-MM-JJ ». */
export function localDayOf(instant: Date): string {
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
}

/** « 17:30 » → minutes depuis minuit. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Âge selon l'année de naissance au 31/12 de l'année de référence (règle provisoire, à confirmer). */
export function ageAtYearEnd(birthDate: Date, referenceYear: number): number {
  return referenceYear - birthDate.getUTCFullYear();
}
