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

/** Emplois temporaires publiés d'un groupe (vacances, stage) : dates et mode (horaire remplacé ou séances en plus). */
export type TempPeriod = {
  mode: 'REPLACE' | 'ADD';
  scheduleId: string;
  schedule: {
    name: string;
    startDate: Date;
    endDate: Date;
    sessionsOwed?: boolean;
    /** ONE_OFF : séance ponctuelle (rattrapage MAKEUP, en plus EXTRA, spéciale SPECIAL). */
    kind?: 'HOLIDAY' | 'ONE_OFF';
    oneOffType?: string | null;
    makeupSlotId?: string | null;
    makeupDate?: Date | null;
  };
};
export type PeriodGroup = { kind: GroupKindLike; season: PeriodSeason; tempSchedules: TempPeriod[] };

/** Emplois temporaires à joindre au groupe : seulement publiés et non archivés (un brouillon ne change rien). */
export const tempSchedulesSelect = {
  where: { schedule: { status: 'PUBLISHED', archivedAt: null } },
  select: {
    mode: true,
    scheduleId: true,
    schedule: { select: { name: true, startDate: true, endDate: true, sessionsOwed: true, kind: true, oneOffType: true, makeupSlotId: true, makeupDate: true } },
  },
} as const;

/** Sélection Prisma à inclure dans `group` pour connaître la période d'un créneau. */
export const periodSelect = {
  kind: true,
  season: { select: { startDate: true, endDate: true, leisureStartDate: true, leisureEndDate: true } },
  tempSchedules: tempSchedulesSelect,
} as const;

/** Dates d'un créneau : période de son groupe, jours retirés (emploi temporaire qui remplace l'horaire), vacances. */
export type SlotPeriod = { periodFrom: string; periodTo: string; excluded: { from: string; to: string }[]; holiday: string | null };

/**
 * Ajoute à un créneau ses dates de séance :
 * - créneau habituel : période du groupe, moins les emplois temporaires publiés qui remplacent son horaire ;
 * - créneau d'un emploi temporaire : seulement les dates de cet emploi, une fois publié (brouillon : jamais).
 */
export function withPeriod<S extends { scheduleId?: string | null; group: PeriodGroup }>(slot: S): S & SlotPeriod {
  const temps = slot.group.tempSchedules ?? [];
  if (slot.scheduleId) {
    const t = temps.find((x) => x.scheduleId === slot.scheduleId);
    if (!t) return { ...slot, periodFrom: '9999-12-31', periodTo: '0000-01-01', excluded: [], holiday: null };
    return { ...slot, periodFrom: isoDay(t.schedule.startDate), periodTo: isoDay(t.schedule.endDate), excluded: [], holiday: t.schedule.name };
  }
  const { from, to } = groupPeriod(slot.group.kind, slot.group.season);
  const excluded = temps.filter((t) => t.mode === 'REPLACE').map((t) => ({ from: isoDay(t.schedule.startDate), to: isoDay(t.schedule.endDate) }));
  return { ...slot, periodFrom: from, periodTo: to, excluded, holiday: null };
}

type RunsOn = { day: number; periodFrom?: string; periodTo?: string; excluded?: { from: string; to: string }[] };

/** Le créneau a-t-il lieu ce jour (bon jour de semaine, dans la période de son groupe, hors horaire remplacé) ? */
export function slotRunsOn(slot: RunsOn, day: string): boolean {
  if (slot.day !== weekday(day)) return false;
  if (slot.periodFrom && day < slot.periodFrom) return false;
  if (slot.periodTo && day > slot.periodTo) return false;
  if (slot.excluded?.some((r) => day >= r.from && day <= r.to)) return false;
  return true;
}

/**
 * Créneau hebdomadaire d'un groupe (GroupSlot) : chaque jour a son horaire, son terrain et ses entraîneurs.
 * Les séances ne sont pas stockées : elles découlent des créneaux.
 */
export type SlotLike = RunsOn & { id: string; startTime: string; endTime: string };

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

type Slot = { day: number; startTime: string; endTime: string };

/** Deux créneaux se chevauchent-ils (même jour, horaires qui se croisent) ? */
export function slotsOverlap(a: Slot, b: Slot): boolean {
  return a.day === b.day && minutesOf(a.startTime) < minutesOf(b.endTime) && minutesOf(b.startTime) < minutesOf(a.endTime);
}

/** Le créneau occupe-t-il l'intervalle [startMin, startMin + durationMin[ (minutes depuis minuit) ce jour-là ? */
export function slotOccupies(
  slot: Slot & RunsOn,
  day: string,
  startMin: number,
  durationMin = 60,
): boolean {
  if (!slotRunsOn(slot, day)) return false;
  return minutesOf(slot.startTime) < startMin + durationMin && startMin < minutesOf(slot.endTime);
}

/** Le créneau occupe-t-il l'heure pleine `hour` (réservation d'une heure) ce jour-là ? */
export function slotOccupiesHour(slot: Slot & RunsOn, day: string, hour: number): boolean {
  return slotOccupies(slot, day, hour * 60);
}

export const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
export const DAY_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Premier et dernier jour d'un mois « AAAA-MM ». */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
