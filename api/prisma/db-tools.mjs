// Outils de la base, sans dépendance : sauvegarde, restauration, état et application des migrations.
//   npm run db:backup                 → sauvegarde complète (JSON + pg_dump s'il est installé) dans api/backups/
//   npm run db:backup -- --keep 30    → idem, puis ne garde que les 30 sauvegardes « sauvegarde » les plus récentes
//   BACKUP_DIR=…                      → autre dossier (ex. dossier Google Drive / OneDrive synchronisé : copie hors du PC)
//   npm run db:restore -- <fichier>   → restaure une sauvegarde JSON dans une base VIDE
//   npm run db:status                 → montre les modifications de structure en attente (ne change rien)
//   npm run db:migrate                → sauvegarde, puis applique les modifications en attente (après confirmation)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';
import { databaseName } from './guard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '..');
const backupDir = process.env.BACKUP_DIR ? resolve(process.env.BACKUP_DIR) : join(apiDir, 'backups');
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
  // Lecture brute (SELECT *) : la sauvegarde marche même si la base a un temps de retard sur le schéma
  // (cas de db:migrate, qui sauvegarde AVANT d'ajouter les nouvelles colonnes et tables).
  for (const m of models) {
    try {
      tables[m.name] = await db.$queryRawUnsafe(`SELECT * FROM "${m.name}"`);
    } catch {
      tables[m.name] = []; // table pas encore créée
    }
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
  console.log(process.env.BACKUP_DIR ? `  Dossier : ${backupDir}` : '  Pensez à copier api/backups/ hors du PC (clé USB, Google Drive), ou réglez BACKUP_DIR.');
  return jsonFile;
}

/** Rotation : ne garde que les `keep` dernières sauvegardes ordinaires (celles « avant-migration » sont toutes gardées). */
function prune(keep) {
  if (!Number.isInteger(keep) || keep < 1) return;
  const files = readdirSync(backupDir).filter((f) => /_sauvegarde\.(json|dump)$/.test(f));
  const bases = [...new Set(files.map((f) => f.replace(/\.(json|dump)$/, '')))].sort().reverse();
  for (const base of bases.slice(keep)) {
    for (const ext of ['json', 'dump']) rmSync(join(backupDir, `${base}.${ext}`), { force: true });
    console.log(`  Ancienne sauvegarde supprimée : ${base}`);
  }
}

/**
 * Ordre d'insertion : une table après celles qu'elle référence. Deux tables qui se citent l'une l'autre (ex. un projet et
 * son devis choisi) : la référence facultative est d'abord laissée vide, puis remise une fois les deux tables copiées.
 */
function insertionOrder() {
  const relations = (m) => m.fields.filter((f) => f.relationFromFields?.length && f.type !== m.name);
  const order = [];
  const deferred = new Map(); // table → champs remis après coup
  const done = new Set();
  while (order.length < models.length) {
    let next = models.find((m) => !done.has(m.name) && relations(m).every((f) => done.has(f.type)));
    if (!next) {
      // Cycle : une table dont les références manquantes sont toutes facultatives.
      next = models.find((m) => !done.has(m.name) && relations(m).every((f) => done.has(f.type) || !f.isRequired));
      if (!next) throw new Error('Dépendances circulaires entre tables.');
      deferred.set(
        next.name,
        relations(next)
          .filter((f) => !done.has(f.type))
          .flatMap((f) => f.relationFromFields),
      );
    }
    order.push(next.name);
    done.add(next.name);
  }
  return { order, deferred };
}

/**
 * Valeurs relues du JSON : fichiers (Bytes, enregistrés { type: 'Buffer', data }) remis en octets ; champ JSON vide = DbNull
 * (Prisma refuse null pour un champ JSON).
 */
