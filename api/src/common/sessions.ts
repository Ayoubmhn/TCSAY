import { addDaysIso, localInstant, minutesOf, weekday } from './dates';

/** Groupe minimal pour calculer ses séances (les séances ne sont pas stockées : elles découlent du créneau). */
export type Schedulable = { id: string; days: number[]; startTime: string; endTime: string };

export type Session<G extends Schedulable> = { group: G; date: string; start: Date; end: Date };

/** Séances des groupes entre deux jours inclus (« AAAA-MM-JJ »), triées par début. */
export function sessionsBetween<G extends Schedulable>(groups: G[], from: string, to: string): Session<G>[] {
  const out: Session<G>[] = [];
  for (let day = from; day <= to; day = addDaysIso(day, 1)) {
    const wd = weekday(day);
    for (const group of groups) {
      if (group.days.includes(wd)) {
        out.push({ group, date: day, start: localInstant(day, group.startTime), end: localInstant(day, group.endTime) });
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Deux créneaux hebdomadaires se chevauchent-ils (même jour, horaires qui se croisent) ? */
type Slot = Omit<Schedulable, 'id'>;

export function slotsOverlap(a: Slot, b: Slot): boolean {
  if (!a.days.some((d) => b.days.includes(d))) return false;
  return minutesOf(a.startTime) < minutesOf(b.endTime) && minutesOf(b.startTime) < minutesOf(a.endTime);
}

/** Le groupe occupe-t-il son terrain à cette heure pleine (créneau d'une heure) ce jour-là ? */
export function groupOccupiesHour(group: Slot, day: string, hour: number): boolean {
  if (!group.days.includes(weekday(day))) return false;
  const start = hour * 60;
  return minutesOf(group.startTime) < start + 60 && start < minutesOf(group.endTime);
}

export const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
