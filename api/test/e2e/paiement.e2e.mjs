// Test de bout en bout (API) : encaissement d'une tranche, vu par l'admin, le parent et refusé au coach.
// Aucune bibliothèque : module de test intégré à Node (node:test).
//
// À lancer UNIQUEMENT sur une base de DÉMONSTRATION (jamais sur la base réelle du club) :
//   1. cd api && npm run db:demo          (base de démo : vide puis recharge)
//   2. npm run start:dev                   (API sur http://localhost:3000)
//   3. npm run test:e2e                    (dans un autre terminal)
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { as, login, ok, refused } from './helpers.mjs';
import { installmentsOf, newPlayer } from './helpers-paiements.mjs';

// 1 DT par passage : le test se relance sans épuiser la tranche de Lina.
const MONTANT = 1;

describe('Paiement d’une tranche (R7, coach 403)', () => {
  let admin, parent, coach, tranche;

  before(async () => {
    admin = await login('admin@tcsay.tn', 'admin1234', 'admin');
    parent = await login('sana.benali@exemple.tn', 'temporaire', 'parent');
    coach = await login('iheb@exemple.tn', 'temporaire', 'coach');
  });

  test('l’admin trouve une tranche restant à payer pour Lina Ben Ali', async () => {
    const r = await admin('GET', '/installments?q=Lina');
    assert.equal(r.status, 200);
    tranche = r.data.find((i) => i.remaining >= MONTANT);
    assert.ok(tranche, 'aucune tranche à payer pour Lina (relancer npm run db:demo)');
  });

  test('un montant supérieur au restant est refusé', async () => {
    const r = await admin('POST', `/installments/${tranche.id}/payments`, { amount: tranche.remaining + 1, method: 'CASH' });
    assert.equal(r.status, 400);
  });

  test('l’admin encaisse 1 DT en espèces', async () => {
    const r = await admin('POST', `/installments/${tranche.id}/payments`, { amount: MONTANT, method: 'CASH', note: 'Test E2E' });
    assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.data));
    const after = (await admin('GET', '/installments?q=Lina')).data.find((i) => i.id === tranche.id);
    assert.equal(after.paid, tranche.paid + MONTANT);
    assert.equal(after.remaining, Math.round((tranche.remaining - MONTANT) * 1000) / 1000);
  });

  test('le parent voit le nouveau montant payé', async () => {
    const r = await parent('GET', `/installments?playerId=${tranche.player.id}`); // parent : un enfant à la fois
    assert.equal(r.status, 200);
    const mine = r.data.find((i) => i.id === tranche.id);
    assert.ok(mine, 'la tranche de Lina doit être visible par sa mère');
    assert.equal(mine.paid, tranche.paid + MONTANT);
  });

  test('le coach ne voit jamais les cotisations (403)', async () => {
    const r = await coach('GET', '/installments');
    assert.equal(r.status, 403);
  });

  test('un paiement encaissé ne se supprime pas sans motif (R7)', async () => {
    const pays = await admin('GET', '/payments');
    const last = pays.data.find((p) => p.note === 'Test E2E') ?? pays.data[0];
    const r = await admin('DELETE', `/payments/${last.id}`);
    assert.ok(r.status >= 400, `suppression sans motif acceptée (statut ${r.status})`);
  });

  test('un autre parent ne voit pas les tranches de Lina', async () => {
    const other = await as('parent2');
    const r = await other('GET', `/installments?playerId=${tranche.player.id}`);
    assert.ok(r.status === 403 || r.status === 404, `tranches d’un autre enfant visibles (statut ${r.status})`);
  });
});

describe('Retards de paiement', () => {
  let admin, player, first;

  before(async () => {
    admin = await as('admin');
    ({ player } = await newPlayer(admin, { plan: 'SEMESTER' }));
    [first] = await installmentsOf(admin, player.id);
  });

  test('une tranche dont l’échéance est dépassée est « En retard », la suivante « À payer »', async () => {
    const cfg = ok(await admin('GET', '/payments/config'));
    const past = new Date(Date.now() - (cfg.reminders.graceDays + 10) * 86_400_000).toISOString().slice(0, 10);
    ok(await admin('PATCH', `/installments/${first.id}/due-date`, { dueDate: past, reason: 'Test E2E : retard' }));
    const [a, b] = await installmentsOf(admin, player.id);
    assert.equal(a.status, 'LATE');
    assert.equal(b.status, 'DUE');
  });

  test('paiement partiel d’une tranche en retard : reste « En retard » ; soldée : « Payée »', async () => {
    ok(await admin('POST', `/installments/${first.id}/payments`, { amount: 100, method: 'CASH', note: 'Test E2E' }));
    let [a] = await installmentsOf(admin, player.id);
    assert.equal(a.status, 'LATE');
    assert.equal(a.paid, 100);
    ok(await admin('POST', `/installments/${first.id}/payments`, { amount: a.remaining, method: 'CASH', note: 'Test E2E' }));
    [a] = await installmentsOf(admin, player.id);
    assert.equal(a.status, 'PAID');
    assert.equal(a.remaining, 0);
  });

  test('un paiement sur une tranche soldée est refusé', async () => {
    refused(await admin('POST', `/installments/${first.id}/payments`, { amount: 1, method: 'CASH' }), 400);
  });

  test('rappel par email au joueur majeur', async () => {
    const [, b] = await installmentsOf(admin, player.id);
    ok(await admin('POST', `/installments/${b.id}/remind`));
  });

  test('tranche inconnue : 404', async () => {
    refused(await admin('POST', '/installments/00000000-0000-4000-8000-000000000000/payments', { amount: 1, method: 'CASH' }), 404);
  });
});
