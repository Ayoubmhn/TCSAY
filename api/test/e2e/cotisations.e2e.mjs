// Test de bout en bout : cotisations (création, mode de paiement, aperçu, réductions, dates limites, R7).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs). Chaque scénario crée son propre joueur (tarif 1000 DT).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused } from './helpers.mjs';
import { installmentsOf, newPlayer } from './helpers-paiements.mjs';

const sum = (rows, key) => Math.round(rows.reduce((t, r) => t + r[key], 0) * 1000) / 1000;

describe('Cotisations et échéancier', () => {
  let admin, coach, player, tranches;

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    ({ player } = await newPlayer(admin, { plan: 'SEMESTER' }));
  });

  test('un joueur créé avec « par semestre » a 2 tranches qui font le tarif', async () => {
    tranches = await installmentsOf(admin, player.id);
    assert.equal(tranches.length, 2);
    assert.equal(sum(tranches, 'amount'), 1000);
    assert.ok(tranches.every((t) => t.paid === 0 && t.count === 2));
  });

  test('créer une 2e cotisation sur la même saison est refusé (R7)', async () => {
    refused(await admin('POST', '/memberships', { playerId: player.id, paymentPlan: 'FULL' }), 409, /R7/);
  });

  test('fiche « Modifier » : montants de la cotisation', async () => {
    const info = ok(await admin('GET', `/memberships/player/${player.id}`));
    assert.equal(info.membership.paymentPlan, 'SEMESTER');
    assert.equal(info.membership.total, 1000);
    assert.equal(info.membership.paid, 0);
  });

  test('aperçu du mode « par mois » sans rien enregistrer', async () => {
    const r = ok(await admin('GET', `/memberships/preview?plan=MONTHLY&playerId=${player.id}`));
    assert.ok(r.tranches.length > 2, 'plusieurs mensualités');
    assert.equal(Math.round(r.tranches.reduce((t, x) => t + x.amount, 0) * 1000) / 1000, 1000, 'l’arrondi tombe juste (écart sur la dernière)');
    assert.equal((await installmentsOf(admin, player.id)).length, 2, 'l’aperçu ne modifie rien');
  });

  test('un mode désactivé par le club est refusé (trimestre désactivé dans la démo)', async () => {
    const cfg = ok(await admin('GET', '/payments/config'));
    if (cfg.plans.QUARTER) return; // configuration modifiée ailleurs : la règle est contrôlée dans configuration-paiements
    refused(await admin('PUT', '/memberships/plan', { playerId: player.id, paymentPlan: 'QUARTER' }), 400);
  });

  test('changer de mode avant tout paiement : sans motif, échéancier refait', async () => {
    ok(await admin('PUT', '/memberships/plan', { playerId: player.id, paymentPlan: 'FULL' }));
    tranches = await installmentsOf(admin, player.id);
    assert.equal(tranches.length, 1);
    assert.equal(tranches[0].amount, 1000);
  });

  test('dates choisies pour le joueur : motif obligatoire (R7)', async () => {
    refused(await admin('PUT', '/memberships/plan', { playerId: player.id, paymentPlan: 'SEMESTER', dueDates: ['2026-11-01', '2027-03-01'] }), 400, /R7/);
  });

  test('dates choisies : une date par tranche', async () => {
    refused(await admin('PUT', '/memberships/plan', { playerId: player.id, paymentPlan: 'SEMESTER', dueDates: ['2026-11-01'], reason: 'Test E2E' }), 400);
  });

  test('dates choisies avec motif : appliquées', async () => {
    ok(await admin('PUT', '/memberships/plan', { playerId: player.id, paymentPlan: 'SEMESTER', dueDates: ['2026-11-01', '2027-03-01'], reason: 'Test E2E : accord famille' }));
    tranches = await installmentsOf(admin, player.id);
    assert.deepEqual(tranches.map((t) => t.dueDate), ['2026-11-01', '2027-03-01']);
  });

  test('après un paiement, changer de mode exige un motif (R7) et garde le payé', async () => {
    ok(await admin('POST', `/installments/${tranches[0].id}/payments`, { amount: 100, method: 'CASH', note: 'Test E2E' }));
    refused(await admin('PUT', '/memberships/plan', { playerId: player.id, paymentPlan: 'FULL' }), 400, /R7/);
    ok(await admin('PUT', '/memberships/plan', { playerId: player.id, paymentPlan: 'MONTHLY', reason: 'Test E2E : mensuel' }));
    const now = await installmentsOf(admin, player.id);
    assert.equal(sum(now, 'paid'), 100, 'le payé est conservé');
    assert.equal(sum(now, 'amount'), 1000, 'le total ne change pas');
    tranches = now;
  });

  test('date limite : motif obligatoire', async () => {
    const open = tranches.find((t) => t.remaining > 0);
    refused(await admin('PATCH', `/installments/${open.id}/due-date`, { dueDate: '2027-05-05' }), 400);
    refused(await admin('PATCH', `/installments/${open.id}/due-date`, { dueDate: '2027-05-05', reason: '' }), 400);
  });

  test('date limite modifiée avec motif', async () => {
    const open = tranches.find((t) => t.remaining > 0);
    const r = ok(await admin('PATCH', `/installments/${open.id}/due-date`, { dueDate: '2027-05-05', reason: 'Test E2E : accord famille' }));
    assert.equal(r.dueDate, '2027-05-05');
  });

  test('date limite d’une tranche soldée : refusée', async () => {
    const t = (await installmentsOf(admin, player.id)).find((x) => x.remaining > 0);
    ok(await admin('POST', `/installments/${t.id}/payments`, { amount: t.remaining, method: 'CASH', note: 'Test E2E' }));
    refused(await admin('PATCH', `/installments/${t.id}/due-date`, { dueDate: '2027-06-06', reason: 'Test E2E' }), 400);
  });

  test('l’entraîneur ne touche jamais aux cotisations (403)', async () => {
    refused(await coach('GET', `/memberships/player/${player.id}`), 403);
    refused(await coach('PUT', '/memberships/plan', { playerId: player.id, paymentPlan: 'FULL', reason: 'x' }), 403);
    refused(await coach('GET', '/memberships/missing'), 403);
  });
});

