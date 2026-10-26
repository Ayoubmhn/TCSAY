// Test de bout en bout : compteur des séances (prévues, données, à rattraper, en avance), séance annulée par le club
// (pluie, fermeture : motif, notification, pas de pointage, rétablissement) et nouvelles vacances « Partir de » (emploi
// publié, d'autres vacances, brouillon) avec « séances dues ». Base de DÉMONSTRATION uniquement.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

describe('Compteur des séances', () => {
  let admin, coach, parent;

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    parent = await as('parent');
  });

  test('direction : totaux et groupes ; séance annulée du seed rattrapée par le stage, l’autre à rattraper', async () => {
    const r = ok(await admin('GET', '/session-counter'));
    assert.ok(r.totals.planned > 0 && r.groups.length > 0);
    for (const g of r.groups) assert.equal(g.balance.sessions, g.given.sessions - g.planned.sessions);
    const benj = r.groups.find((g) => g.group.name === 'Benjamins G');
    if (benj) {
      const rain = benj.missed.find((m) => m.reason === 'Pluie');
      if (rain) assert.ok(rain.madeUp?.done, 'la séance de pluie est rattrapée par le stage');
      const wet = benj.missed.find((m) => m.reason === 'Terrain impraticable');
      if (wet) assert.ok(benj.owed >= 1);
    }
    // Filtre par période : le mois dernier seulement.
    const m = ok(await admin('GET', `/session-counter?from=${addDays(today(), -30)}&to=${today()}`));
    for (const g of m.groups) assert.ok(g.from >= addDays(today(), -30));
  });

  test('entraîneur : ses groupes seulement ; pas la route de la direction', async () => {
    const r = ok(await coach('GET', '/session-counter/mine'));
    assert.ok(Array.isArray(r.groups));
    refused(await coach('GET', '/session-counter'), 403);
  });

  test('parent : compteur de l’enfant (absences à part, aucun montant) ; pas la route de la direction', async () => {
    const r = ok(await parent('GET', '/session-counter/player'));
    assert.ok(Array.isArray(r.groups));
    for (const g of r.groups) {
      assert.ok(Array.isArray(g.absences));
      assert.ok(!JSON.stringify(g).includes('amount'));
    }
    refused(await parent('GET', '/session-counter'), 403);
  });
});

describe('Séance annulée par le club (pluie, fermeture)', () => {
  let admin, coach, s, date;

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    // Une séance à venir sans présence, sans changement ni absence d'entraîneur.
    for (let i = 2; i < 20 && !s; i++) {
      const d = addDays(today(), i);
      const p = ok(await admin('GET', `/planning?date=${d}`));
      s = p.sessions.find((x) => !x.resolution && !x.change && x.coaches.length);
      if (s) date = d;
    }
    assert.ok(s, 'une séance à venir dans les 20 prochains jours');
  });

  after(async () => {
    if (s) await admin('DELETE', `/session-changes/cancel/${s.id}/${date}`);
  });

  test('motif obligatoire ; mauvais jour refusé ; entraîneur refusé', async () => {
    refused(await admin('POST', '/session-changes/cancel', { slotId: s.id, date, reason: '' }), 400);
    refused(await admin('POST', '/session-changes/cancel', { slotId: s.id, date: addDays(date, 1), reason: 'Pluie' }), 400);
    refused(await coach('POST', '/session-changes/cancel', { slotId: s.id, date, reason: 'Pluie' }), 403);
  });

  test('annulée : planning « annulée » avec motif, familles prévenues, pointage refusé ; puis rétablie', async () => {
    const r = ok(await admin('POST', '/session-changes/cancel', { slotId: s.id, date, reason: `Pluie ${uid()}` }));
    assert.equal(r.ok, true);
    const p = ok(await admin('GET', `/planning?date=${date}`)).sessions.find((x) => x.id === s.id);
    assert.equal(p.resolution, 'CANCELLED');
    assert.equal(p.change.kind, 'CANCELLED');
    assert.match(p.change.reason, /^Pluie/);
    refused(await admin('PUT', '/attendance', { slotId: s.id, date, entries: [] }), 409);
    ok(await admin('DELETE', `/session-changes/cancel/${s.id}/${date}`));
    const back = ok(await admin('GET', `/planning?date=${date}`)).sessions.find((x) => x.id === s.id);
    assert.equal(back.change, null);
    refused(await admin('DELETE', `/session-changes/cancel/${s.id}/${date}`), 404);
  });
});

