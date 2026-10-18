// Test de bout en bout : groupes d'entraînement (R4 capacité et catégorie, R5 conflits de terrain et d'entraîneur, R8, R13).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs). Créneaux à 05:00 (aucun groupe de la démo à cette heure).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

const fakeCin = () => ('T' + uid()).slice(0, 12); // CIN fictive unique
const fakeEmail = (prefix = 'e2e') => `${prefix}.${uid()}@exemple.tn`;

describe('Groupes (R4, R5)', () => {
  let admin, dt, agent, coach, year, cats, court, coachA, coachB, groupe, autre, j10, j10f, j14;
  const created = [];

  /** Joueur mineur fictif de la saison active. */
  const player = async (gender, age, extra = {}) =>
    ok(await admin('POST', '/players', {
      firstName: 'Membre', lastName: `E2E${uid()}`, birthDate: `${year - age}-04-04`, gender,
      newParent: { firstName: 'Parent', lastName: `E2E${uid()}`, phone: '20000020', email: fakeEmail('parent'), cin: fakeCin() }, ...extra,
    }), 'joueur');

  const slot = (o = {}) => ({ day: 0, startTime: '05:00', endTime: '06:00', courtId: court.id, coachIds: [coachA], ...o });

  before(async () => {
    admin = await as('admin');
    dt = await as('dt');
    agent = await as('agent');
    coach = await as('coach');
    year = new Date(ok(await admin('GET', '/seasons/active')).startDate).getUTCFullYear();
    cats = ok(await admin('GET', '/categories'));
    court = ok(await admin('GET', '/courts')).find((c) => c.active && c.name === 'Annexe') ?? ok(await admin('GET', '/courts')).find((c) => c.active);
    const mkCoach = async () => ok(await admin('POST', '/coaches', { firstName: 'Coach', lastName: `E2E${uid()}`, cin: fakeCin(), payMode: 'HOURLY', payRate: 10 })).id;
    coachA = await mkCoach();
    coachB = await mkCoach();
    j10 = await player('M', 9); // Poussins (-10)
    j10f = await player('F', 9); // Poussines (-10) : même paire
    j14 = await player('M', 13); // Minimes
  });

  after(async () => {
    // Groupes archivés : leurs créneaux ne bloquent plus une relance du test (R5).
    for (const id of created) await admin('POST', `/groups/${id}/archive`);
  });

  test('création : au moins un créneau, fin après début', async () => {
    refused(await admin('POST', '/groups', { name: 'Vide', capacity: 4, slots: [] }), 400);
    refused(await admin('POST', '/groups', { name: 'Horaire', capacity: 4, slots: [slot({ startTime: '06:00', endTime: '05:00' })] }), 400);
  });

  test('R5 : deux créneaux du groupe qui se chevauchent sur le même terrain', async () => {
    const r = await admin('POST', '/groups', { name: `G ${uid()}`, capacity: 4, slots: [slot(), slot({ startTime: '05:30', endTime: '06:30', coachIds: [coachB] })] });
    refused(r, 409, /R5/);
  });

  test('création d’un groupe Poussins de 2 places', async () => {
    groupe = ok(await admin('POST', '/groups', {
      name: `Poussins E2E ${uid()}`, categoryId: cats.find((c) => c.code === 'J10M').id, kind: 'COMPETITIVE', capacity: 2, slots: [slot()],
    }));
    created.push(groupe.id);
    assert.equal(groupe.capacity, 2);
    assert.equal(groupe.slots[0].court.id, court.id);
    assert.equal(groupe.coaches[0].id, coachA);
  });

  test('R5 : un autre groupe sur le même terrain au même moment est refusé', async () => {
    refused(await admin('POST', '/groups', { name: `G ${uid()}`, capacity: 4, slots: [slot({ startTime: '05:30', endTime: '06:30', coachIds: [coachB] })] }), 409, /R5/);
  });

  test('R5 : le même entraîneur sur un autre terrain au même moment est refusé', async () => {
    const other = ok(await admin('GET', '/courts')).find((c) => c.active && c.id !== court.id);
    refused(await admin('POST', '/groups', { name: `G ${uid()}`, capacity: 4, slots: [slot({ courtId: other.id })] }), 409, /R5/);
  });

  test('créneau juste après (06:00) : accepté', async () => {
    autre = ok(await admin('POST', '/groups', { name: `Suite E2E ${uid()}`, capacity: 1, slots: [slot({ startTime: '06:00', endTime: '07:00' })] }));
    created.push(autre.id);
  });

  test('R4 : la paire garçons / filles entre sans dérogation', async () => {
    ok(await admin('POST', `/groups/${groupe.id}/members`, { playerId: j10.id }));
    ok(await admin('POST', `/groups/${groupe.id}/members`, { playerId: j10f.id }));
  });

  test('R4 : groupe complet', async () => {
    refused(await admin('POST', `/groups/${groupe.id}/members`, { playerId: j14.id, derogationReason: 'Test' }), 409, /R4/);
  });

  test('R4 : capacité inférieure au nombre de joueurs refusée', async () => {
    const g = ok(await admin('GET', '/groups')).find((x) => x.id === groupe.id);
    refused(await admin('PATCH', `/groups/${g.id}`, { name: g.name, categoryId: g.category.id, capacity: 1, version: g.version, slots: [slot({ id: g.slots[0].id })] }), 409, /R4/);
  });

  test('R13 : version périmée refusée ; agrandir le groupe accepté', async () => {
    const g = ok(await admin('GET', '/groups')).find((x) => x.id === groupe.id);
    const body = { name: g.name, categoryId: g.category.id, capacity: 3, slots: [slot({ id: g.slots[0].id })] };
    refused(await admin('PATCH', `/groups/${g.id}`, { ...body, version: g.version + 2 }), 409, /R13/);
    groupe = ok(await admin('PATCH', `/groups/${g.id}`, { ...body, version: g.version }));
    assert.equal(groupe.capacity, 3);
  });

  test('R4 : autre catégorie sans motif refusée, avec motif acceptée', async () => {
    refused(await admin('POST', `/groups/${groupe.id}/members`, { playerId: j14.id }), 400, /R4/);
    ok(await admin('POST', `/groups/${groupe.id}/members`, { playerId: j14.id, derogationReason: 'Niveau E2E' }));
    const g = ok(await admin('GET', '/groups')).find((x) => x.id === groupe.id);
    assert.equal(g.members.length, 3);
    assert.equal(g.members.find((m) => m.playerId === j14.id).derogationReason, 'Niveau E2E');
  });

  test('un joueur déjà dans le groupe n’est pas ajouté deux fois', async () => {
    const g = ok(await admin('GET', '/groups')).find((x) => x.id === groupe.id);
    const r = await admin('POST', `/groups/${groupe.id}/members`, { playerId: j10.id });
    assert.ok(r.status >= 400, `doublon accepté (statut ${r.status})`);
    assert.equal(ok(await admin('GET', '/groups')).find((x) => x.id === groupe.id).members.length, g.members.length);
  });

  test('fiche du groupe : joueurs et places', async () => {
    const d = ok(await admin('GET', `/groups/${groupe.id}/detail`));
    assert.equal(d.members.length, 3);
    assert.equal(d.places, 0);
  });

  test('retrait d’un joueur', async () => {
    ok(await admin('DELETE', `/groups/${groupe.id}/members/${j14.id}`));
    assert.equal(ok(await admin('GET', '/groups')).find((x) => x.id === groupe.id).members.length, 2);
  });

  test('R8 : un joueur archivé quitte ses groupes', async () => {
    ok(await admin('POST', `/players/${j10f.id}/archive`));
    const g = ok(await admin('GET', '/groups')).find((x) => x.id === groupe.id);
    assert.ok(!g.members.some((m) => m.playerId === j10f.id));
    ok(await admin('POST', `/players/${j10f.id}/restore`));
  });

  test('droits : le directeur technique gère les groupes, l’agent non ; le coach ne voit que les siens', async () => {
    assert.equal((await dt('GET', '/groups')).status, 200);
    refused(await agent('POST', '/groups', { name: 'X', capacity: 2, slots: [slot({ startTime: '04:00', endTime: '04:30' })] }), 403);
    const mine = ok(await coach('GET', '/groups'));
    assert.ok(!mine.some((g) => g.id === groupe.id), 'le coach voit un groupe qui n’est pas le sien');
    refused(await coach('POST', `/groups/${groupe.id}/members`, { playerId: j14.id }), 403);
  });

  test('R8 : groupe archivé, il disparaît de la liste', async () => {
    ok(await admin('POST', `/groups/${autre.id}/archive`));
    assert.ok(!ok(await admin('GET', '/groups')).some((g) => g.id === autre.id));
  });
});
