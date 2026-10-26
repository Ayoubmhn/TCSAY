// Recopie les emplois du temps de la démo LOCALE vers la démo EN LIGNE (jamais vers la base du club) :
//   npm run demo:copy-timetable            → aperçu, puis « OUI » pour appliquer
//   npm run demo:copy-timetable -- --yes   → sans question
// Source : DATABASE_URL_DEMO (api/.env). Cible : DATABASE_URL_DEMO_ONLINE (api/.env, adresse Neon de la démo en ligne,
// « Direct connection »). La base en ligne doit déjà avoir les nouvelles tables (Render › tcsay-demo › Manual Deploy).
// Recopié, par saison (même nom) : groupes (même nom ; créés s'ils manquent, sans joueurs), volumes, entraîneur principal,
// terrain de préférence, horaire habituel, brouillons, emplois des vacances et leurs séances. Terrains reconnus par leur nom,
// entraîneurs par leur email, catégories par leur code. Une séance en ligne déjà pointée n'est jamais supprimée (R8) :
// elle est déplacée sur une séance de la démo locale.
import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const envFile = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const srcUrl = process.env.DATABASE_URL_DEMO;
const dstUrl = process.env.DATABASE_URL_DEMO_ONLINE;
const stop = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};
if (!srcUrl) stop('DATABASE_URL_DEMO manquant dans api/.env (base de démo locale).');
if (!dstUrl)
  stop('DATABASE_URL_DEMO_ONLINE manquant dans api/.env : adresse Neon de la démo EN LIGNE (« Direct connection »). Ne la partagez pas.');
const same = (a, b) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
};
if (same(srcUrl, dstUrl)) stop('DATABASE_URL_DEMO et DATABASE_URL_DEMO_ONLINE sont la même base.');
if (process.env.DATABASE_URL_CLUB && same(dstUrl, process.env.DATABASE_URL_CLUB))
  stop('DATABASE_URL_DEMO_ONLINE est la base du CLUB : copie refusée.');

const src = new PrismaClient({ datasources: { db: { url: srcUrl } } });
const dst = new PrismaClient({ datasources: { db: { url: dstUrl } } });

const mark = await dst.setting.findUnique({ where: { key: 'database.mode' } }).catch(() => null);
if (mark?.value === 'production') stop('la base en ligne visée est une base de production (club) : copie refusée.');
try {
  await dst.timetableDraft.count();
  await dst.tempSchedule.count();
} catch {
  stop('la démo en ligne n’a pas encore les tables de l’emploi du temps : Render › tcsay-demo › Manual Deploy, puis relancez.');
}

const slotInclude = { coaches: { include: { coach: { include: { user: { select: { email: true } } } } } }, court: { select: { name: true } } };
const sig = (s) => `${s.day}|${s.startTime}|${s.endTime}|${s.courtId ?? ''}|${[...s.coachIds].sort().join(',')}|${s.kind}`;

// Correspondances source → cible
const [dCourts, dCoaches, dCats, dSeasons, dUsers] = await Promise.all([
  dst.court.findMany(),
  dst.coach.findMany({ include: { user: { select: { email: true, cin: true, firstName: true, lastName: true } } } }),
  dst.category.findMany(),
  dst.season.findMany(),
  dst.user.findMany({ select: { id: true, email: true, roles: true } }),
]);
const [sCourts, sCoaches, sCats] = await Promise.all([
  src.court.findMany(),
  src.coach.findMany({ include: { user: { select: { email: true, cin: true, firstName: true, lastName: true } } } }),
  src.category.findMany(),
]);
const warnings = new Set();
const courtMap = new Map(sCourts.map((c) => [c.id, dCourts.find((d) => d.name === c.name)?.id ?? null]));
const sameCoach = (a, b) => (a.email && a.email === b.email) || (a.cin && a.cin === b.cin);
const coachMap = new Map(sCoaches.map((c) => [c.id, dCoaches.find((d) => sameCoach(d.user, c.user))?.id ?? null]));
const coachName = (id) => {
  const u = sCoaches.find((c) => c.id === id)?.user;
  return u ? `${u.firstName} ${u.lastName}`.trim() : id;
};
const catMap = new Map(sCats.map((c) => [c.id, dCats.find((d) => d.code === c.code)?.id ?? null]));
const president = dUsers.find((u) => u.roles.includes('PRESIDENT')) ?? dUsers.find((u) => u.roles.includes('ADMIN_AGENT'));
const userMap = async (id) => {
  if (!id) return null;
  const u = await src.user.findUnique({ where: { id }, select: { email: true } });
  return dUsers.find((d) => d.email && d.email === u?.email)?.id ?? president?.id ?? null;
};
const court = (id) => {
  if (!id) return null;
  const m = courtMap.get(id);
  if (!m) warnings.add(`Terrain « ${sCourts.find((c) => c.id === id)?.name} » absent en ligne : séance sans terrain.`);
  return m ?? null;
};
const coaches = (ids) =>
  ids
    .map((id) => {
      const m = coachMap.get(id);
      if (!m) warnings.add(`Entraîneur « ${coachName(id)} » absent en ligne (même email ou CIN) : retiré des séances. Créez-le d’abord en ligne.`);
      return m;
    })
    .filter(Boolean);