describe('Nouvelles vacances : « Partir de » et séances dues', () => {
  let admin, season;
  const created = [];

  before(async () => {
    admin = await as('admin');
    season = ok(await admin('GET', '/seasons/active'));
  });

  after(async () => {
    for (const id of created) {
      const d = await admin('GET', `/temp-schedules/${id}`);
      if (d.status === 200) await admin('POST', `/temp-schedules/${id}/archive`, { version: d.data.version, reason: 'Nettoyage des tests' });
    }
  });

  // Mardi → jeudi d'une semaine à venir, dans la saison.
  const window = () => {
    let d = addDays(today(), 40);
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 2) d = addDays(d, 1);
    return { startDate: d, endDate: addDays(d, 2) };
  };

  test('emploi publié recopié : groupes de ces jours-là, horaire remplacé, séances des jours compris seulement', async () => {
    const w = window();
    if (w.endDate > season.endDate.slice(0, 10)) return;
    const r = ok(await admin('POST', '/temp-schedules', { name: `Stage ${uid()}`, ...w, from: 'PUBLISHED', sessionsOwed: true }));
    created.push(r.id);
    assert.ok(r.groups > 0);
    const d = ok(await admin('GET', `/temp-schedules/${r.id}`));
    assert.equal(d.status, 'DRAFT');
    assert.equal(d.sessionsOwed, true);
    const inSchedule = d.groups.filter((g) => g.mode);
    assert.equal(inSchedule.length, r.groups);
    for (const g of inSchedule) {
      assert.equal(g.mode, 'REPLACE');
      for (const sl of g.slots) assert.ok([2, 3, 4].includes(sl.day), 'seulement mardi, mercredi, jeudi');
    }

    // D'autres vacances : mêmes groupes repris.
    const again = ok(await admin('POST', '/temp-schedules', { name: `Reprise ${uid()}`, ...w, from: 'TEMP', fromId: r.id }));
    created.push(again.id);
    assert.equal(again.groups, r.groups);
    const d2 = ok(await admin('GET', `/temp-schedules/${again.id}`));
    assert.equal(d2.sessionsOwed, false);
  });

  test('emploi vide par défaut ; brouillon ou vacances sans choix refusés ; séances dues modifiables', async () => {
    const w = window();
    if (w.endDate > season.endDate.slice(0, 10)) return;
    const r = ok(await admin('POST', '/temp-schedules', { name: `Vide ${uid()}`, ...w }));
    created.push(r.id);
    assert.equal(r.groups, 0);
    refused(await admin('POST', '/temp-schedules', { name: `X ${uid()}`, ...w, from: 'DRAFT' }), 400);
    refused(await admin('POST', '/temp-schedules', { name: `X ${uid()}`, ...w, from: 'TEMP' }), 400);
    refused(await admin('POST', '/temp-schedules', { name: `X ${uid()}`, ...w, from: 'AUTRE' }), 400);
    const d = ok(await admin('GET', `/temp-schedules/${r.id}`));
    ok(await admin('PATCH', `/temp-schedules/${r.id}`, { name: d.name, startDate: d.startDate, endDate: d.endDate, sessionsOwed: true, version: d.version }));
    assert.equal(ok(await admin('GET', `/temp-schedules/${r.id}`)).sessionsOwed, true);
  });

  test('brouillon de la grille repris : groupes modifiés du brouillon + horaire publié des autres', async () => {
    const w = window();
    if (w.endDate > season.endDate.slice(0, 10)) return;
    const draft = ok(await admin('POST', '/timetable/drafts', { name: `Brouillon ${uid()}` }));
    try {
      const r = ok(await admin('POST', '/temp-schedules', { name: `Depuis brouillon ${uid()}`, ...w, from: 'DRAFT', fromId: draft.draft.id }));
      created.push(r.id);
      const pub = ok(await admin('POST', '/temp-schedules', { name: `Publié ${uid()}`, ...w, from: 'PUBLISHED' }));
      created.push(pub.id);
      assert.equal(r.groups, pub.groups, 'brouillon sans changement = horaire publié');
    } finally {
      await admin('DELETE', `/timetable/drafts/${draft.draft.id}?version=${draft.draft.version}`);
    }
  });
});

