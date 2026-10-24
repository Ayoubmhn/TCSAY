// Test de bout en bout : emploi du temps temporaire (vacances, stage) — brouillon sans effet, publication qui remplace
// l'horaire habituel (ou ajoute des séances) pendant les dates seulement, R5 pendant les dates, R10, R13, retour en brouillon.
// Base de DÉMONSTRATION uniquement. Créneaux à 04:00 (aucun groupe de la démo à cette heure).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

const fakeCin = () => ('T' + uid()).slice(0, 12);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const wd = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

describe('Emplois temporaires (vacances)', () => {
  let admin, parent, season, courtA, courtB, coachA, coachB, groupG, groupH, D, sched, version;
  const groups = [];
  const schedules = [];

  /** Séances du planning d'un jour pour un groupe. */
  const sessionsOf = async (date, groupId) => ok(await admin('GET', `/planning?date=${date}`)).sessions.filter((s) => s.group.id === groupId);
  const reload = async () => {
    const s = ok(await admin('GET', `/temp-schedules/${sched}`));
    version = s.version;
    return s;
  };

  before(async () => {
    admin = await as('admin');
    parent = await as('parent');
    season = ok(await admin('GET', '/seasons/active'));
    const courts = ok(await admin('GET', '/courts')).filter((c) => c.active);
    [courtA, courtB] = courts;
    const mkCoach = async () => ok(await admin('POST', '/coaches', { firstName: 'Coach', lastName: `Vac${uid()}`, cin: fakeCin(), payMode: 'HOURLY', payRate: 10 })).id;
    coachA = await mkCoach();
    coachB = await mkCoach();
    // Fenêtre de 7 jours dans un mois environ, dans la saison (compétitif : toute la saison).
    const today = new Date().toISOString().slice(0, 10);
    D = addDays(today, 30);
    const end = season.endDate.slice(0, 10);
    if (addDays(D, 6) > end) D = addDays(end, -10);
    groupG = ok(await admin('POST', '/groups', {
      name: `Vacances G ${uid()}`, kind: 'COMPETITIVE', capacity: 8,
      slots: [{ day: wd(D), startTime: '04:00', endTime: '05:00', courtId: courtA.id, coachIds: [coachA] }],
    }));
    groupH = ok(await admin('POST', '/groups', {
      name: `Vacances H ${uid()}`, kind: 'COMPETITIVE', capacity: 8,
      slots: [{ day: wd(addDays(D, 2)), startTime: '04:00', endTime: '05:00', courtId: courtA.id, coachIds: [coachB] }],
    }));
    groups.push(groupG.id, groupH.id);
  });

  after(async () => {
    for (const id of schedules) {
      const s = await admin('GET', `/temp-schedules/${id}`);
      if (s.status !== 200) continue;
      if (s.data.status === 'PUBLISHED') await admin('POST', `/temp-schedules/${id}/unpublish`, { version: s.data.version, reason: 'Fin du test' });
      const again = ok(await admin('GET', `/temp-schedules/${id}`));
      await admin('POST', `/temp-schedules/${id}/archive`, { version: again.version, reason: 'Fin du test' });
    }
    for (const id of groups) await admin('POST', `/groups/${id}/archive`);
  });

  test('réservé à la direction (parent : 403)', async () => {
    refused(await parent('GET', '/temp-schedules'), 403);
  });

  test('dates contrôlées : fin avant début, hors saison', async () => {
    refused(await admin('POST', '/temp-schedules', { name: 'X', startDate: addDays(D, 3), endDate: D }), 400);
    refused(await admin('POST', '/temp-schedules', { name: 'X', startDate: addDays(season.endDate.slice(0, 10), 1), endDate: addDays(season.endDate.slice(0, 10), 5) }), 400);
  });

  test('création en brouillon et groupe à horaire remplacé', async () => {
    sched = ok(await admin('POST', '/temp-schedules', { name: `Vacances E2E ${uid()}`, startDate: D, endDate: addDays(D, 6), note: 'Test' })).id;
    schedules.push(sched);
    const s = await reload();
    assert.equal(s.status, 'DRAFT');
    assert.equal(s.days.length, 7);
    ok(await admin('PUT', `/temp-schedules/${sched}/groups/${groupG.id}`, {
      mode: 'REPLACE', version,
      slots: [{ day: wd(addDays(D, 1)), startTime: '04:00', endTime: '05:30', courtId: courtA.id, coachIds: [coachA] }],
    }), 'groupe G');
    const g = (await reload()).groups.find((x) => x.id === groupG.id);
    assert.equal(g.mode, 'REPLACE');
    assert.equal(g.slots.length, 1);
    assert.equal(g.usualSlots.length, 1);
  });

  test('R13 : version périmée refusée', async () => {
    refused(await admin('PUT', `/temp-schedules/${sched}/groups/${groupG.id}`, { mode: 'REPLACE', version: version - 1, slots: [] }), 409, /R13/);
  });

  test('brouillon : aucun effet sur le planning', async () => {
    assert.equal((await sessionsOf(D, groupG.id)).length, 1, 'séance habituelle maintenue');
    assert.equal((await sessionsOf(addDays(D, 1), groupG.id)).length, 0, 'pas encore de séance de vacances');
  });

  test('l’horaire habituel du groupe ne montre pas les créneaux temporaires', async () => {
    const g = ok(await admin('GET', '/groups')).find((x) => x.id === groupG.id);
    assert.equal(g.slots.length, 1);
    assert.equal(g.slots[0].startTime, '04:00');
    assert.equal(g.slots[0].endTime, '05:00');
  });

  test('R5 : terrain pris par l’horaire habituel d’un groupe qui le garde', async () => {
    const r = await admin('PUT', `/temp-schedules/${sched}/groups/${groupG.id}`, {
      mode: 'REPLACE', version,
      slots: [{ day: wd(addDays(D, 2)), startTime: '04:30', endTime: '05:30', courtId: courtA.id, coachIds: [coachA] }],
    });
    refused(r, 409, /R5/);
  });

  test('R5 : deux groupes de l’emploi sur le même terrain', async () => {
    const r = await admin('PUT', `/temp-schedules/${sched}/groups/${groupH.id}`, {
      mode: 'ADD', version,
      slots: [{ day: wd(addDays(D, 1)), startTime: '05:00', endTime: '06:00', courtId: courtA.id, coachIds: [coachB] }],
    });
    refused(r, 409, /R5/);
  });

  test('jour absent des dates refusé', async () => {
    const short = ok(await admin('POST', '/temp-schedules', { name: `Court ${uid()}`, startDate: D, endDate: addDays(D, 1) })).id;
    schedules.push(short);
    const v = ok(await admin('GET', `/temp-schedules/${short}`)).version;
    refused(await admin('PUT', `/temp-schedules/${short}/groups/${groupG.id}`, {
      mode: 'REPLACE', version: v, slots: [{ day: wd(addDays(D, 3)), startTime: '04:00', endTime: '05:00', courtId: courtA.id, coachIds: [coachA] }],
    }), 400);
  });

  test('séances en plus : au moins un créneau', async () => {
    refused(await admin('PUT', `/temp-schedules/${sched}/groups/${groupH.id}`, { mode: 'ADD', version, slots: [] }), 400);
  });

  test('stage du groupe H en plus de son horaire habituel', async () => {
    ok(await admin('PUT', `/temp-schedules/${sched}/groups/${groupH.id}`, {
      mode: 'ADD', version,
      slots: [{ day: wd(addDays(D, 1)), startTime: '04:00', endTime: '05:00', courtId: courtB.id, coachIds: [coachB] }],
    }), 'groupe H');
    await reload();
  });

  test('publication : horaire remplacé pendant les dates seulement, séances en plus, pastille des vacances', async () => {
    const r = ok(await admin('POST', `/temp-schedules/${sched}/publish`, { version, notify: false }));
    assert.equal(r.notified, 0);
    const s = await reload();
    assert.equal(s.status, 'PUBLISHED');
    assert.equal((await sessionsOf(D, groupG.id)).length, 0, 'séance habituelle de G remplacée');
    const holiday = await sessionsOf(addDays(D, 1), groupG.id);
    assert.equal(holiday.length, 1);
    assert.equal(holiday[0].endTime, '05:30');
    assert.equal(holiday[0].holiday, s.name);
    assert.equal((await sessionsOf(addDays(D, 7), groupG.id)).length, 1, 'horaire habituel de retour après les dates');
    assert.equal((await sessionsOf(addDays(D, 2), groupH.id)).length, 1, 'H garde son horaire habituel');
    assert.equal((await sessionsOf(addDays(D, 1), groupH.id)).length, 1, 'H a sa séance en plus');
  });

  test('un groupe ne suit qu’un emploi publié à la fois', async () => {
    const other = ok(await admin('POST', '/temp-schedules', { name: `Autre ${uid()}`, startDate: addDays(D, 3), endDate: addDays(D, 9) })).id;
    schedules.push(other);
    let v = ok(await admin('GET', `/temp-schedules/${other}`)).version;
    ok(await admin('PUT', `/temp-schedules/${other}/groups/${groupG.id}`, { mode: 'REPLACE', version: v, slots: [] }));
    v = ok(await admin('GET', `/temp-schedules/${other}`)).version;
    refused(await admin('POST', `/temp-schedules/${other}/publish`, { version: v, notify: false }), 409, /R5/);
  });

  test('déjà publié : nouvelle publication refusée', async () => {
    refused(await admin('POST', `/temp-schedules/${sched}/publish`, { version }), 400);
  });

  test('retour en brouillon avec motif : l’horaire habituel revient', async () => {
    refused(await admin('POST', `/temp-schedules/${sched}/unpublish`, { version, reason: '' }), 400);
    ok(await admin('POST', `/temp-schedules/${sched}/unpublish`, { version, reason: 'Vacances déplacées' }));
    await reload();
    assert.equal((await sessionsOf(D, groupG.id)).length, 1);
    assert.equal((await sessionsOf(addDays(D, 1), groupG.id)).length, 0);
  });

  test('retrait d’un groupe puis archivage (R8)', async () => {
    ok(await admin('DELETE', `/temp-schedules/${sched}/groups/${groupH.id}?version=${version}`));
    const s = await reload();
    assert.equal(s.groups.find((x) => x.id === groupH.id).mode, null);
    ok(await admin('POST', `/temp-schedules/${sched}/archive`, { version, reason: 'Test terminé' }));
    refused(await admin('GET', `/temp-schedules/${sched}`), 404);
    const list = ok(await admin('GET', '/temp-schedules'));
    assert.ok(!list.schedules.some((x) => x.id === sched));
  });
});