/** Séance de la base source → forme cible (terrain et entraîneurs de la démo en ligne). */
const mapSlot = (s) => ({
  id: s.id,
  day: s.day,
  startTime: s.startTime,
  endTime: s.endTime,
  courtId: court(s.courtId),
  coachIds: coaches(s.coachIds ?? s.coaches.map((c) => c.coachId)),
  kind: s.kind,
});

const linkedSlots = async (db, ids) => {
  if (!ids.length) return new Set();
  const where = { slotId: { in: ids } };
  const rows = await Promise.all([
    db.attendance.findMany({ where, select: { slotId: true }, distinct: ['slotId'] }),
    db.sessionPlan.findMany({ where, select: { slotId: true }, distinct: ['slotId'] }),
    db.sessionRating.findMany({ where, select: { slotId: true }, distinct: ['slotId'] }),
    db.coachAbsence.findMany({ where, select: { slotId: true }, distinct: ['slotId'] }),
  ]);
  return new Set(rows.flat().map((r) => r.slotId));
};

// ——— Plan (aperçu), puis application dans une transaction ———
const plan = []; // fonctions (tx) => Promise
const summary = [];
const slotIdMap = new Map(); // id séance source → id séance cible (pour les brouillons)

/** Aligne les séances d'un groupe (horaire habituel ou d'un emploi des vacances) sur celles de la source. */
async function planSlots(label, dGroupId, scheduleKey, wanted, existing) {
  // wanted : séances source mappées ; existing : séances cible (avec coachIds)
  const linked = await linkedSlots(dst, existing.map((s) => s.id));
  const leftT = [...existing];
  const pairs = [];
  const leftS = [];
  for (const w of wanted) {
    const i = leftT.findIndex((t) => sig(t) === sig(w));
    if (i >= 0) pairs.push([w, leftT.splice(i, 1)[0], false]);
    else leftS.push(w);
  }
  leftT.sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)));
  while (leftS.length && leftT.length) pairs.push([leftS.shift(), leftT.shift(), true]);
  const kept = leftT.filter((t) => linked.has(t.id));
  const removed = leftT.filter((t) => !linked.has(t.id));
  if (kept.length) warnings.add(`${label} : ${kept.length} séance(s) en ligne déjà pointée(s) gardée(s) (R8).`);
  const moved = pairs.filter((p) => p[2]).length;
  if (leftS.length || moved || removed.length) summary.push(`  ${label} : ${leftS.length} ajoutée(s), ${moved} modifiée(s), ${removed.length} retirée(s)`);
  for (const [w, t] of pairs) slotIdMap.set(w.id, t.id);
  plan.push(async (tx, ids) => {
    const groupId = ids.group(dGroupId);
    const scheduleId = scheduleKey ? ids.schedule(scheduleKey) : null;
    if (removed.length) await tx.groupSlot.deleteMany({ where: { id: { in: removed.map((t) => t.id) } } });
    for (const [w, t, change] of pairs) {
      if (!change) continue;
      await tx.slotCoach.deleteMany({ where: { slotId: t.id } });
      await tx.groupSlot.update({
        where: { id: t.id },
        data: { day: w.day, startTime: w.startTime, endTime: w.endTime, courtId: w.courtId, kind: w.kind, coaches: { create: w.coachIds.map((coachId) => ({ coachId })) } },
      });
    }
    for (const w of leftS) {
      const created = await tx.groupSlot.create({
        data: {
          groupId,
          scheduleId,
          day: w.day,
          startTime: w.startTime,
          endTime: w.endTime,
          courtId: w.courtId,
          kind: w.kind,
          coaches: { create: w.coachIds.map((coachId) => ({ coachId })) },
        },
      });
      slotIdMap.set(w.id, created.id);
    }
  });
}

const withCoachIds = (s) => ({ ...s, coachIds: s.coaches.map((c) => c.coachId) });
const newGroups = new Map(); // nom → id créé (dans la transaction)
const newSchedules = new Map();