describe('Séances ponctuelles (rattrapage, en plus, spéciale)', () => {
  let admin, coach, parent, group, other, date, free, freeCoach;
  const created = [];
  const base = () => ({ groupId: group.id, date, startTime: '08:00', endTime: '09:00', courtId: free.id, coachIds: [] });

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    parent = await as('parent');
    const groups = ok(await admin('GET', '/timetable')).groups;
    // Un jour de semaine dans 9 à 20 jours, à 8 h (avant les séances de la démo) : un terrain libre pour le groupe.
    for (let i = 9; i < 21 && !free; i++) {
      const d = addDays(today(), i);
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      for (const g of groups) {
        const o = ok(await admin('GET', `/extra-sessions/options?groupId=${g.id}&date=${d}&startTime=08:00&endTime=09:00`));
        const c = o.courts.find((x) => !x.busy);
        if (!o.groupBusy && c) {
          group = g;
          date = d;
          free = c;
          freeCoach = o.coaches.find((x) => !x.busy);
          other = groups.find((x) => x.id !== g.id);
          break;
        }
      }
    }
    assert.ok(free, 'un créneau libre pour une séance ponctuelle');
  });

  after(async () => {
    for (const id of created) await admin('DELETE', `/extra-sessions/${id}?reason=Nettoyage`);
  });

  test('contrôles : type, titre, terrain, passé, droits', async () => {
    refused(await admin('POST', '/extra-sessions', { ...base(), type: 'MAKEUP' }), 400);
    refused(await admin('POST', '/extra-sessions', { ...base(), type: 'SPECIAL' }), 400);
    refused(await admin('POST', '/extra-sessions', { ...base(), type: 'EXTRA', courtId: undefined }), 400);
    refused(await admin('POST', '/extra-sessions', { ...base(), type: 'EXTRA', date: addDays(today(), -1) }), 400, /R10/);
    refused(await admin('POST', '/extra-sessions', { ...base(), type: 'EXTRA', startTime: '06:00', endTime: '07:00' }), 400, /R5/);
    refused(await coach('POST', '/extra-sessions', { ...base(), type: 'EXTRA' }), 403);
    refused(await parent('POST', '/extra-sessions', { ...base(), type: 'EXTRA' }), 403);
  });

  test('séance en plus : planning, compteur « prévue », conflits du groupe et du terrain, suppression', async () => {
    const r = ok(await admin('POST', '/extra-sessions', { ...base(), type: 'EXTRA', coachIds: freeCoach ? [freeCoach.id] : [], notify: false }));
    created.push(r.id);
    assert.equal(r.name, 'Séance en plus');
    const p = ok(await admin('GET', `/planning?date=${date}`)).sessions.find((s) => s.oneOff?.id === r.id);
    assert.ok(p, 'la séance est dans le planning');
    assert.equal(p.oneOff.type, 'EXTRA');
    const c = ok(await admin('GET', `/session-counter?to=${addDays(date, 1)}`)).groups.find((g) => g.group.id === group.id);
    assert.ok(c.extra.some((e) => e.oneOff?.id === r.id && !e.done));
    // Même groupe, même heure : refusé ; autre groupe sur le même terrain : refusé ; options : terrain pris.
    refused(await admin('POST', '/extra-sessions', { ...base(), type: 'EXTRA', startTime: '08:30', endTime: '09:30' }), 409, /R5/);
    if (other) refused(await admin('POST', '/extra-sessions', { ...base(), groupId: other.id, type: 'EXTRA' }), 409, /R5/);
    const o = ok(await admin('GET', `/extra-sessions/options?groupId=${group.id}&date=${date}&startTime=08:00&endTime=09:00`));
    assert.ok(o.groupBusy);
    assert.ok(o.courts.find((x) => x.id === free.id).busy);
    // Suppression : motif obligatoire, puis le créneau se libère.
    refused(await admin('DELETE', `/extra-sessions/${r.id}`), 400);
    ok(await admin('DELETE', `/extra-sessions/${r.id}?reason=Essai&notify=false`));
    refused(await admin('DELETE', `/extra-sessions/${r.id}?reason=Essai`), 404);
    assert.equal(ok(await admin('GET', `/extra-sessions/options?groupId=${group.id}&date=${date}&startTime=08:00&endTime=09:00`)).groupBusy, null);
  });

  test('rattrapage lié à une séance du groupe ; une seule fois ; séance spéciale avec titre', async () => {
    const slot = group.published[0];
    if (!slot?.id) return;
    const missedDate = addDays(today(), -3);
    const mk = { ...base(), type: 'MAKEUP', makeupSlotId: slot.id, makeupDate: missedDate, notify: false };
    if (other?.published[0]?.id) refused(await admin('POST', '/extra-sessions', { ...mk, makeupSlotId: other.published[0].id }), 400);
    const r = ok(await admin('POST', '/extra-sessions', mk));
    created.push(r.id);
    assert.match(r.name, /^Rattrapage du /);
    refused(await admin('POST', '/extra-sessions', { ...mk, startTime: '10:00', endTime: '11:00' }), 409, /R5/);
    ok(await admin('DELETE', `/extra-sessions/${r.id}?reason=Essai&notify=false`));
    const sp = ok(await admin('POST', '/extra-sessions', { ...base(), type: 'SPECIAL', title: `Préparation ${uid()}`, notify: false }));
    created.push(sp.id);
    assert.match(sp.name, /^Préparation /);
  });
});
