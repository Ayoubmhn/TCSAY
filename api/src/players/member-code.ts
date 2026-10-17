import { Db } from '../prisma/prisma.service';

/**
 * Identifiant du club d'un joueur : « 26TCSAY052 » = année de première inscription (2 chiffres) + TCSAY + n° dans l'année.
 * Le n° repart à 001 chaque année. Les codes restent PROVISOIRES jusqu'à l'import de l'historique : ils sont alors
 * recalculés (première saison réelle de chaque joueur), puis validés définitivement par le président.
 */
export const formatMemberCode = (year: number, seq: number) =>
  `${String(year % 100).padStart(2, '0')}TCSAY${String(seq).padStart(3, '0')}`;

/** Prochain code libre pour une année (verrou transactionnel : pas de doublon entre deux créations simultanées). */
export async function nextMemberCode(tx: Db, year: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('player-member-code'))`;
  const last = await tx.player.aggregate({ where: { memberYear: year }, _max: { memberSeq: true } });
  const seq = (last._max.memberSeq ?? 0) + 1;
  return { memberYear: year, memberSeq: seq, memberCode: formatMemberCode(year, seq) };
}