const sSeasons = await src.season.findMany({ orderBy: { startDate: 'asc' } });
for (const ss of sSeasons) {
  const ds = dSeasons.find((d) => d.label === ss.label);
  const sGroups = await src.trainingGroup.findMany({ where: { seasonId: ss.id }, include: { slots: { include: slotInclude } } });
  const drafts = await src.timetableDraft.findMany({ where: { seasonId: ss.id } });
  const temps = await src.tempSchedule.findMany({ where: { seasonId: ss.id }, include: { groups: true } });
  if (!ds) {
    if (sGroups.length) warnings.add(`Saison « ${ss.label} » absente en ligne : ignorée.`);
    continue;
  }
  if (ds.status === 'CLOSED' || ds.status === 'HISTORICAL') {
    warnings.add(`Saison « ${ss.label} » clôturée en ligne (R1) : ignorée.`);
    continue;
  }
  summary.push(`Saison « ${ss.label} »`);
  const dGroups = await dst.trainingGroup.findMany({ where: { seasonId: ds.id }, include: { slots: { include: slotInclude } } });
  const groupKey = new Map(); // id groupe source → clé cible (id existant ou « new:nom »)

  for (const g of sGroups) {
    const dg = dGroups.find((d) => d.name === g.name);
    const data = {
      kind: g.kind,
      capacity: g.capacity,
      categoryId: g.categoryId ? (catMap.get(g.categoryId) ?? null) : null,
      weeklyMinutes: g.weeklyMinutes,
      sessionMinutes: g.sessionMinutes,
      physicalMinutes: g.physicalMinutes,
      physicalSessionMinutes: g.physicalSessionMinutes,
      mainCoachId: g.mainCoachId ? (coachMap.get(g.mainCoachId) ?? null) : null,
      physicalCoachId: g.physicalCoachId ? (coachMap.get(g.physicalCoachId) ?? null) : null,
      preferredCourtId: g.preferredCourtId ? (courtMap.get(g.preferredCourtId) ?? null) : null,
      archivedAt: g.archivedAt,
    };
    const key = dg ? dg.id : `new:${g.name}`;
    groupKey.set(g.id, key);
    if (dg) plan.push((tx) => tx.trainingGroup.update({ where: { id: dg.id }, data: { ...data, version: { increment: 1 } } }));
    else {
      summary.push(`  Groupe créé : « ${g.name} » (sans joueurs)`);
      plan.push(async (tx) => newGroups.set(key, (await tx.trainingGroup.create({ data: { ...data, seasonId: ds.id, name: g.name } })).id));
    }
    const wanted = g.slots.filter((s) => !s.scheduleId).map((s) => mapSlot(withCoachIds(s)));
    const existing = (dg?.slots ?? []).filter((s) => !s.scheduleId).map(withCoachIds);
    await planSlots(`« ${g.name} » (horaire habituel)`, key, null, wanted, existing);
  }

  // Emplois des vacances (même nom)
  const dTemps = await dst.tempSchedule.findMany({ where: { seasonId: ds.id }, include: { groups: true } });
  for (const t of temps) {
    const dt = dTemps.find((d) => d.name === t.name);
    const skey = dt ? dt.id : `new:${t.name}`;
    const data = {
      startDate: t.startDate,
      endDate: t.endDate,
      note: t.note,
      status: t.status,
      publishedAt: t.publishedAt,
      archivedAt: t.archivedAt,
      sessionsOwed: t.sessionsOwed,
      // Séance ponctuelle : type gardé ; le lien vers la séance rattrapée (créneau de la démo locale) n'est pas recopié.
      kind: t.kind,
      oneOffType: t.oneOffType,
      makeupDate: t.makeupDate,
    };
    const day = (x) => x?.toISOString().slice(0, 10);
    const unchanged =
      dt &&
      day(dt.startDate) === day(t.startDate) &&
      day(dt.endDate) === day(t.endDate) &&
      (dt.note ?? '') === (t.note ?? '') &&
      dt.status === t.status &&
      Boolean(dt.archivedAt) === Boolean(t.archivedAt);
    if (!unchanged)
      summary.push(`  Vacances « ${t.name} » (${t.status === 'PUBLISHED' ? 'publiées' : 'brouillon'}) ${dt ? 'mises à jour' : 'créées'}`);
    const createdById = await userMap(t.createdById);
    plan.push(async (tx) => {
      if (dt) await tx.tempSchedule.update({ where: { id: dt.id }, data: { ...data, version: { increment: 1 } } });
      else newSchedules.set(skey, (await tx.tempSchedule.create({ data: { ...data, seasonId: ds.id, name: t.name, createdById } })).id);
    });
    const tGroupIds = new Set(t.groups.map((x) => x.groupId));
    for (const tg of t.groups) {
      const key = groupKey.get(tg.groupId);
      const g = sGroups.find((x) => x.id === tg.groupId);
      if (!key || !g) continue;
      const wanted = g.slots.filter((s) => s.scheduleId === t.id).map((s) => mapSlot(withCoachIds(s)));
      const dg = dGroups.find((d) => d.name === g.name);
      const existing = dt ? (dg?.slots ?? []).filter((s) => s.scheduleId === dt.id).map(withCoachIds) : [];
      plan.push(async (tx, ids) => {
        const scheduleId = ids.schedule(skey);
        const groupId = ids.group(key);
        await tx.tempScheduleGroup.upsert({
          where: { scheduleId_groupId: { scheduleId, groupId } },
          create: { scheduleId, groupId, mode: tg.mode },
          update: { mode: tg.mode },
        });
      });
      await planSlots(`« ${g.name} » (${t.name})`, key, skey, wanted, existing);
    }
    // Groupes retirés de ces vacances dans la démo locale
    if (dt) {
      for (const dtg of dt.groups) {
        const dg = dGroups.find((d) => d.id === dtg.groupId);
        const sg = dg && sGroups.find((x) => x.name === dg.name);
        if (sg && tGroupIds.has(sg.id)) continue;
        const existing = (dg?.slots ?? []).filter((s) => s.scheduleId === dt.id).map(withCoachIds);
        await planSlots(`« ${dg?.name ?? '?'} » (${t.name}, retiré)`, dtg.groupId, skey, [], existing);
        if (!(await linkedSlots(dst, existing.map((s) => s.id))).size)
          plan.push((tx) => tx.tempScheduleGroup.delete({ where: { scheduleId_groupId: { scheduleId: dt.id, groupId: dtg.groupId } } }));
      }
    }
  }

  // Brouillons (remplacent ceux du même nom)
  for (const d of drafts) {
    summary.push(`  Brouillon « ${d.name} » (${Object.keys(d.groups ?? {}).length} groupe(s))`);
    const createdById = await userMap(d.createdById);
    plan.push(async (tx, ids) => {
      const groups = {};
      for (const [gid, slots] of Object.entries(d.groups ?? {})) {
        const key = groupKey.get(gid);
        if (!key) continue;
        groups[ids.group(key)] = slots.map((s) => {
          const m = mapSlot({ ...s, coachIds: s.coachIds ?? [] });
          const id = s.id ? slotIdMap.get(s.id) : undefined;
          return { ...(id ? { id } : {}), day: m.day, startTime: m.startTime, endTime: m.endTime, courtId: m.courtId, coachIds: m.coachIds, kind: m.kind };
        });
      }
      await tx.timetableDraft.deleteMany({ where: { seasonId: ds.id, name: d.name } });
      await tx.timetableDraft.create({ data: { seasonId: ds.id, name: d.name, groups, createdById, updatedById: createdById } });
    });
  }
}