function revive(name, row) {
  const model = models.find((m) => m.name === name);
  const out = { ...row };
  for (const f of model.fields) {
    const v = out[f.name];
    if (f.type === 'Bytes' && v && typeof v === 'object' && !Buffer.isBuffer(v)) out[f.name] = Buffer.from(v.type === 'Buffer' ? v.data : Object.values(v));
    if (f.type === 'Json' && v === null) out[f.name] = Prisma.DbNull;
  }
  return out;
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
  const { order, deferred } = insertionOrder();
  for (const name of order) {
    const later = deferred.get(name) ?? [];
    const rows = (tables[name] ?? []).map((r) => revive(name, later.length ? { ...r, ...Object.fromEntries(later.map((k) => [k, null])) } : r));
    for (let i = 0; i < rows.length; i += 500) await db[delegate(name)].createMany({ data: rows.slice(i, i + 500) });
    if (rows.length) console.log(`  ${name} : ${rows.length}`);
  }
  // Références laissées vides pendant la copie (cycles) : remises maintenant.
  for (const [name, fields] of deferred) {
    for (const row of tables[name] ?? []) {
      const data = Object.fromEntries(fields.filter((k) => row[k] != null).map((k) => [k, row[k]]));
      if (Object.keys(data).length) await db[delegate(name)].update({ where: { id: row.id }, data });
    }
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

/** Arrête tout si le serveur PostgreSQL ne répond pas (sinon une base injoignable passerait pour une base vide). */
async function assertReachable() {
  const db = new PrismaClient();
  try {
    await db.$queryRawUnsafe('SELECT 1');
  } catch (e) {
    if (e instanceof Prisma.PrismaClientInitializationError) {
      let where = 'le serveur';
      let user = '?';
      try {
        const u = new URL(process.env.DATABASE_URL ?? '');
        where = `${u.hostname}:${u.port || 5432}`;
        user = decodeURIComponent(u.username);
      } catch {
        /* adresse illisible : message générique */
      }
      const msg = e.message;
      const kind = /Authentication failed/i.test(msg) ? 'auth' : /does not exist/i.test(msg) ? 'nodb' : /Can't reach/i.test(msg) ? 'down' : 'other';
      const why = {
        auth: `connexion refusée pour l’utilisateur « ${user} » sur ${where} (mot de passe faux ou utilisateur inconnu sur ce serveur).`,
        nodb: `la base « ${databaseName()} » n’existe pas sur ${where}.`,
        down: `serveur PostgreSQL injoignable (${where}).`,
        other: msg.split('\n').filter(Boolean).slice(-2).join(' '),
      }[kind];
      const help =
        kind === 'down'
          ? 'Démarrez PostgreSQL (Windows : services.msc → « postgresql-x64-… » → Démarrer ; Docker : docker compose up -d), puis relancez.'
          : 'Vérifiez DATABASE_URL dans api/.env : est-ce le bon serveur (port), la bonne base et le bon utilisateur ?';
      throw new Error(`${why}\n   Rien n’a été lu ni modifié. ${help}`);
    }
    throw e;
  } finally {
    await db.$disconnect();
  }
}

async function migrate() {
  console.log(`Base : « ${databaseName()} »${process.env.TCSAY_PRODUCTION === 'true' ? ' (PRODUCTION)' : ''}\n`);
  await assertReachable();
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

/** Contenu de la base (pour savoir tout de suite si elle est vide, de démo ou réelle). */
async function contents() {
  const db = new PrismaClient();
  try {
    const [users, players, payments, matches, demo] = await Promise.all([
      db.user.count(),
      db.player.count(),
      db.payment.count(),
      db.match.count().catch(() => 0),
      db.user.count({ where: { email: 'admin@tcsay.tn' } }),
    ]);
    if (!users && !players) console.log('⚠ Base VIDE : aucun compte, aucun joueur.\n');
    else console.log(`Contenu : ${users} compte(s), ${players} joueur(s), ${payments} paiement(s), ${matches} match(s)${demo ? ' · données de DÉMO (admin@tcsay.tn)' : ''}\n`);
  } catch {
    console.log('⚠ Tables absentes : base neuve (lancez npm run db:migrate, ou npm run db:demo pour une base de test).\n');
  } finally {
    await db.$disconnect();
  }
}

const [command, arg, value] = process.argv.slice(2);
try {
  if (['backup', 'restore', 'status'].includes(command)) await assertReachable();
  if (command === 'backup') {
    await backup();
    if (arg === '--keep') prune(Number(value));
  }
  else if (command === 'restore') await restore(arg);
  else if (command === 'status') {
    console.log(`Base : « ${databaseName()} »\n`);
    await contents();
    prisma(['migrate', 'status']);
  } else if (command === 'migrate') await migrate();
  else console.log('Commandes : backup | restore <fichier> | status | migrate');
} catch (e) {
  console.error(`\n⛔ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
