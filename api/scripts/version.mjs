// Lance l'API en local dans la version voulue, sans modifier api/.env :
//   npm run dev:demo  → base de api/.env (démo), tous les modules
//   npm run dev:club  → base DATABASE_URL_CLUB de api/.env (copie locale de la base du club), modules du club,
//                       base protégée (TCSAY_PRODUCTION=true : seed refusé)
// Les variables posées ici passent avant celles de api/.env (process.loadEnvFile ne les remplace pas).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Même liste que MODULES_COUPES du service tcsay-club dans render.yaml (docs/VERSION_CLUB.md).
const CLUB_MODULES_COUPES = 'arabe,budget,disponibilites,evaluation-seances,bilans,exercices';

const version = process.argv[2];
const envFile = resolve(import.meta.dirname, '..', '.env');
const file = {};
if (existsSync(envFile)) {
  const before = { ...process.env };
  process.loadEnvFile(envFile);
  for (const k of Object.keys(process.env)) if (!(k in before)) file[k] = process.env[k];
  for (const k of Object.keys(file)) delete process.env[k];
}

const env = { ...process.env };
if (version === 'club') {
  const url = process.env.DATABASE_URL_CLUB ?? file.DATABASE_URL_CLUB;
  if (!url) {
    console.error(
      '✖ DATABASE_URL_CLUB manquant dans api/.env : adresse de la copie LOCALE de la base du club\n' +
        '  (ex. postgresql://tcsay:tcsay@localhost:5432/tcsay_club?schema=public). Voir docs/VERSION_CLUB.md « En local ».',
    );
    process.exit(1);
  }
  if (/neon\.tech|render\.com/.test(url)) console.warn('⚠ DATABASE_URL_CLUB pointe vers la base EN LIGNE du club : vos essais modifieront les vraies données.');
  Object.assign(env, { DATABASE_URL: url, MODULES_COUPES: CLUB_MODULES_COUPES, TCSAY_PRODUCTION: 'true', ALERT_INSTANCE: 'TCSAY club (local)' });
} else if (version === 'demo') {
  Object.assign(env, { MODULES_COUPES: '' });
} else {
  console.error('Usage : node scripts/version.mjs demo|club');
  process.exit(1);
}

console.log(`▶ API locale, version ${version === 'club' ? 'du club' : 'démo'}`);
const child = spawn('npm', ['run', 'start:dev'], { env, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