const host = (() => {
  try {
    return new URL(dstUrl).host.replace(/^[^.]*\./, '…');
  } catch {
    return '?';
  }
})();
console.log(`\nDémo locale → démo en ligne (${host})\n`);
console.log(summary.length ? summary.join('\n') : 'Rien à recopier.');
if (warnings.size) console.log(`\n⚠ ${[...warnings].join('\n⚠ ')}`);

const confirm = async () => {
  if (process.argv.includes('--yes')) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question('\nTapez OUI pour appliquer sur la démo en ligne : ');
  rl.close();
  return a.trim().toUpperCase() === 'OUI';
};
if (!plan.length || !(await confirm())) {
  console.log('Aucun changement.');
} else {
  const ids = {
    group: (k) => (k.startsWith('new:') ? newGroups.get(k) : k),
    schedule: (k) => (k.startsWith('new:') ? newSchedules.get(k) : k),
  };
  await dst.$transaction(
    async (tx) => {
      for (const step of plan) await step(tx, ids);
      if (president)
        await tx.auditLog.create({
          data: { userId: president.id, action: 'Emplois du temps recopiés depuis la démo locale', entity: 'TimetableDraft', target: 'Démo en ligne' },
        });
    },
    { maxWait: 60_000, timeout: 10 * 60_000 },
  );
  console.log('✔ Emplois du temps recopiés sur la démo en ligne.');
}
await src.$disconnect();
await dst.$disconnect();
