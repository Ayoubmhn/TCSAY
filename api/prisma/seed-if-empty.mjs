// Hébergement de test : charge les données de démonstration au premier démarrage (base vide) seulement,
// ou à chaque démarrage si RESET_DEMO_DATA=true (remise à zéro des tests). Ne jamais utiliser en production réelle.
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { assertNotProduction } from './guard.mjs';

const prisma = new PrismaClient();
await assertNotProduction(prisma, 'Chargement des données de démonstration');
const users = await prisma.user.count();
await prisma.$disconnect();

if (users > 0 && process.env.RESET_DEMO_DATA !== 'true') {
  console.log(`Base déjà remplie (${users} comptes) : données conservées.`);
} else {
  console.log(users ? 'RESET_DEMO_DATA=true : rechargement des données de démonstration.' : 'Base vide : chargement des données de démonstration.');
  const run = spawnSync(process.execPath, ['prisma/seed.mjs'], { stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
