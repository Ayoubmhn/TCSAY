// Test de bout en bout : séances, pointage des présences, absences des entraîneurs, évaluation de séance,
// suivi du joueur et alertes du suivi technique.
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
//
// Le test crée son propre groupe « E2E Présences » (entraîneur Iheb, joueurs Lina et Yassine Ben Ali) avec des créneaux
// placés autour de l'heure actuelle (heure du club, Africa/Tunis) : hier, il y a 3 jours, dans 3 jours, une séance
// terminée récemment (pointage hors connexion) et, si possible, une séance en cours. Le groupe est archivé à la fin.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, login, ok, refused, uid } from './helpers.mjs';
import { openAccess } from './helpers-paiements.mjs';

// --- Heure du club (Tunisie : UTC+1 toute l'année) -------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const tunis = (instant = new Date()) => {
  const t = new Date(instant.getTime() + 3_600_000);
  return { day: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
};
const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();
const hhmm = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
/** Instant d'un jour + heure du club. */
const at = (day, time) => new Date(`${day}T${time}:00+01:00`);

const now = tunis();
const TODAY = now.day;
const PAST = addDays(TODAY, -1); // séance d'hier : évaluation par l'entraîneur encore ouverte
const OLD = addDays(TODAY, -3); // séance d'il y a 3 jours : fermée pour l'entraîneur
const FUTURE = addDays(TODAY, 3); // séance à venir
// Séance terminée récemment (moins de 36 h) pour le pointage hors connexion.
const OFF = now.minutes >= 60 ? { day: TODAY, start: '00:00', end: '00:30' } : { day: PAST, start: '22:00', end: '22:30' };
// Séance en cours : commence dans 5 minutes (pointage ouvert 15 min avant le début).
const LIVE = now.minutes + 5 + 30 < 24 * 60 ? { start: hhmm(now.minutes + 5), end: hhmm(now.minutes + 35) } : null;

