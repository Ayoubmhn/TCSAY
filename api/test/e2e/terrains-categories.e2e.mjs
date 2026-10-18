// Test de bout en bout : catégories (29 + Loisirs, paires, suggestion selon l'âge) et terrains (R11, fermetures, entretien).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

/** Date AAAA-MM-JJ dans n jours. */
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('Catégories et suggestion (R3)', () => {
  let admin, parent, saison;

  before(async () => {
    admin = await as('admin');
    parent = await as('parent');
    saison = ok(await admin('GET', '/seasons/active'));
  });

  test('29 catégories par genre + Loisirs, regroupées en paires', async () => {
    const cats = ok(await admin('GET', '/categories'));
    assert.equal(cats.filter((c) => c.family !== 'LEISURE').length, 29);
    assert.equal(cats.filter((c) => c.family === 'LEISURE').length, 1);
    for (const c of cats.filter((x) => x.family === 'YOUTH')) {
      assert.ok(cats.some((o) => o.pairCode === c.pairCode && o.gender !== c.gender), `paire incomplète pour ${c.code}`);
    }
  });

  test('filtre par famille', async () => {
    const youth = ok(await admin('GET', '/categories?family=YOUTH'));
    assert.equal(youth.length, 20);
    assert.ok(youth.every((c) => c.family === 'YOUTH'));
  });

  test('suggestion : une fille de 8 ans va en Poussines (-9)', async () => {
    const y = new Date(saison.startDate).getUTCFullYear();
    const s = ok(await admin('GET', `/categories/suggest?birthDate=${y - 8}-05-01&gender=F`));
    assert.equal(s.age, 8);
    assert.equal(s.category.code, 'J9F');
    assert.equal(s.minor, true);
  });

  test('suggestion : adulte de 40 ans = Seniors, alternative Vétérans +35', async () => {
    const y = new Date(saison.startDate).getUTCFullYear();
    const s = ok(await admin('GET', `/categories/suggest?birthDate=${y - 40}-01-15&gender=M`));
    assert.equal(s.category.code, 'A1M');
    assert.equal(s.alternative?.code, 'V35M');
    assert.equal(s.minor, false);
  });

  test('suggestion : moins de 4 ans = erreur claire', async () => {
    const y = new Date(saison.startDate).getUTCFullYear();
    const s = ok(await admin('GET', `/categories/suggest?birthDate=${y - 2}-01-01&gender=M`));
    assert.ok(s.error, 'message d’âge minimum attendu');
  });

  test('suggestion : paramètres invalides refusés', async () => {
    refused(await admin('GET', '/categories/suggest?birthDate=2015-13&gender=M'), 400);
    refused(await admin('GET', '/categories/suggest?birthDate=2015-01-01&gender=X'), 400);
  });

  test('un parent lit aussi les catégories', async () => {
    assert.equal((await parent('GET', '/categories')).status, 200);
  });
});

describe('Terrains (R11, fermetures, entretien)', () => {
  let admin, coach, parent, dt, occupe, libre;

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    parent = await as('parent');
    dt = await as('dt');
  });

  test('tous les acteurs voient les terrains', async () => {
    const courts = ok(await admin('GET', '/courts'));
    assert.ok(courts.length >= 4);
    occupe = courts.find((c) => c.active && c.name.startsWith('Court'));
    libre = courts.find((c) => c.active && !c.lit);
    assert.ok(occupe, 'terrains de la démo attendus');
    assert.equal((await coach('GET', '/courts')).status, 200);
    assert.equal((await parent('GET', '/courts')).status, 200);
  });

  test('R11 : un terrain avec une réservation à venir ne se désactive pas ; après annulation, si', async () => {
    const court = ok(await admin('POST', '/courts', { name: `Terrain E2E ${uid()}`, surface: 'HARD', lit: false }));
    const resa = ok(await admin('POST', '/reservations', { courtId: court.id, date: inDays(20), time: '10:00', duration: 60 }), 'réservation');
    assert.equal(ok(await admin('GET', '/courts')).find((c) => c.id === court.id).futureReservations, 1);
    refused(await admin('POST', `/courts/${court.id}/deactivate`), 409, /R11/);
    ok(await admin('POST', `/reservations/${resa.id}/cancel`, { reason: 'Test E2E' }), 'annulation');
    const off = ok(await admin('POST', `/courts/${court.id}/deactivate`));
    assert.equal(off.active, false);
    const on = ok(await admin('POST', `/courts/${court.id}/activate`));
    assert.equal(on.active, true);
    ok(await admin('POST', `/courts/${court.id}/deactivate`)); // laissé désactivé : n'apparaît pas à la réservation
  });

  test('création : surface inconnue refusée', async () => {
    refused(await admin('POST', '/courts', { name: 'X', surface: 'SAND', lit: true }), 400);
  });

  test('R13 : modification avec une version périmée refusée', async () => {
    const court = ok(await admin('GET', '/courts')).find((c) => c.id === (libre ?? occupe).id);
    refused(await admin('PATCH', `/courts/${court.id}`, { version: court.version + 9, name: court.name }), 409, /R13/);
  });

  test('horaires de réservation : fin avant début refusée', async () => {
    const court = ok(await admin('GET', '/courts')).find((c) => c.id === occupe.id);
    refused(await admin('PATCH', `/courts/${court.id}`, { version: court.version, bookFrom: '18:00', bookTo: '08:00' }), 400);
  });

  test('fermeture temporaire : motif obligatoire, dates dans l’ordre, puis retrait', async () => {
    const id = occupe.id;
    refused(await admin('POST', `/courts/${id}/closures`, { fromDate: inDays(30), toDate: inDays(31), reason: '' }), 400);
    refused(await admin('POST', `/courts/${id}/closures`, { fromDate: inDays(31), toDate: inDays(30), reason: 'Résine' }), 400);
    const c = ok(await admin('POST', `/courts/${id}/closures`, { fromDate: inDays(30), toDate: inDays(31), reason: 'Résine E2E' }));
    const listed = ok(await admin('GET', '/courts')).find((x) => x.id === id).closures;
    assert.ok(listed.some((x) => x.id === c.id && x.reason === 'Résine E2E'));
    ok(await admin('DELETE', `/courts/closures/${c.id}`));
    const after = ok(await admin('GET', '/courts')).find((x) => x.id === id).closures;
    assert.ok(!after.some((x) => x.id === c.id));
  });

  test('entretien : activé puis levé', async () => {
    const id = (libre ?? occupe).id;
    assert.equal(ok(await admin('POST', `/courts/${id}/maintenance`, { maintenance: true })).maintenance, true);
    assert.equal(ok(await admin('POST', `/courts/${id}/maintenance`, { maintenance: false })).maintenance, false);
  });

  test('sans l’autorisation courts.manage : refus (parent, coach, directeur technique)', async () => {
    refused(await parent('POST', '/courts', { name: 'X', surface: 'HARD', lit: true }), 403);
    refused(await coach('POST', `/courts/${occupe.id}/maintenance`, { maintenance: true }), 403);
    refused(await dt('POST', `/courts/${occupe.id}/deactivate`), 403);
  });
});
