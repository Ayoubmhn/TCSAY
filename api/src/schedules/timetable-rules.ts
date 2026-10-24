import { BadRequestException, ConflictException } from '@nestjs/common';
import { SlotKind } from '@prisma/client';
import { minutesOf } from '../common/dates';
import { DAY_LONG, slotsOverlap } from '../common/sessions';

/** Créneau tel que placé sur la grille (habituel, brouillon ou emploi temporaire). */
export type Placed = {
  id?: string;
  groupId: string;
  groupName: string;
  day: number;
  startTime: string;
  endTime: string;
  courtId?: string | null;
  coachIds: string[];
  kind?: SlotKind;
};

/** Volumes d'un groupe : tennis et séance physique (null = libre / pas de séance physique). */
export type GroupVolumes = {
  name: string;
  weeklyMinutes: number | null;
  sessionMinutes: number | null;
  physicalMinutes: number | null;
  physicalSessionMinutes: number | null;
};

export const durationOf = (s: { startTime: string; endTime: string }) => minutesOf(s.endTime) - minutesOf(s.startTime);

/** « 1 h 30 », « 45 min », « 3 h ». */
export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/**
 * Volume par semaine jamais dépassé et durée de chaque séance respectée (tennis et physique comptés à part).
 * Séance physique refusée si le groupe n'en prévoit pas.
 */
export function assertVolumes(group: GroupVolumes, slots: { startTime: string; endTime: string; kind?: SlotKind | null }[]) {
  for (const s of slots) {
    if (durationOf(s) <= 0) throw new BadRequestException(`« ${group.name} » : l’heure de fin doit suivre l’heure de début.`);
  }
  const tennis = slots.filter((s) => (s.kind ?? SlotKind.TENNIS) === SlotKind.TENNIS);
  const physical = slots.filter((s) => s.kind === SlotKind.PHYSICAL);
  check(group.name, 'tennis', tennis, group.weeklyMinutes, group.sessionMinutes);
  if (physical.length && !group.physicalMinutes) {
    throw new ConflictException(`« ${group.name} » n’a pas de séance physique prévue : réglez-la dans le groupe d’abord.`);
  }
  check(group.name, 'physique', physical, group.physicalMinutes, group.physicalSessionMinutes);
}

function check(name: string, what: string, slots: { startTime: string; endTime: string }[], weekly: number | null, session: number | null) {
  if (session) {
    const bad = slots.find((s) => durationOf(s) !== session);
    if (bad) {
      throw new ConflictException(`« ${name} » : chaque séance de ${what} dure ${hm(session)} (${bad.startTime}–${bad.endTime} = ${hm(durationOf(bad))}).`);
    }
  }
  if (weekly) {
    const total = slots.reduce((t, s) => t + durationOf(s), 0);
    if (total > weekly) {
      throw new ConflictException(`« ${name} » : ${hm(weekly)} de ${what} par semaine au plus (${hm(total)} placées).`);
    }
  }
}

/**
 * R5 : premier conflit entre des créneaux d'un groupe et les autres (même terrain, même entraîneur, ou le même groupe à deux
 * endroits à la fois), sinon null. `others` exclut déjà les créneaux remplacés par les candidats.
 */
export function findConflict(candidates: Placed[], others: Placed[]): string | null {
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (slotsOverlap(a, b)) {
        return `Deux séances de « ${a.groupName} » se chevauchent le ${DAY_LONG[a.day]} (${a.startTime} et ${b.startTime}).`;
      }
    }
  }
  for (const c of candidates) {
    for (const o of others) {
      if (!slotsOverlap(c, o)) continue;
      if (o.groupId === c.groupId) return `« ${c.groupName} » a déjà une séance le ${DAY_LONG[c.day]} de ${o.startTime} à ${o.endTime}.`;
      if (c.courtId && o.courtId === c.courtId) {
        return `Terrain déjà occupé le ${DAY_LONG[c.day]} de ${o.startTime} à ${o.endTime} par « ${o.groupName} ».`;
      }
      if (c.coachIds.some((x) => o.coachIds.includes(x))) {
        return `Entraîneur déjà pris le ${DAY_LONG[c.day]} de ${o.startTime} à ${o.endTime} (« ${o.groupName} »).`;
      }
    }
  }
  return null;
}
