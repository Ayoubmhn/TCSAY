import { addDaysIso, localInstant, minutesOf, weekday } from './dates';

/**
 * Créneau hebdomadaire d'un groupe (GroupSlot) : chaque jour a son horaire, son terrain et ses entraîneurs.
 * Les séances ne sont pas stockées : elles découlent des créneaux.
 */
export type SlotLike = { id: string; day: number; startTime: string; endTime: string };

export type Session<S extends SlotLike> = { slot: S; date: string; start: Date; end: Date; minutes: number };

/** Séances des créneaux entre deux jours inclus (« AAAA-MM-JJ »), triées par début. */
export function sessionsBetween<S extends SlotLike>(slots: S[], from: string, to: string): Session<S>[] {
  const out: Session<S>[] = [];
  for (let day = from; day <= to; day = addDaysIso(day, 1)) {
    const wd = weekday(day);
    for (const slot of slots) {
      if (slot.day === wd) {
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
export function slotOccupiesHour(slot: Slot, day: string, hour: number): boolean {
  if (slot.day !== weekday(day)) return false;
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
