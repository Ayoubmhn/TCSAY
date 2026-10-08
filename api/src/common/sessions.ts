import { addDaysIso, isoDay, localInstant, minutesOf, weekday } from './dates';

/** Saison avec ses deux périodes : compétitif (startDate → endDate, août inclus) et loisirs (octobre → juin). */
export type PeriodSeason = { startDate: Date; endDate: Date; leisureStartDate: Date | null; leisureEndDate: Date | null };
export type GroupKindLike = 'LEISURE' | 'COMPETITIVE';

/** Période d'entraînement d'un groupe selon son type (loisirs ou compétitif). */
export function groupPeriod(kind: GroupKindLike, season: PeriodSeason): { from: string; to: string } {
  if (kind === 'LEISURE') {
    return { from: isoDay(season.leisureStartDate ?? season.startDate), to: isoDay(season.leisureEndDate ?? season.endDate) };
  }
  return { from: isoDay(season.startDate), to: isoDay(season.endDate) };
}

/** Sélection Prisma à inclure dans `group` pour connaître la période d'un créneau. */
export const periodSelect = {
  kind: true,
  season: { select: { startDate: true, endDate: true, leisureStartDate: true, leisureEndDate: true } },
} as const;

/** Ajoute à un créneau sa période (périodeFrom / periodTo) à partir de son groupe. */
export function withPeriod<S extends { group: { kind: GroupKindLike; season: PeriodSeason } }>(slot: S): S & { periodFrom: string; periodTo: string } {
  const { from, to } = groupPeriod(slot.group.kind, slot.group.season);
  return { ...slot, periodFrom: from, periodTo: to };
}

/** Le créneau a-t-il lieu ce jour (bon jour de semaine, dans la période de son groupe) ? */
export function slotRunsOn(slot: { day: number; periodFrom?: string; periodTo?: string }, day: string): boolean {
  if (slot.day !== weekday(day)) return false;
  if (slot.periodFrom && day < slot.periodFrom) return false;
  if (slot.periodTo && day > slot.periodTo) return false;
  return true;
}

/**
 * Créneau hebdomadaire d'un groupe (GroupSlot) : chaque jour a son horaire, son terrain et ses entraîneurs.
 * Les séances ne sont pas stockées : elles découlent des créneaux.
 */
export type SlotLike = { id: string; day: number; startTime: string; endTime: string; periodFrom?: string; periodTo?: string };

export type Session<S extends SlotLike> = { slot: S; date: string; start: Date; end: Date; minutes: number };

/** Séances des créneaux entre deux jours inclus (« AAAA-MM-JJ »), triées par début. */
export function sessionsBetween<S extends SlotLike>(slots: S[], from: string, to: string): Session<S>[] {
  const out: Session<S>[] = [];
  for (let day = from; day <= to; day = addDaysIso(day, 1)) {
    for (const slot of slots) {
      if (slotRunsOn(slot, day)) {
        out.push({
          slot,
          date: day,
          start: localInstant(day, slot.startTime),
          end: localInstant(day, slot.endTime),
          minutes: minutesOf(slot.endTime) - minutesOf(slot.startTime),
        });
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

type Slot = Omit<SlotLike, 'id'>;

/** Deux créneaux se chevauchent-ils (même jour, horaires qui se croisent) ? */
export function slotsOverlap(a: Slot, b: Slot): boolean {
  return a.day === b.day && minutesOf(a.startTime) < minutesOf(b.endTime) && minutesOf(b.startTime) < minutesOf(a.endTime);
}

/** Le créneau occupe-t-il l'heure pleine `hour` (réservation d'une heure) ce jour-là ? */
export function slotOccupiesHour(slot: Slot & { periodFrom?: string; periodTo?: string }, day: string, hour: number): boolean {
  if (!slotRunsOn(slot, day)) return false;
  const start = hour * 60;
  return minutesOf(slot.startTime) < start + 60 && start < minutesOf(slot.endTime);
}

export const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
export const DAY_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Premier et dernier jour d'un mois « AAAA-MM ». */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
