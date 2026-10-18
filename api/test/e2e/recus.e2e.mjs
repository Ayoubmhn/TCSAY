// Test de bout en bout : reçus du carnet (n° unique jamais réutilisé, annulation avec motif, impression, réglage).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused } from './helpers.mjs';
import { freeReceiptNumber, installmentsOf, newPlayer } from './helpers-paiements.mjs';

describe('Reçus (R7 : numéro jamais réutilisé)', () => {
  let admin, coach, parent, paymentA, paymentB, receipt, layout;

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    parent = await as('parent');
    const { player } = await newPlayer(admin, { plan: 'SEMESTER' });
    const [t1, t2] = await installmentsOf(admin, player.id);
    paymentA = ok(await admin('POST', `/installments/${t1.id}/payments`, { amount: 120, method: 'CASH', note: 'Test E2E' })).paymentId;
    paymentB = ok(await admin('POST', `/installments/${t2.id}/payments`, { amount: 80, method: 'CASH', note: 'Test E2E' })).paymentId;
    layout = ok(await admin('GET', '/receipts/layout'));
  });

  after(async () => {
    await admin('PUT', '/receipts/layout', { layout });
  });

  test('valeurs proposées pour le reçu (payeur, montant en lettres en arabe, tranche)', async () => {
    const r = ok(await admin('GET', `/payments/${paymentA}/receipt`));
    assert.ok(r.draft.payerName.length > 2);
    assert.match(r.draft.amountWords, /[؀-ۿ]/, 'montant en lettres arabes');
    assert.equal(r.history.length, 0);
  });

  test('émission du reçu avec le n° du carnet', async () => {
    const { draft } = ok(await admin('GET', `/payments/${paymentA}/receipt`));
    const number = freeReceiptNumber();
    receipt = ok(await admin('POST', `/payments/${paymentA}/receipts`, { ...draft, seasonLabel: undefined, number }));
    assert.equal(receipt.number, number);
    assert.equal(receipt.amount, 120);
    const list = ok(await admin('GET', `/receipts?q=${number}`));
    assert.ok(JSON.stringify(list).includes(receipt.id), 'retrouvé dans l’historique par son n°');
  });

  test('un 2e reçu pour le même paiement est refusé (R7)', async () => {
    const { draft } = ok(await admin('GET', `/payments/${paymentA}/receipt`));
    refused(await admin('POST', `/payments/${paymentA}/receipts`, { ...draft, seasonLabel: undefined, number: freeReceiptNumber() }), 409, /R7/);
  });

  test('un n° déjà utilisé est refusé pour un autre paiement (R7)', async () => {
    const { draft } = ok(await admin('GET', `/payments/${paymentB}/receipt`));
    refused(await admin('POST', `/payments/${paymentB}/receipts`, { ...draft, seasonLabel: undefined, number: receipt.number }), 409, /R7/);
  });

  test('n° invalide refusé', async () => {
    const { draft } = ok(await admin('GET', `/payments/${paymentB}/receipt`));
    refused(await admin('POST', `/payments/${paymentB}/receipts`, { ...draft, seasonLabel: undefined, number: 0 }), 400);
    refused(await admin('POST', `/payments/${paymentB}/receipts`, { ...draft, seasonLabel: undefined, number: 'abc' }), 400);
  });

  test('impression comptée (carnet puis réimpression)', async () => {
    ok(await admin('POST', `/receipts/${receipt.id}/printed`, { kind: 'CARNET' }));
    const r = ok(await admin('POST', `/receipts/${receipt.id}/printed`, { kind: 'PDF' }));
    assert.equal(r.printCount, 2);
  });

  test('annulation : motif obligatoire', async () => {
    refused(await admin('POST', `/receipts/${receipt.id}/void`, {}), 400);
    refused(await admin('POST', `/receipts/${receipt.id}/void`, { reason: 'x' }), 400);
  });

  test('annulation avec motif ; un reçu annulé ne s’imprime plus et ne s’annule pas deux fois', async () => {
    const r = ok(await admin('POST', `/receipts/${receipt.id}/void`, { reason: 'Test E2E : reçu raté' }));
    assert.ok(r.voidedAt);
    refused(await admin('POST', `/receipts/${receipt.id}/printed`, { kind: 'CARNET' }), 409, /R7/);
    refused(await admin('POST', `/receipts/${receipt.id}/void`, { reason: 'Test E2E encore' }), 409, /R7/);
  });

  test('le n° d’un reçu annulé ne se réutilise jamais (R7)', async () => {
    const { draft } = ok(await admin('GET', `/payments/${paymentB}/receipt`));
    refused(await admin('POST', `/payments/${paymentB}/receipts`, { ...draft, seasonLabel: undefined, number: receipt.number }), 409, /annulé/);
  });

  test('après annulation, un nouveau reçu (nouveau n°) peut être émis pour le paiement', async () => {
    const { draft, history } = ok(await admin('GET', `/payments/${paymentA}/receipt`));
    assert.equal(history.length, 1, 'le reçu annulé reste dans l’historique');
    const r = ok(await admin('POST', `/payments/${paymentA}/receipts`, { ...draft, seasonLabel: undefined, number: freeReceiptNumber() }));
    assert.equal(r.voidedAt ?? null, null);
  });

  test('le paiement reste intact : jamais modifié ni supprimé (R7)', async () => {
    refused(await admin('PATCH', `/payments/${paymentA}`, { amount: 1 }), 409, /R7/);
    refused(await admin('DELETE', `/payments/${paymentA}`), 409, /R7/);
  });

  test('n° suivant proposé', async () => {
    const r = ok(await admin('GET', '/receipts/next-number'));
    assert.ok(r && typeof r === 'object');
  });

  test('réglage d’impression : enregistré puis remis aux mesures du carnet', async () => {
    const def = ok(await admin('GET', '/receipts/layout/default'));
    const saved = ok(await admin('PUT', '/receipts/layout', { layout: { ...def, offsetX: 2, offsetY: -1 } }));
    assert.equal(saved.offsetX, 2);
    assert.equal(saved.offsetY, -1);
    assert.equal(ok(await admin('GET', '/receipts/layout')).offsetX, 2);
    ok(await admin('PUT', '/receipts/layout', { layout: def }));
    assert.equal(ok(await admin('GET', '/receipts/layout')).offsetX, def.offsetX);
  });

  test('l’entraîneur et le parent n’ont pas accès aux reçus (403)', async () => {
    refused(await coach('GET', '/receipts'), 403);
    refused(await parent('GET', '/receipts'), 403);
    refused(await coach('GET', `/payments/${paymentA}/receipt`), 403);
  });
});
