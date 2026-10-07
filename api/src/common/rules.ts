import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SeasonStatus } from '@prisma/client';

/** Erreurs métier au format du prototype : « R2 · message ». */
export const rule = {
  conflict: (code: string, message: string) => new ConflictException(`${code} · ${message}`),
  bad: (code: string, message: string) => new BadRequestException(`${code} · ${message}`),
  forbidden: (code: string, message: string) => new ForbiddenException(`${code} · ${message}`),
};

export function notFound(what: string): NotFoundException {
  return new NotFoundException(`${what} introuvable.`);
}

/** R13 : la version envoyée doit correspondre à la version en base. */
export function assertVersion(current: { version: number }, sent: number | undefined, what = 'Cet élément'): void {
  if (sent !== undefined && current.version !== sent) {
    throw rule.conflict('R13', `${what} a été modifié par un autre administrateur : rechargez puis recommencez.`);
  }
}

export const LOCKED_SEASON: readonly SeasonStatus[] = [SeasonStatus.CLOSED, SeasonStatus.HISTORICAL];

/** R1 : aucune écriture sur une saison clôturée ou historique. */
export function assertSeasonOpen(season: { label: string; status: SeasonStatus }): void {
  if (LOCKED_SEASON.includes(season.status)) {
    throw rule.conflict('R1', `Saison ${season.label} verrouillée : rouvrez-la avec un motif avant toute modification.`);
  }
}

export const fullName = (p: { firstName: string; lastName: string }): string => `${p.firstName} ${p.lastName}`;
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
