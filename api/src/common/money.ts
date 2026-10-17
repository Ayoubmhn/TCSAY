import { Prisma } from '@prisma/client';

/** Decimal Prisma (ou nombre) → nombre arrondi au millime. */
export function num(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : value.toNumber();
  return Math.round(n * 1000) / 1000;
}

/** « 1 250 DT » (format français). */
export function dt(value: Prisma.Decimal | number): string {
  return `${num(value).toLocaleString('fr-FR')} DT`;
}