describe('Réductions de cotisation (R7)', () => {
  let admin, player, first;

  before(async () => {
    admin = await as('admin');
    ({ player } = await newPlayer(admin, { plan: 'SEMESTER' }));
    first = (await installmentsOf(admin, player.id))[0];
  });

  test('réduction sans motif refusée (R7)', async () => {
    refused(await admin('PUT', '/memberships/discount', { playerId: player.id, kind: 'SIBLING', percent: 20 }), 400, /R7/);
  });

  test('pourcentage hors limites refusé', async () => {
    refused(await admin('PUT', '/memberships/discount', { playerId: player.id, kind: 'SPECIAL', percent: 150, reason: 'Test E2E' }), 400);
    refused(await admin('PUT', '/memberships/discount', { playerId: player.id, kind: 'SPECIAL', amount: 5000, reason: 'Test E2E' }), 400);
    refused(await admin('PUT', '/memberships/discount', { playerId: player.id, kind: 'SPECIAL', reason: 'Test E2E' }), 400);
  });

  test('fratrie 20 % : montant dû recalculé et échéancier refait', async () => {
    const r = ok(await admin('PUT', '/memberships/discount', { playerId: player.id, kind: 'SIBLING', percent: 20, reason: 'Test E2E : 2e enfant' }));
    assert.equal(r.base, 1000);
    assert.equal(r.total, 800);
    const rows = await installmentsOf(admin, player.id);
    assert.equal(sum(rows, 'amount'), 800);
    first = rows[0];
  });

  test('réduction en montant', async () => {
    const r = ok(await admin('PUT', '/memberships/discount', { playerId: player.id, kind: 'SPECIAL', amount: 250, reason: 'Test E2E : accord du bureau' }));
    assert.equal(r.total, 750);
    first = (await installmentsOf(admin, player.id))[0];
  });

  test('jamais sous le déjà payé (R7)', async () => {
    ok(await admin('POST', `/installments/${first.id}/payments`, { amount: first.remaining, method: 'CASH', note: 'Test E2E' }));
    ok(await admin('POST', `/installments/${(await installmentsOf(admin, player.id))[1].id}/payments`, { amount: 100, method: 'CASH', note: 'Test E2E' }));
    const paid = sum(await installmentsOf(admin, player.id), 'paid');
    assert.ok(paid > 0);
    refused(await admin('PUT', '/memberships/discount', { playerId: player.id, kind: 'EXEMPT', reason: 'Test E2E' }), 409, /R7/);
    const info = ok(await admin('GET', `/memberships/player/${player.id}`));
    assert.equal(info.membership.total, 750, 'montant inchangé après le refus');
  });

  test('retirer la réduction : retour au tarif, payé conservé', async () => {
    const before = sum(await installmentsOf(admin, player.id), 'paid');
    const r = ok(await admin('PUT', '/memberships/discount', { playerId: player.id, kind: null }));
    assert.equal(r.total, 1000);
    const rows = await installmentsOf(admin, player.id);
    assert.equal(sum(rows, 'amount'), 1000);
    assert.equal(sum(rows, 'paid'), before);
    const info = ok(await admin('GET', `/memberships/player/${player.id}`));
    assert.equal(info.membership.discountKind, null);
  });

  test('exonération totale d’un joueur sans paiement', async () => {
    const { player: p2 } = await newPlayer(admin, { plan: 'FULL' });
    const r = ok(await admin('PUT', '/memberships/discount', { playerId: p2.id, kind: 'EXEMPT', reason: 'Test E2E : exonéré' }));
    assert.equal(r.total, 0);
    const rows = await installmentsOf(admin, p2.id);
    assert.equal(sum(rows, 'remaining'), 0);
  });
});

describe('Joueurs inscrits sans cotisation', () => {
  let admin;
  before(async () => {
    admin = await as('admin');
  });

  test('le nombre est lisible, et « créer les cotisations manquantes » les crée toutes', async () => {
    const r = ok(await admin('GET', '/memberships/missing'));
    assert.equal(typeof r.count, 'number');
    const created = ok(await admin('POST', '/memberships/missing', { paymentPlan: 'FULL' }));
    assert.ok(Array.isArray(created.withoutFee));
    const after = ok(await admin('GET', '/memberships/missing'));
    assert.equal(after.count, created.withoutFee.length, 'il ne reste que les joueurs sans tarif');
  });
});
