// Données de DÉMONSTRATION : les 4 saisons du prototype v4. Idempotent (upsert sur le libellé).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEASONS = [
  { label: '2010-2011', startDate: '2010-09-01', endDate: '2011-06-30', status: 'HISTORICAL' },
  { label: '2025-2026', startDate: '2025-09-01', endDate: '2026-06-30', status: 'CLOSED' },
  { label: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'ACTIVE' },
  { label: '2027-2028', startDate: '2027-09-01', endDate: '2028-06-30', status: 'DRAFT' },
];

const day = (d) => new Date(`${d}T00:00:00.000Z`);

async function main() {
  // R2 : on libère le statut ACTIVE avant de poser celui de la démo.
  await prisma.season.updateMany({
    where: { status: 'ACTIVE', NOT: { label: '2026-2027' } },
    data: { status: 'CLOSED', version: { increment: 1 } },
  });
  for (const s of SEASONS) {
    const data = { startDate: day(s.startDate), endDate: day(s.endDate), status: s.status, archivedAt: null };
    await prisma.season.upsert({
      where: { label: s.label },
      create: { label: s.label, ...data },
      update: { ...data, version: { increment: 1 } },
    });
  }
  console.log(`Seed : ${SEASONS.length} saisons de démonstration.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
