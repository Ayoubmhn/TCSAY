// Test de bout en bout : dépenses (saisie, justificatif, paiement, archivage R8, version R13, audit, droits).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

const today = new Date().toISOString().slice(0, 10);

describe('Dépenses (R8, R13, justificatif, droits)', () => {
  let admin, agent, parent, coach, dep;
  const label = `Facture STEG test ${uid()}`;

  before(async () => {
    admin = await as('admin');
    agent = await as('agent');
    parent = await as('parent');
    coach = await as('coach');
  });

  test('les catégories de dépenses sont listées', async () => {
    const cats = ok(await admin('GET', '/expenses/categories'));
    assert.ok(cats.some((c) => c.value === 'UTILITIES'));
  });

  test('saisie refusée sans libellé ni montant positif', async () => {
    refused(await agent('POST', '/expenses', { category: 'UTILITIES', label: '', amount: 10, date: today }), 400);
    refused(await agent('POST', '/expenses', { category: 'UTILITIES', label, amount: 0, date: today }), 400);
  });

  test('un paiement daté dans le futur est refusé', async () => {
    refused(await agent('POST', '/expenses', { category: 'UTILITIES', label, amount: 10, date: today, paidAt: '2999-01-01' }), 400);
  });

  test('l’agent saisit une facture à payer (en retard)', async () => {
    dep = ok(await agent('POST', '/expenses', { category: 'UTILITIES', label, supplier: 'STEG', amount: 123.456, date: '2026-01-05', dueDate: '2026-01-20' }), 'saisie');
    assert.equal(dep.state, 'LATE');
    assert.equal(dep.amount, 123.456);
    const list = ok(await agent('GET', `/expenses?state=late&q=${encodeURIComponent(label)}`));
    assert.equal(list.rows.length, 1);
    assert.equal(list.totals.due, 123.456);
  });

  test('R13 : une version périmée est refusée', async () => {
    const r = await agent('PATCH', `/expenses/${dep.id}`, { category: 'UTILITIES', label, amount: 130, date: '2026-01-05', version: dep.version + 3 });
    refused(r, 409, /R13/);
  });

  test('modification avec la bonne version', async () => {
    dep = ok(await agent('PATCH', `/expenses/${dep.id}`, { category: 'UTILITIES', label, supplier: 'STEG', amount: 130, date: '2026-01-05', dueDate: '2026-01-20', version: dep.version }));
    assert.equal(dep.amount, 130);
  });

  test('justificatif : type refusé, PDF accepté puis relu', async () => {
    const bad = new FormData();
    bad.append('file', new Blob(['texte'], { type: 'text/plain' }), 'note.txt');
    refused(await agent('POST', `/expenses/${dep.id}/file`, bad), 400);
    const pdf = '%PDF-1.4\n% test e2e\n';
    const form = new FormData();
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'facture.pdf');
    dep = ok(await agent('POST', `/expenses/${dep.id}/file`, form), 'dépôt');
    assert.equal(dep.fileName, 'facture.pdf');
    const file = await agent('GET', `/expenses/${dep.id}/file`);
    assert.equal(file.status, 200);
    assert.match(String(file.data), /%PDF/);
  });

  test('paiement de la facture, puis double paiement refusé', async () => {
    dep = ok(await agent('POST', `/expenses/${dep.id}/pay`, { paidAt: today, method: 'TRANSFER' }));
    assert.equal(dep.state, 'PAID');
    assert.equal(dep.method, 'TRANSFER');
    refused(await agent('POST', `/expenses/${dep.id}/pay`, { paidAt: today, method: 'CASH' }), 400);
  });

  test('R8 : archivage sans motif refusé, avec motif accepté', async () => {
    refused(await agent('POST', `/expenses/${dep.id}/archive`, { reason: '' }), 400);
    dep = ok(await agent('POST', `/expenses/${dep.id}/archive`, { reason: 'Saisie en double (test)' }));
    assert.equal(dep.state, 'ARCHIVED');
    const active = ok(await agent('GET', `/expenses?q=${encodeURIComponent(label)}`));
    assert.equal(active.rows.length, 0, 'une dépense archivée sort de la liste active');
    const archived = ok(await agent('GET', `/expenses?state=archived&q=${encodeURIComponent(label)}`));
    assert.equal(archived.rows.length, 1);
  });

  test('une dépense archivée ne se modifie pas, mais se restaure', async () => {
    refused(await agent('PATCH', `/expenses/${dep.id}`, { category: 'UTILITIES', label, amount: 1, date: today, version: dep.version }), 400);
    dep = ok(await agent('POST', `/expenses/${dep.id}/restore`));
    assert.equal(dep.state, 'PAID');
  });

  test('chaque étape est dans le journal d’audit', async () => {
    const rows = ok(await admin('GET', '/audit')).filter((a) => a.entityId === dep.id);
    for (const action of ['Dépense saisie', 'Dépense modifiée', 'Justificatif ajouté', 'Dépense payée', 'Dépense archivée', 'Dépense restaurée']) {
      assert.ok(rows.some((a) => a.action === action), `audit manquant : ${action}`);
    }
    assert.equal(rows.find((a) => a.action === 'Dépense archivée').reason, 'Saisie en double (test)');
  });

  test('parent et coach n’ont pas accès aux dépenses (403)', async () => {
    refused(await parent('GET', '/expenses'), 403);
    refused(await coach('GET', '/expenses'), 403);
  });
});