describe('Présences, absences des entraîneurs, évaluation et suivi', () => {
  let admin, coach, dtCoach, dtAdmin, agent, parent;
  let ihebCoachId, dtCoachId, group, liveGroup, season;
  const slot = {};
  let lina, yassine, adam, foreignSlot;

  let restoreAccess = async () => {};

  before(async () => {
    [admin, coach, parent, agent, dtAdmin] = await Promise.all([as('admin'), as('coach'), as('parent'), as('agent'), as('dt')]);
    dtCoach = await login('dt@tcsay.tn', 'temporaire', 'coach');
    ihebCoachId = ok(await coach('GET', '/auth/me')).coachId;
    dtCoachId = ok(await dtCoach('GET', '/auth/me')).coachId;
    season = ok(await admin('GET', '/seasons')).find((s) => s.status === 'ACTIVE');
    const players = ok(await admin('GET', '/players'));
    lina = players.find((p) => p.firstName === 'Lina' && p.lastName === 'Ben Ali');
    yassine = players.find((p) => p.firstName === 'Yassine' && p.lastName === 'Ben Ali');
    adam = players.find((p) => p.firstName === 'Adam');
    assert.ok(season && lina && yassine && adam, 'démo incomplète (relancer npm run db:demo)');
    restoreAccess = await openAccess(admin, parent, [lina, yassine]);
    // Une séance d'un autre entraîneur (Aziz) : l'entraîneur Iheb n'y a pas accès.
    const groups = ok(await admin('GET', '/groups'));
    foreignSlot = groups.flatMap((g) => g.slots).find((s) => s.coaches.length && s.coaches.every((c) => c.id !== ihebCoachId));
    assert.ok(foreignSlot, 'aucune séance d’un autre entraîneur dans la démo');
  });

  after(async () => {
    await restoreAccess();
    for (const g of [group, liveGroup]) if (g) await admin('POST', `/groups/${g.id}/archive`);
  });

  test('l’administration crée le groupe de test (créneaux hier, J-3, J+3, séance récente)', async () => {
    const s = (day, start, end) => ({ day: weekday(day), startTime: start, endTime: end, coachIds: [ihebCoachId] });
    const r = await admin('POST', '/groups', {
      name: `E2E Présences ${uid()}`,
      kind: 'COMPETITIVE',
      capacity: 2,
      slots: [s(PAST, '06:00', '07:00'), s(OLD, '06:00', '07:00'), s(FUTURE, '06:00', '07:00'), s(OFF.day, OFF.start, OFF.end)],
    });
    group = ok(r, 'création du groupe');
    const find = (day, start) => group.slots.find((x) => x.day === weekday(day) && x.startTime === start).id;
    slot.past = find(PAST, '06:00');
    slot.old = find(OLD, '06:00');
    slot.future = find(FUTURE, '06:00');
    slot.off = find(OFF.day, OFF.start);
    ok(await admin('POST', `/groups/${group.id}/members`, { playerId: lina.id }), 'ajout de Lina');
    ok(await admin('POST', `/groups/${group.id}/members`, { playerId: yassine.id }), 'ajout de Yassine');
  });

  test('R4 : groupe complet, un 3e joueur est refusé', async () => {
    refused(await admin('POST', `/groups/${group.id}/members`, { playerId: adam.id }), 409, /R4/);
  });

  test('R5 : un créneau qui chevauche celui de l’entraîneur dans un autre groupe est refusé', async () => {
    const r = await admin('POST', '/groups', {
      name: `E2E Conflit ${uid()}`,
      capacity: 4,
      slots: [{ day: weekday(PAST), startTime: '06:30', endTime: '07:30', coachIds: [ihebCoachId] }],
    });
    refused(r, 409, /R5/);
  });

  // --- Mes séances -------------------------------------------------------------------------------------------
  test('l’entraîneur voit ses séances du groupe, fermées au pointage hors séance en cours', async () => {
    const r = ok(await coach('GET', `/sessions?from=${OLD}&to=${FUTURE}`));
    const mine = r.filter((x) => x.groupId === group.id);
    const past = mine.find((x) => x.slotId === slot.past && x.date === PAST);
    const future = mine.find((x) => x.slotId === slot.future && x.date === FUTURE);
    assert.ok(past && future, 'séances d’hier et de J+3 attendues');
    assert.equal(past.started, true);
    assert.equal(past.open, false);
    assert.equal(future.started, false);
    assert.equal(future.membersCount, 2);
  });

  test('le parent voit les séances du groupe de Lina ; un entraîneur ne voit pas « Mes séances » des familles', async () => {
    const r = ok(await parent('GET', `/sessions/player?playerId=${lina.id}&from=${OLD}&to=${FUTURE}`));
    assert.ok(r.groups.some((g) => g.id === group.id));
    const s = r.sessions.find((x) => x.slotId === slot.past && x.date === PAST);
    assert.ok(s, 'séance d’hier attendue');
    assert.equal(s.past, true);
    refused(await coach('GET', '/sessions/player'), 403);
  });

  test('un parent ne voit pas les séances d’un joueur qui n’est pas le sien', async () => {
    refused(await parent('GET', `/sessions/player?playerId=${adam.id}`), 403);
  });

  // --- Pointage ----------------------------------------------------------------------------------------------
  test('feuille de présence : l’entraîneur ne peut pas ouvrir celle d’un autre entraîneur', async () => {
    const day = (() => {
      for (let i = 0; i < 7; i++) if (weekday(addDays(TODAY, -i)) === foreignSlot.day) return addDays(TODAY, -i);
    })();
    refused(await coach('GET', `/attendance?slotId=${foreignSlot.id}&date=${day}`), 403);
  });

  test('feuille de présence d’hier : 2 joueurs, non modifiable par l’entraîneur', async () => {
    const r = ok(await coach('GET', `/attendance?slotId=${slot.past}&date=${PAST}`));
    assert.equal(r.entries.length, 2);
    assert.equal(r.open, false);
    assert.equal(r.editable, false);
  });

  test('l’entraîneur ne pointe pas une séance terminée (hors séance en cours)', async () => {
    const r = await coach('PUT', '/attendance', { slotId: slot.past, date: PAST, entries: [{ playerId: lina.id, status: 'PRESENT' }] });
    refused(r, 400);
    assert.match(String(r.data.message), /séance en cours/);
  });

  test('un jour sans séance de ce créneau est refusé', async () => {
    refused(await admin('PUT', '/attendance', { slotId: slot.past, date: TODAY, entries: [{ playerId: lina.id, status: 'PRESENT' }] }), 400);
  });

  test('statut inconnu refusé par la validation', async () => {
    refused(await admin('PUT', '/attendance', { slotId: slot.past, date: PAST, entries: [{ playerId: lina.id, status: 'MALADE' }] }), 400);
  });

  test('la direction ne corrige pas une séance qui n’a pas commencé', async () => {
    const r = await admin('PUT', '/attendance', { slotId: slot.future, date: FUTURE, entries: [{ playerId: lina.id, status: 'PRESENT' }] });
    refused(r, 400);
    assert.match(String(r.data.message), /pas encore commencé/);
  });

  test('sans l’autorisation « présences », l’agent administratif ne corrige pas', async () => {
    refused(await agent('PUT', '/attendance', { slotId: slot.past, date: PAST, entries: [{ playerId: lina.id, status: 'PRESENT' }] }), 403);
  });

  test('la direction corrige les présences d’hier et d’il y a 3 jours (présent, retard, absent)', async () => {
    ok(
      await admin('PUT', '/attendance', {
        slotId: slot.past,
        date: PAST,
        entries: [
          { playerId: lina.id, status: 'LATE', reason: 'Bus en retard' },
          { playerId: yassine.id, status: 'ABSENT', reason: 'Malade' },
        ],
      }),
    );
    ok(
      await admin('PUT', '/attendance', {
        slotId: slot.old,
        date: OLD,
        entries: [
          { playerId: lina.id, status: 'PRESENT' },
          { playerId: yassine.id, status: 'ABSENT' },
        ],
      }),
    );
    const sheet = ok(await admin('GET', `/attendance?slotId=${slot.past}&date=${PAST}`));
    assert.equal(sheet.entries.find((e) => e.playerId === lina.id).status, 'LATE');
    assert.equal(sheet.entries.find((e) => e.playerId === yassine.id).reason, 'Malade');
  });

  test('le parent voit le retard et l’absence dans Mes absences et Mes séances', async () => {
    const abs = ok(await parent('GET', `/absences?playerId=${yassine.id}`));
    assert.ok(abs.some((a) => a.date === PAST && a.status === 'ABSENT' && a.reason === 'Malade'));
    const late = ok(await parent('GET', `/absences?playerId=${lina.id}`));
    assert.ok(late.some((a) => a.date === PAST && a.status === 'LATE'));
    const ses = ok(await parent('GET', `/sessions/player?playerId=${lina.id}&from=${OLD}&to=${PAST}`));
    assert.equal(ses.sessions.find((x) => x.slotId === slot.past && x.date === PAST).attendance, 'LATE');
  });

  // --- Hors connexion ----------------------------------------------------------------------------------------
  test('hors connexion : pointage fait pendant la séance, envoyé plus tard, accepté', async () => {
    const markedAt = new Date(at(OFF.day, OFF.start).getTime() + 10 * 60_000);
    const r = await coach('PUT', '/attendance', {
      slotId: slot.off,
      date: OFF.day,
      markedAt: markedAt.toISOString(),
      clientNow: new Date().toISOString(),
      entries: [
        { playerId: lina.id, status: 'PRESENT' },
        { playerId: yassine.id, status: 'ABSENT' },
      ],
    });
    assert.equal(ok(r).kept, 0);
  });

  test('hors connexion : l’horloge du téléphone en avance de 2 h est corrigée', async () => {
    const skew = 2 * 3_600_000;
    const markedAt = new Date(at(OFF.day, OFF.start).getTime() + 15 * 60_000 + skew);
    const r = await coach('PUT', '/attendance', {
      slotId: slot.off,
      date: OFF.day,
      markedAt: markedAt.toISOString(),
      clientNow: new Date(Date.now() + skew).toISOString(),
      entries: [{ playerId: yassine.id, status: 'ABSENT' }],
    });
    ok(r, 'pointage avec horloge décalée');
  });

  test('hors connexion : une correction de la direction faite entre-temps est gardée', async () => {
    ok(await admin('PUT', '/attendance', { slotId: slot.off, date: OFF.day, entries: [{ playerId: lina.id, status: 'LATE', reason: 'Correction' }] }));
    const markedAt = new Date(at(OFF.day, OFF.start).getTime() + 5 * 60_000); // pointé avant la correction
    const r = ok(
      await coach('PUT', '/attendance', {
        slotId: slot.off,
        date: OFF.day,
        markedAt: markedAt.toISOString(),
        clientNow: new Date().toISOString(),
        entries: [
          { playerId: lina.id, status: 'PRESENT' },
          { playerId: yassine.id, status: 'ABSENT' },
        ],
      }),
    );
    assert.equal(r.kept, 1);
    const sheet = ok(await admin('GET', `/attendance?slotId=${slot.off}&date=${OFF.day}`));
    assert.equal(sheet.entries.find((e) => e.playerId === lina.id).status, 'LATE');
  });

  test('hors connexion : pointage fait en dehors de la séance refusé', async () => {
    const markedAt = new Date(at(OFF.day, OFF.start).getTime() - 60 * 60_000);
    const r = await coach('PUT', '/attendance', {
      slotId: slot.off,
      date: OFF.day,
      markedAt: markedAt.toISOString(),
      clientNow: new Date().toISOString(),
      entries: [{ playerId: lina.id, status: 'PRESENT' }],
    });
    refused(r, 400);
    assert.match(String(r.data.message), /en dehors de la séance/);
  });

  test('hors connexion : pointage de plus de 36 h refusé', async () => {
    const markedAt = new Date(at(OLD, '06:15').getTime());
    const r = await coach('PUT', '/attendance', {
      slotId: slot.old,
      date: OLD,
      markedAt: markedAt.toISOString(),
      clientNow: new Date().toISOString(),
      entries: [{ playerId: lina.id, status: 'PRESENT' }],
    });
    refused(r, 400);
    assert.match(String(r.data.message), /36 h/);
  });

  test('hors connexion : heure de pointage dans le futur refusée', async () => {
    const r = await coach('PUT', '/attendance', {
      slotId: slot.off,
      date: OFF.day,
      markedAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
      clientNow: new Date().toISOString(),
      entries: [{ playerId: lina.id, status: 'PRESENT' }],
    });
    refused(r, 400);
    assert.match(String(r.data.message), /incohérente/);
  });

  test('séance en cours : l’entraîneur pointe en direct', async (t) => {
    if (!LIVE) return t.skip('trop près de minuit pour placer une séance en cours');
    const r = await admin('POST', '/groups', {
      name: `E2E En cours ${uid()}`,
      capacity: 2,
      slots: [{ day: weekday(TODAY), startTime: LIVE.start, endTime: LIVE.end, coachIds: [ihebCoachId] }],
    });
    if (r.status === 409) return t.skip('l’entraîneur a déjà une séance à cette heure-ci (R5)');
    liveGroup = ok(r, 'groupe en cours');
    ok(await admin('POST', `/groups/${liveGroup.id}/members`, { playerId: lina.id }));
    const liveSlot = liveGroup.slots[0].id;
    const sheet = ok(await coach('GET', `/attendance?slotId=${liveSlot}&date=${TODAY}`));
    assert.equal(sheet.open, true);
    assert.equal(sheet.editable, true);
    const sessions = ok(await coach('GET', `/sessions?from=${TODAY}&to=${TODAY}`));
    assert.equal(sessions.find((x) => x.slotId === liveSlot).open, true);
    ok(await coach('PUT', '/attendance', { slotId: liveSlot, date: TODAY, entries: [{ playerId: lina.id, status: 'PRESENT' }] }));
    const after = ok(await coach('GET', `/sessions?from=${TODAY}&to=${TODAY}`));
    assert.equal(after.find((x) => x.slotId === liveSlot).recorded, true);
  });

  test('le pointage est tracé dans l’historique (hors connexion signalé)', async () => {
    const rows = ok(await admin('GET', '/audit')).filter((x) => x.entity === 'Attendance' && x.target?.startsWith(group.name));
    assert.ok(rows.some((x) => x.action === 'Présences pointées (hors connexion)'), 'trace « hors connexion » attendue');
    assert.ok(rows.some((x) => x.action === 'Présences corrigées'), 'trace de la correction attendue');
  });

  // --- Absences des entraîneurs ------------------------------------------------------------------------------
  let pending;
  test('l’entraîneur ne déclare pas une absence dans le passé', async () => {
    refused(await coach('POST', '/coach-absences', { date: PAST, slotId: slot.past, reason: 'Oubli' }), 400);
  });

  test('l’entraîneur ne déclare pas d’absence sur la séance d’un autre', async () => {
    let day = TODAY;
    while (weekday(day) !== foreignSlot.day) day = addDays(day, 1);
    refused(await coach('POST', '/coach-absences', { date: day, slotId: foreignSlot.id, reason: 'Test' }), 403);
  });

  test('séance d’un autre jour de la semaine refusée', async () => {
    refused(await coach('POST', '/coach-absences', { date: addDays(FUTURE, 1), slotId: slot.future, reason: 'Test' }), 400);
  });

  test('l’entraîneur déclare une absence à J+3 : « À valider »', async () => {
    pending = ok(await coach('POST', '/coach-absences', { date: FUTURE, slotId: slot.future, reason: 'Rendez-vous E2E', notifyGroups: false }));
    assert.equal(pending.status, 'PENDING');
    const mine = ok(await coach('GET', '/coach-absences'));
    assert.ok(mine.some((a) => a.id === pending.id));
    assert.ok(mine.every((a) => a.coach.id === ihebCoachId), 'l’entraîneur ne voit que ses absences');
  });

  test('validation : remplacement sans remplaçant ou par lui-même refusé', async () => {
    refused(await admin('POST', `/coach-absences/${pending.id}/approve`, { resolution: 'REPLACED' }), 400);
    refused(await admin('POST', `/coach-absences/${pending.id}/approve`, { resolution: 'REPLACED', replacementCoachId: ihebCoachId }), 400);
  });

  test('l’entraîneur ne valide pas lui-même ; l’agent sans droit « absences » non plus', async () => {
    refused(await coach('POST', `/coach-absences/${pending.id}/approve`, { resolution: 'PHYSICAL' }), 403);
    refused(await agent('POST', `/coach-absences/${pending.id}/approve`, { resolution: 'PHYSICAL' }), 403);
  });

  test('la direction valide avec remplacement par le directeur technique', async () => {
    const r = ok(await dtAdmin('POST', `/coach-absences/${pending.id}/approve`, { resolution: 'REPLACED', replacementCoachId: dtCoachId }));
    assert.equal(r.status, 'APPROVED');
    assert.equal(r.replacementCoach.id, dtCoachId);
    refused(await admin('POST', `/coach-absences/${pending.id}/approve`, { resolution: 'PHYSICAL' }), 400); // déjà traitée
  });

  test('remplacement : la séance apparaît chez le remplaçant et chez la famille', async () => {
    const own = ok(await coach('GET', `/sessions?from=${FUTURE}&to=${FUTURE}`)).find((x) => x.slotId === slot.future);
    assert.equal(own.coachAbsent, true);
    assert.equal(own.resolution, 'REPLACED');
    const repl = ok(await dtCoach('GET', `/sessions?from=${FUTURE}&to=${FUTURE}`)).find((x) => x.slotId === slot.future);
    assert.ok(repl, 'séance attendue chez le remplaçant');
    assert.equal(repl.replacing, true);
    ok(await dtCoach('GET', `/attendance?slotId=${slot.future}&date=${FUTURE}`), 'le remplaçant ouvre la feuille de présence');
    const fam = ok(await parent('GET', `/sessions/player?playerId=${lina.id}&from=${FUTURE}&to=${FUTURE}`));
    const s = fam.sessions.find((x) => x.slotId === slot.future);
    assert.equal(s.resolution, 'REPLACED');
    assert.equal(s.replacement.id, dtCoachId);
  });

  test('séance physique (J+10) puis refus d’une autre demande', async () => {
    const d10 = addDays(FUTURE, 7);
    const a = ok(await coach('POST', '/coach-absences', { date: d10, slotId: slot.future, reason: 'Formation', notifyGroups: false }));
    ok(await admin('POST', `/coach-absences/${a.id}/approve`, { resolution: 'PHYSICAL' }));
    const fam = ok(await parent('GET', `/sessions/player?playerId=${lina.id}&from=${d10}&to=${d10}`));
    assert.equal(fam.sessions.find((x) => x.slotId === slot.future).resolution, 'PHYSICAL');
    const b = ok(await coach('POST', '/coach-absences', { date: addDays(d10, 7), slotId: slot.future, reason: 'Autre', notifyGroups: false }));
    const rej = ok(await admin('POST', `/coach-absences/${b.id}/reject`, { note: 'Pas de remplaçant' }));
    assert.equal(rej.status, 'REJECTED');
  });

  test('séance annulée par la direction : plus de pointage possible', async () => {
    const day = addDays(PAST, -7);
    refused(await admin('POST', '/coach-absences', { coachId: ihebCoachId, date: day, slotId: slot.past, reason: 'Pluie' }), 400); // décision obligatoire
    ok(await admin('POST', '/coach-absences', { coachId: ihebCoachId, date: day, slotId: slot.past, reason: 'Pluie', resolution: 'CANCELLED', notifyGroups: false }));
    const r = await admin('PUT', '/attendance', { slotId: slot.past, date: day, entries: [{ playerId: lina.id, status: 'PRESENT' }] });
    refused(r, 400);
    assert.match(String(r.data.message), /annulée/);
    const fam = ok(await parent('GET', `/sessions/player?playerId=${lina.id}&from=${day}&to=${day}`));
    assert.equal(fam.sessions.find((x) => x.slotId === slot.past).resolution, 'CANCELLED');
  });

  // --- Objectif et évaluation de séance ----------------------------------------------------------------------
  test('objectif : préparé à l’avance pour J+3, refusé à l’entraîneur pour une séance trop ancienne', async () => {
    ok(await coach('PUT', '/sessions/plan', { slotId: slot.future, date: FUTURE, objective: 'Service', content: 'Échauffement puis paniers' }));
    ok(await coach('PUT', '/sessions/plan', { slotId: slot.past, date: PAST, objective: 'Revers' }));
    refused(await coach('PUT', '/sessions/plan', { slotId: slot.old, date: OLD, objective: 'Volée' }), 400);
    refused(await coach('PUT', '/sessions/plan', { slotId: slot.past, date: PAST, objective: '' }), 400);
    ok(await admin('PUT', '/sessions/plan', { slotId: slot.old, date: OLD, objective: 'Volée' }), 'la direction corrige');
  });

  test('évaluation : séance pas commencée, joueur absent, notes hors 1–5 refusés', async () => {
    const notes = { effort: 4, focus: 4, behavior: 4, objective: 4, play: 4 };
    refused(await coach('PUT', '/sessions/ratings', { slotId: slot.future, date: FUTURE, playerId: lina.id, ...notes }), 400);
    const absent = await coach('PUT', '/sessions/ratings', { slotId: slot.past, date: PAST, playerId: yassine.id, ...notes });
    refused(absent, 400);
    assert.match(String(absent.data.message), /absent/i);
    refused(await coach('PUT', '/sessions/ratings', { slotId: slot.past, date: PAST, playerId: lina.id, ...notes, play: 6 }), 400);
    refused(await coach('PUT', '/sessions/ratings', { slotId: slot.past, date: PAST, playerId: adam.id, ...notes }), 400);
  });

  test('l’entraîneur évalue Lina (douleur signalée) ; fermé pour une séance d’il y a 3 jours', async () => {
    const r = ok(
      await coach('PUT', '/sessions/ratings', {
        slotId: slot.past,
        date: PAST,
        playerId: lina.id,
        effort: 1,
        focus: 3,
        behavior: 4,
        objective: 3,
        play: 4,
        mood: 'PAIN',
        comment: 'Douleur au poignet (E2E)',
      }),
    );
    assert.equal(r.average, 3);
    refused(
      await coach('PUT', '/sessions/ratings', { slotId: slot.old, date: OLD, playerId: lina.id, effort: 2, focus: 2, behavior: 2, objective: 2, play: 2 }),
      400,
    );
    ok(
      await admin('PUT', '/sessions/ratings', { slotId: slot.old, date: OLD, playerId: lina.id, effort: 2, focus: 3, behavior: 3, objective: 3, play: 3 }),
      'la direction corrige',
    );
    const review = ok(await coach('GET', `/sessions/review?slotId=${slot.past}&date=${PAST}`));
    assert.equal(review.plan.objective, 'Revers');
    assert.equal(review.editable, true);
    const p = review.players.find((x) => x.playerId === lina.id);
    assert.equal(p.attendance, 'LATE');
    assert.equal(p.rating.mood, 'PAIN');
  });

  test('douleur : le parent est prévenu', async () => {
    const rows = ok(await parent('GET', '/notifications'));
    assert.ok(rows.some((n) => /douleur/i.test(n.title) && /poignet/.test(n.body ?? '')), 'notification de douleur attendue');
  });

  // --- Suivi et progression ----------------------------------------------------------------------------------
  test('suivi : le parent voit la séance évaluée, sans aucun montant', async () => {
    const r = ok(await parent('GET', `/progress?playerId=${lina.id}`));
    assert.ok(r.attendance.present + r.attendance.late + r.attendance.absent > 0);
    const s = r.sessions.find((x) => x.date === PAST && x.objective === 'Revers');
    assert.ok(s, 'séance d’hier attendue dans le suivi');
    assert.equal(s.comment, 'Douleur au poignet (E2E)');
    assert.doesNotMatch(JSON.stringify(r), /"(amount|paid|remaining|total|fee|price)"/i);
  });

  test('suivi : refusé à l’entraîneur et pour l’enfant d’une autre famille', async () => {
    refused(await coach('GET', `/progress?playerId=${lina.id}`), 403);
    refused(await parent('GET', `/progress?playerId=${adam.id}`), 403);
  });

  // --- Suivi technique : alertes ------------------------------------------------------------------------------
  test('suivi technique : 3 absences de suite, douleur, engagement faible', async () => {
    const r = ok(await dtAdmin('GET', '/evaluations/overview'));
    const g = r.groups.find((x) => x.id === group.id);
    assert.ok(g, 'groupe de test attendu');
    assert.equal(g.players, 2);
    const mine = r.alerts.filter((a) => a.group === group.name);
    assert.ok(mine.some((a) => a.playerId === yassine.id && a.kind === 'ABSENCES'), 'alerte 3 absences attendue');
    assert.ok(mine.some((a) => a.playerId === lina.id && a.kind === 'PAIN'), 'alerte douleur attendue');
    assert.ok(mine.some((a) => a.playerId === lina.id && a.kind === 'EFFORT'), 'alerte engagement attendue');
  });

  test('suivi technique : l’entraîneur ne voit que ses groupes ; l’agent sans droit refusé', async () => {
    const r = ok(await coach('GET', '/evaluations/overview'));
    assert.ok(r.groups.some((x) => x.id === group.id));
    const groups = ok(await admin('GET', '/groups'));
    const notMine = groups.filter((x) => !x.slots.some((s) => s.coaches.some((c) => c.id === ihebCoachId))).map((x) => x.id);
    assert.ok(r.groups.every((x) => !notMine.includes(x.id)), 'aucun groupe d’un autre entraîneur');
    refused(await agent('GET', '/evaluations/overview'), 403);
  });
});
