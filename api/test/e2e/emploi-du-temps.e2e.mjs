// Test de bout en bout : grille de l'emploi du temps — volume des groupes (tennis et séance physique), brouillon par groupe,
// contrôles (durée, volume, terrain, entraîneur, éclairage, R5, R13), placement automatique, publication, motif du volume.
// Base de DÉMONSTRATION uniquement. Séances le matin en semaine (aucun groupe de la démo avant 16 h du lundi au vendredi).
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

describe('Emploi du temps (grille, brouillon, volumes)', () => {
  let admin, coach, court, other, unlit, coachA, coachB, G, H, version;
  const groups = [];
  const slot = (o = {}) => ({ day: 1, startTime: '08:00', endTime: '09:30', courtId: court.id, coachIds: [coachA], kind: 'TENNIS', ...o });
  const load = async () => {
    const t = ok(await admin('GET', '/timetable'));
    version = t.draft.version;
    return t;
  };
  const put = (groupId, slots, v = version) => admin('PUT', `/timetable/draft/groups/${groupId}`, { slots, version: v });

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    const courts = ok(await admin('GET', '/courts')).filter((c) => c.active && !c.maintenance);
    court = courts.find((c) => c.lit) ?? courts[0];
    other = courts.find((c) => c.id !== court.id);
    unlit = courts.find((c) => !c.lit);
    const mkCoach = async () => ok(await admin('POST', '/coaches', { firstName: 'Coach', lastName: `Grille${uid()}`, cin: fakeCin(), payMode: 'HOURLY', payRate: 10 })).id;
    coachA = await mkCoach();
    coachB = await mkCoach();
    await admin('DELETE', '/timetable/draft'); // brouillon laissé par un passage interrompu
  });

  after(async () => {
    await admin('DELETE', '/timetable/draft');
    for (const id of groups) await admin('POST', `/groups/${id}/archive`);
  });

  test('création d’un groupe : sans volume, au moins un créneau', async () => {
    refused(await admin('POST', '/groups', { name: `Grille ${uid()}`, capacity: 6, slots: [] }), 400);
  });

  test('création avec volume (3 h en séances de 1 h 30, 1 h de physique) sans créneau', async () => {
    G = ok(await admin('POST', '/groups', {
      name: `Grille G ${uid()}`, kind: 'COMPETITIVE', capacity: 8,
      weeklyMinutes: 180, sessionMinutes: 90, physicalMinutes: 60, physicalSessionMinutes: 60,
      mainCoachId: coachA, physicalCoachId: coachB, preferredCourtId: court.id,
    }));
    H = ok(await admin('POST', '/groups', { name: `Grille H ${uid()}`, kind: 'COMPETITIVE', capacity: 8, weeklyMinutes: 60, sessionMinutes: 60 }));
    groups.push(G.id, H.id);
    assert.equal(G.weeklyMinutes, 180);
    assert.equal(G.physicalMinutes, 60);
    assert.equal(G.slots.length, 0);
  });

  test('la grille donne les groupes, leurs volumes et le brouillon vide', async () => {
    const t = await load();
    const g = t.groups.find((x) => x.id === G.id);
    assert.equal(g.sessionMinutes, 90);
    assert.deepEqual(g.published, []);
    assert.equal(g.draft, null);
    assert.ok(t.courts.length && t.coaches.some((c) => c.id === coachA));
  });

  test('séance de tennis placée dans le brouillon', async () => {
    const t = ok(await put(G.id, [slot()]));
    version = t.draft.version;
    assert.equal(t.draft.changes.length >= 1, true);
    assert.equal(t.groups.find((x) => x.id === G.id).draft.length, 1);
  });

  test('R13 : version du brouillon périmée', async () => {
    refused(await put(G.id, [slot()], version - 1), 409, /R13/);
  });

  test('durée d’une séance et volume par semaine contrôlés', async () => {
    refused(await put(G.id, [slot(), slot({ day: 2, startTime: '10:00', endTime: '11:00' })]), 409);
    refused(await put(G.id, [slot(), slot({ day: 2 }), slot({ day: 3 })]), 409);
  });

  test('séance de tennis sans terrain refusée ; séance physique hors terrain acceptée', async () => {
    refused(await put(G.id, [slot({ courtId: undefined })]), 400);
    const t = ok(await put(G.id, [slot(), slot({ day: 2, startTime: '08:00', endTime: '09:00', courtId: undefined, coachIds: [coachB], kind: 'PHYSICAL' })]));
    version = t.draft.version;
  });

  test('séance physique refusée pour un groupe qui n’en prévoit pas', async () => {
    refused(await put(H.id, [slot({ day: 3, endTime: '09:00', courtId: undefined, coachIds: [], kind: 'PHYSICAL' })]), 409);
  });

  test('R5 : même terrain, même entraîneur ou le groupe à deux endroits', async () => {
    refused(await put(H.id, [slot({ startTime: '08:30', endTime: '09:30', coachIds: [] })]), 409, /R5/);
    refused(await put(H.id, [slot({ startTime: '08:30', endTime: '09:30', courtId: other.id })]), 409, /R5/);
    refused(await put(G.id, [slot(), slot({ day: 1, startTime: '09:00', endTime: '10:00', courtId: undefined, coachIds: [coachB], kind: 'PHYSICAL' })]), 409, /R5/);
  });

  test('terrain sans éclairage refusé la nuit', async (t) => {
    if (!unlit) return t.skip('aucun terrain sans éclairage');
    refused(await put(H.id, [slot({ day: 4, startTime: '20:00', endTime: '21:00', courtId: unlit.id, coachIds: [] })]), 409, /R5/);
  });

  test('brouillon sans effet sur le planning', async () => {
    const today = new Date().toISOString().slice(0, 10);
    let monday = addDays(today, 7);
    while (wd(monday) !== 1) monday = addDays(monday, 1);
    const p = ok(await admin('GET', `/planning?date=${monday}`));
    assert.equal(p.sessions.filter((s) => s.group.id === G.id).length, 0);
  });

  test('placement automatique de la séance qui manque', async () => {
    await load();
    const t = ok(await admin('POST', `/timetable/draft/auto/${G.id}`, { version }));
    assert.equal(t.placed, 1);
    const draft = t.groups.find((x) => x.id === G.id).draft;
    assert.equal(draft.filter((s) => s.kind === 'TENNIS').length, 2);
    version = t.draft.version;
    refused(await admin('POST', `/timetable/draft/auto/${G.id}`, { version }), 409);
  });

  test('publication : l’emploi du temps habituel change, brouillon vidé', async () => {
    const r = ok(await admin('POST', '/timetable/draft/publish', { version, notify: false }));
    assert.ok(r.groups >= 1);
    const g = ok(await admin('GET', '/groups')).find((x) => x.id === G.id);
    assert.equal(g.slots.length, 3);
    assert.ok(g.slots.some((s) => s.kind === 'PHYSICAL' && !s.court));
    const t = await load();
    assert.equal(t.groups.find((x) => x.id === G.id).draft, null);
    assert.equal(t.draft.changes.length, 0);
    const today = new Date().toISOString().slice(0, 10);
    let monday = addDays(today, 7);
    while (wd(monday) !== 1) monday = addDays(monday, 1);
    const p = ok(await admin('GET', `/planning?date=${monday}`));
    assert.equal(p.sessions.filter((s) => s.group.id === G.id).length, 1);
  });

  test('rien à publier', async () => {
    refused(await admin('POST', '/timetable/draft/publish', { version, notify: false }), 400);
  });

  test('revenir à l’horaire publié pour un groupe', async () => {
    const g = (await load()).groups.find((x) => x.id === G.id);
    ok(await put(G.id, g.published.filter((s) => s.kind === 'TENNIS')));
    const t1 = await load();
    assert.ok(t1.groups.find((x) => x.id === G.id).draft);
    ok(await admin('DELETE', `/timetable/draft/groups/${G.id}?version=${version}`));
    assert.equal((await load()).groups.find((x) => x.id === G.id).draft, null);
  });

  test('volume d’un groupe : motif obligatoire, jamais sous les séances placées', async () => {
    const g = ok(await admin('GET', '/groups')).find((x) => x.id === G.id);
    const base = { name: g.name, kind: g.kind, capacity: g.capacity, version: g.version };
    refused(await admin('PATCH', `/groups/${G.id}`, { ...base, weeklyMinutes: 90 }), 400);
    refused(await admin('PATCH', `/groups/${G.id}`, { ...base, weeklyMinutes: 90, volumeReason: 'Moins de séances' }), 409);
    const r = ok(await admin('PATCH', `/groups/${G.id}`, { ...base, weeklyMinutes: 270, volumeReason: 'Une séance de plus' }));
    assert.equal(r.weeklyMinutes, 270);
    assert.equal(r.slots.length, 3, 'créneaux gardés quand la demande n’en contient pas');
  });

  test('réservé à la direction (entraîneur : 403)', async () => {
    refused(await coach('GET', '/timetable'), 403);
  });
});
