// Test de bout en bout : accès après paiement (modules fermés à la famille tant qu'une tranche échue n'est pas payée,
// exception par joueur, paiements toujours ouverts). Réglage d'origine remis à la fin.
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused } from './helpers.mjs';
import { installmentsOf, newPlayer } from './helpers-paiements.mjs';

describe('Accès après paiement', () => {
  let admin, agent, coach, parent, child, tranche, original;
  const config = (enabled) => ({ enabled, graceDays: 0, modules: { sessions: true, progress: true, exercises: true, reservation: false } });

  before(async () => {
    admin = await as('admin');
    agent = await as('agent');
    coach = await as('coach');
    original = ok(await admin('GET', '/access/payment/config'));
    // Enfant de test : sa tranche unique passe en retard (échéance dépassée, motif).
    const created = await newPlayer(admin, { minor: true, plan: 'FULL', gender: 'F' });
    child = created.player;
    parent = await created.parent();
    [tranche] = await installmentsOf(admin, child.id);
    ok(await admin('PATCH', `/installments/${tranche.id}/due-date`, { dueDate: '2026-09-01', reason: 'Test E2E : tranche en retard' }));
  });

  after(async () => {
    const { labels, ...cfg } = original;
    void labels;
    ok(await admin('PUT', '/access/payment/config', cfg), 'réglage d’origine remis');
  });

  test('seul le président règle l’accès (403 pour l’agent, lecture permise)', async () => {
    ok(await agent('GET', '/access/payment/config'));
    refused(await agent('PUT', '/access/payment/config', config(true)), 403);
    refused(await coach('GET', '/access/payment/config'), 403);
  });

  test('délai de grâce hors liste refusé', async () => {
    refused(await admin('PUT', '/access/payment/config', { ...config(true), graceDays: 5 }), 400);
  });

  test('désactivé : le parent ouvre le suivi même avec une tranche en retard', async () => {
    ok(await admin('PUT', '/access/payment/config', config(false)));
    const s = ok(await parent('GET', `/access/payment/status?playerId=${child.id}`));
    assert.equal(s.enabled, false);
    ok(await parent('GET', `/progress?playerId=${child.id}`));
  });

  test('activé : le suivi est fermé (403) en citant la tranche en cause', async () => {
    ok(await admin('PUT', '/access/payment/config', config(true)));
    const s = ok(await parent('GET', `/access/payment/status?playerId=${child.id}`));
    assert.equal(s.locked.progress, true);
    assert.equal(s.overdue.number, 1);
    const r = await parent('GET', `/progress?playerId=${child.id}`);
    refused(r, 403);
    assert.match(String(r.data.message), /tranche 1\/1/);
  });

  test('les paiements restent toujours visibles pour la famille', async () => {
    const rows = ok(await parent('GET', `/installments?playerId=${child.id}`));
    assert.equal(rows[0].id, tranche.id);
  });

  test('le joueur apparaît dans la liste « accès fermé » de l’administration', async () => {
    const r = ok(await admin('GET', '/access/payment/locked'));
    assert.ok(r.players.some((p) => p.id === child.id && p.installment === '1/1'));
  });

  test('exception avec motif : accès rouvert, puis retirée : refermé', async () => {
    ok(await admin('PUT', '/access/payment/exemption', { playerId: child.id, reason: 'Test E2E : accord du bureau' }));
    ok(await parent('GET', `/progress?playerId=${child.id}`));
    const s = ok(await parent('GET', `/access/payment/status?playerId=${child.id}`));
    assert.equal(s.exempt, 'Test E2E : accord du bureau');
    ok(await admin('PUT', '/access/payment/exemption', { playerId: child.id }));
    refused(await parent('GET', `/progress?playerId=${child.id}`), 403);
  });

  test('l’entraîneur ne peut pas accorder d’exception (403)', async () => {
    refused(await coach('PUT', '/access/payment/exemption', { playerId: child.id, reason: 'x' }), 403);
  });

  test('après le paiement au club, l’accès se rouvre tout seul', async () => {
    ok(await admin('POST', `/installments/${tranche.id}/payments`, { amount: tranche.remaining, method: 'CASH', note: 'Test E2E' }));
    ok(await parent('GET', `/progress?playerId=${child.id}`));
    const s = ok(await parent('GET', `/access/payment/status?playerId=${child.id}`));
    assert.equal(s.overdue, null);
  });

  test('un parent ne voit pas l’état d’un enfant qui n’est pas le sien', async () => {
    const other = await as('parent');
    const r = await other('GET', `/access/payment/status?playerId=${child.id}`);
    assert.ok(r.status === 403 || r.status === 404, `statut ${r.status}`);
  });
});
