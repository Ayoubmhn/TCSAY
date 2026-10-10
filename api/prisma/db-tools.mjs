// Outils de la base, sans dépendance : sauvegarde, restauration, état et application des migrations.
//   npm run db:backup                 → sauvegarde complète (JSON + pg_dump s'il est installé) dans api/backups/
//   npm run db:restore -- <fichier>   → restaure une sauvegarde JSON dans une base VIDE
//   npm run db:status                 → montre les modifications de structure en attente (ne change rien)
//   npm run db:migrate                → sauvegarde, puis applique les modifications en attente (après confirmation)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';
import { databaseName } from './guard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '..');
const backupDir = join(apiDir, 'backups');
const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');

const models = Prisma.dmmf.datamodel.models;
const delegate = (name) => name.charAt(0).toLowerCase() + name.slice(1);
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h');

function prisma(args, inherit = true) {
  return spawnSync(process.execPath, [prismaCli, ...args], { cwd: apiDir, stdio: inherit ? 'inherit' : 'pipe', encoding: 'utf8' });
}

/** pg_dump : dans le PATH, ou dans l'installation PostgreSQL de Windows. */
function findPgDump() {
  const inPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pg_dump'], { encoding: 'utf8' });
  if (inPath.status === 0) return inPath.stdout.split(/\r?\n/)[0].trim();
  const root = 'C:\\Program Files\\PostgreSQL';
  if (process.platform === 'win32' && existsSync(root)) {
    for (const v of readdirSync(root).sort().reverse()) {
      const exe = join(root, v, 'bin', 'pg_dump.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

async function backup(label = 'sauvegarde') {
  mkdirSync(backupDir, { recursive: true });
  const db = new PrismaClient();
  const tables = {};
  let rows = 0;
  try {
    await db.$queryRawUnsafe('SELECT 1 FROM "_prisma_migrations" LIMIT 1');
  } catch {
    await db.$disconnect();
    console.log('ℹ Base neuve (aucune table) : rien à sauvegarder.');
    return null;
  }
  for (const m of models) {
    tables[m.name] = await db[delegate(m.name)].findMany();
    rows += tables[m.name].length;
  }
  const migrations = await db.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name');
  await db.$disconnect();
  const base = `${stamp()}_${databaseName()}_${label}`;
  const jsonFile = join(backupDir, `${base}.json`);
  writeFileSync(
    jsonFile,
    JSON.stringify({ meta: { date: new Date().toISOString(), database: databaseName(), migrations: migrations.map((m) => m.migration_name) }, tables }),
  );
  console.log(`✔ Sauvegarde JSON : ${jsonFile} (${rows} lignes)`);

  const pgDump = findPgDump();
  if (pgDump) {
    const url = new URL(process.env.DATABASE_URL);
    url.search = '';
    const dumpFile = join(backupDir, `${base}.dump`);
    const r = spawnSync(pgDump, ['--format=custom', `--file=${dumpFile}`, url.toString()], { encoding: 'utf8' });
    if (r.status === 0) console.log(`✔ Sauvegarde pg_dump : ${dumpFile}`);
    else console.warn(`⚠ pg_dump a échoué (la sauvegarde JSON suffit) : ${r.stderr?.trim()}`);
  } else {
    console.log('ℹ pg_dump introuvable : sauvegarde JSON seulement (restaurable avec npm run db:restore).');
  }
  console.log('  Pensez à copier api/backups/ hors du PC (clé USB, Google Drive).');
  return jsonFile;
}

/** Ordre d'insertion : une table après celles qu'elle référence. */
function insertionOrder() {
  const deps = new Map(models.map((m) => [m.name, new Set(m.fields.filter((f) => f.relationFromFields?.length && f.type !== m.name).map((f) => f.type))]));
  const order = [];
  const done = new Set();
  while (order.length < models.length) {
    const next = models.find((m) => !done.has(m.name) && [...deps.get(m.name)].every((d) => done.has(d)));
    if (!next) throw new Error('Dépendances circulaires entre tables.');
    order.push(next.name);
    done.add(next.name);
  }
  return order;
}

async function restore(file) {
  if (!file || !existsSync(file)) throw new Error('Indiquez le fichier : npm run db:restore -- api/backups/<fichier>.json');
  const { meta, tables } = JSON.parse(readFileSync(file, 'utf8'));
  const db = new PrismaClient();
  if ((await db.user.count()) > 0) {
    await db.$disconnect();
    throw new Error(`la base « ${databaseName()} » n'est pas vide : la restauration se fait dans une base neuve (après npm run db:migrate).`);
  }
  console.log(`Restauration de ${file} (sauvegarde du ${meta.date}, base ${meta.database}) dans « ${databaseName()} »…`);
  for (const name of insertionOrder()) {
    const rows = tables[name] ?? [];
    for (let i = 0; i < rows.length; i += 500) await db[delegate(name)].createMany({ data: rows.slice(i, i + 500) });
    if (rows.length) console.log(`  ${name} : ${rows.length}`);
  }
  await db.$disconnect();
  console.log('✔ Restauration terminée.');
}

async function confirm(question) {
  if (process.argv.includes('--yes')) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim().toUpperCase() === 'OUI';
}

async function migrate() {
  console.log(`Base : « ${databaseName()} »${process.env.TCSAY_PRODUCTION === 'true' ? ' (PRODUCTION)' : ''}\n`);
  const status = prisma(['migrate', 'status'], false);
  const out = `${status.stdout ?? ''}${status.stderr ?? ''}`;
  if (status.status === 0 && /up to date/i.test(out)) {
    console.log('✔ Aucune modification de structure en attente : rien à faire.');
    return;
  }
  console.log(out.trim(), '\n');
  console.log('Les modifications ci-dessus vont être appliquées. Une sauvegarde complète est faite avant.');
  if (!(await confirm('Tapez OUI pour continuer : '))) {
    console.log('Annulé : la base n’a pas été modifiée.');
    return;
  }
  await backup('avant-migration');
  const r = prisma(['migrate', 'deploy']);
  if (r.status !== 0) process.exit(r.status ?? 1);
  prisma(['generate']);
  console.log('\n✔ Base à jour. Redémarrez l’API.');
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === 'backup') await backup();
  else if (command === 'restore') await restore(arg);
  else if (command === 'status') {
    console.log(`Base : « ${databaseName()} »\n`);
    prisma(['migrate', 'status']);
  } else if (command === 'migrate') await migrate();
  else console.log('Commandes : backup | restore <fichier> | status | migrate');
} catch (e) {
  console.error(`\n⛔ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
