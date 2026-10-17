// Verrous de la base de production : aucune commande de démonstration (seed, rechargement) ne peut l'effacer.
// Deux verrous indépendants :
//  1. TCSAY_PRODUCTION=true dans api/.env (ou l'environnement) ;
//  2. la base elle-même est marquée « production » (Setting database.mode), posé par db:init-prod.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile); // ne remplace pas les variables déjà définies

export const PRODUCTION_KEY = 'database.mode';

/** Nom de la base visée (pour les messages). */
export function databaseName() {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.replace('/', '') || '?';
  } catch {
    return '?';
  }
}

/** Refuse toute opération destructrice (effacement, données de démo) sur une base de production. */
export async function assertNotProduction(prisma, action) {
  const stop = (why) => {
    console.error(`\n⛔ ${action} refusé : ${why}`);
    console.error('   Les données réelles du club ne sont jamais effacées par les commandes de démonstration.');
    console.error('   Pour des essais, utilisez une autre base (ex. tcsay_demo) dans DATABASE_URL.\n');
    process.exit(1);
  };
  if (process.env.TCSAY_PRODUCTION === 'true') stop(`TCSAY_PRODUCTION=true (base « ${databaseName()} »).`);
  try {
    const mark = await prisma.setting.findUnique({ where: { key: PRODUCTION_KEY } });
    if (mark?.value === 'production') stop(`la base « ${databaseName()} » est une base de production.`);
  } catch {
    // tables absentes : base neuve, rien à protéger
  }
}