describe('Vacances publiées : modification annoncée', () => {
  let admin, coach, iheb, group, sched;
  const day = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
  const plus = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    iheb = ok(await admin('GET', '/coaches')).find((c) => c.email === 'iheb@exemple.tn');
    const court = ok(await admin('GET', '/courts')).find((c) => c.active);
    group = ok(await admin('POST', '/groups', { name: `Annonce ${uid()}`, capacity: 6, weeklyMinutes: 120, sessionMinutes: 60 }));
    const season = ok(await admin('GET', '/seasons/active'));
    let D = plus(new Date().toISOString().slice(0, 10), 40);
    if (plus(D, 6) > season.endDate.slice(0, 10)) D = plus(season.endDate.slice(0, 10), -10);
    sched = ok(await admin('POST', '/temp-schedules', { name: `Annonce ${uid()}`, startDate: D, endDate: plus(D, 6) })).id;
    const v = ok(await admin('GET', `/temp-schedules/${sched}`)).version;
    const slot = { day: day(D), startTime: '07:00', endTime: '08:00', courtId: court.id, coachIds: [iheb.id] };
    ok(await admin('PUT', `/temp-schedules/${sched}/groups/${group.id}`, { mode: 'ADD', version: v, slots: [slot] }));
    const v2 = ok(await admin('GET', `/temp-schedules/${sched}`)).version;
    ok(await admin('POST', `/temp-schedules/${sched}/publish`, { version: v2, notify: false }));
  });

  after(async () => {
    const s = ok(await admin('GET', `/temp-schedules/${sched}`));
    await admin('POST', `/temp-schedules/${sched}/unpublish`, { version: s.version, reason: 'Fin du test' });
    const s2 = ok(await admin('GET', `/temp-schedules/${sched}`));
    await admin('POST', `/temp-schedules/${sched}/archive`, { version: s2.version, reason: 'Fin du test' });
    await admin('POST', `/groups/${group.id}/archive`);
  });

  test('séance modifiée : l’entraîneur est prévenu, un seul avis pour plusieurs changements', async (t) => {
    if (!iheb) return t.skip('entraîneur de démo absent');
    const s = ok(await admin('GET', `/temp-schedules/${sched}`));
    const g = s.groups.find((x) => x.id === group.id);
    const moved = g.slots.map((x) => ({ day: x.day, startTime: '07:30', endTime: '08:30', courtId: x.court.id, coachIds: [iheb.id] }));
    ok(await admin('PUT', `/temp-schedules/${sched}/groups/${group.id}`, { mode: 'ADD', version: s.version, slots: moved }));
    const s2 = ok(await admin('GET', `/temp-schedules/${sched}`));
    const again = moved.map((x) => ({ ...x, startTime: '07:00', endTime: '08:00' }));
    ok(await admin('PUT', `/temp-schedules/${sched}/groups/${group.id}`, { mode: 'ADD', version: s2.version, slots: again }));
    const notes = ok(await coach('GET', '/notifications')).filter((n) => n.title === `Vacances modifiées : ${s.name}`);
    assert.equal(notes.length, 1, 'un seul avis, le plus récent');
    assert.match(notes[0].body, new RegExp(group.name));
    assert.match(notes[0].body, /07:00/);
  });
});
