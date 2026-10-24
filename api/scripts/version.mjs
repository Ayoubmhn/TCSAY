// Chaque version sur sa base, sans modifier api/.env ni taper d'export :
//   npm run dev:demo   → base DATABASE_URL_DEMO (données de démo), tous les modules
//   npm run dev:club   → base DATABASE_URL_CLUB (la vraie base du club), modules du club, protégée (seed refusé)
// Deuxième argument : la commande npm à lancer sur cette base (start:dev par défaut), ex.
//   node scripts/version.mjs demo db:demo   (npm run demo:reset : recharge les données de démo)
//   node scripts/version.mjs club db:status (npm run club:status)
//   node scripts/version.mjs demo prisma:deploy (npm run demo:migrate : nouvelles tables sur la base de démo)
// Les variables posées ici passent avant celles de api/.env (process.loadEnvFile ne les remplace pas).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Même liste que MODULES_COUPES du service tcsay-club dans render.yaml (docs/VERSION_CLUB.md).
const CLUB_MODULES_COUPES = 'arabe,budget,disponibilites,evaluation-seances,bilans,exercices';

const version = process.argv[2];
const command = process.argv[3] ?? 'start:dev';
const envFile = resolve(import.meta.dirname, '..', '.env');
const file = {};
if (existsSync(envFile)) {
  const before = { ...process.env };
  process.loadEnvFile(envFile);
  for (const k of Object.keys(process.env)) if (!(k in before)) file[k] = process.env[k];
  for (const k of Object.keys(file)) delete process.env[k];
}

const env = { ...process.env };
const pick = (k) => process.env[k] ?? file[k];
if (version === 'club') {
  const url = pick('DATABASE_URL_CLUB');
  if (!url) {
    console.error(
      '✖ DATABASE_URL_CLUB manquant dans api/.env : adresse de la vraie base du club (Neon, « Direct connection »).\n' +
        '  Voir docs/VERSION_CLUB.md « En local ».',
    );
    process.exit(1);
  }
  Object.assign(env, { DATABASE_URL: url, MODULES_COUPES: CLUB_MODULES_COUPES, TCSAY_PRODUCTION: 'true', ALERT_INSTANCE: 'TCSAY club (local)' });
} else if (version === 'demo') {
  const url = pick('DATABASE_URL_DEMO');
  if (!url) {
    console.error(
      '✖ DATABASE_URL_DEMO manquant dans api/.env : adresse de la base de DÉMO locale\n' +
        '  (ex. postgresql://tcsay:tcsay@localhost:5432/tcsay_demo?schema=public), puis npm run demo:reset pour la remplir.',
    );
    process.exit(1);
  }
  if (url === pick('DATABASE_URL_CLUB')) {
    console.error('✖ DATABASE_URL_DEMO et DATABASE_URL_CLUB sont la même base : la démo ne doit jamais utiliser la vraie base.');
    process.exit(1);
  }
  Object.assign(env, { DATABASE_URL: url, MODULES_COUPES: '', TCSAY_PRODUCTION: 'false' });
} else {
  console.error('Usage : node scripts/version.mjs demo|club [commande npm]');
  process.exit(1);
}

const base = (() => {
  try {
    return new URL(env.DATABASE_URL).pathname.slice(1) || '?';
  } catch {
    return '?';
  }
})();
console.log(`▶ Version ${version === 'club' ? 'du CLUB (vraies données)' : 'DÉMO'} · base « ${base} » · npm run ${command}`);
// Démo : nouvelles tables appliquées d'office avant de lancer l'API (jamais sur la base du club : npm run club:migrate,
// avec sauvegarde et confirmation).
if (version === 'demo' && command === 'start:dev') {
  const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { env, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const child = spawn('npm', ['run', command], { env, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
