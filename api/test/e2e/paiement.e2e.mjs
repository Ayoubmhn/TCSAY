// Test de bout en bout (API) : encaissement d'une tranche, vu par l'admin, le parent et refusé au coach.
// Aucune bibliothèque : module de test intégré à Node (node:test).
//
// À lancer UNIQUEMENT sur une base de DÉMONSTRATION (jamais sur la base réelle du club) :
//   1. cd api && npm run db:demo          (base de démo : vide puis recharge)
//   2. npm run start:dev                   (API sur http://localhost:3000)
//   3. npm run test:e2e                    (dans un autre terminal)
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { login } from './helpers.mjs';

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
    tranche = r.data.find((i) => i.remaining > 0);
    assert.ok(tranche, 'aucune tranche à payer pour Lina (relancer npm run db:demo)');
  });

  test('un montant supérieur au restant est refusé', async () => {
    const r = await admin('POST', `/installments/${tranche.id}/payments`, { amount: tranche.remaining + 1, method: 'CASH' });
    assert.equal(r.status, 400);
  });

  test('l’admin encaisse 50 DT en espèces', async () => {
    const r = await admin('POST', `/installments/${tranche.id}/payments`, { amount: 50, method: 'CASH', note: 'Test E2E' });
    assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.data));
    const after = (await admin('GET', '/installments?q=Lina')).data.find((i) => i.id === tranche.id);
    assert.equal(after.paid, tranche.paid + 50);
    assert.equal(after.remaining, tranche.remaining - 50);
  });

  test('le parent voit le nouveau montant payé', async () => {
    const r = await parent('GET', `/installments?playerId=${tranche.player.id}`); // parent : un enfant à la fois
    assert.equal(r.status, 200);
    const mine = r.data.find((i) => i.id === tranche.id);
    assert.ok(mine, 'la tranche de Lina doit être visible par sa mère');
    assert.equal(mine.paid, tranche.paid + 50);
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
});
