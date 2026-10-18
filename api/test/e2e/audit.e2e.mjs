// Test de bout en bout : journal d'audit (lecture seule, qui / quand / avant / après / motif, par mois) et emails
// envoyés (liste, configuration sans secret, email de test, renvoi d'un email en échec seulement).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

const today = new Date().toISOString().slice(0, 10);

describe('Journal d’audit (lecture seule)', () => {
  let admin, agent, superviseur, parent, expense;

  before(async () => {
    admin = await as('admin');
    agent = await as('agent');
    superviseur = await as('superviseur');
    parent = await as('parent');
  });

  test('une action sensible crée une entrée : qui, rôle, avant, après, motif', async () => {
    expense = ok(await admin('POST', '/expenses', { category: 'OTHER', label: `Audit test ${uid()}`, amount: 12, date: today }));
    ok(await admin('PATCH', `/expenses/${expense.id}`, { category: 'OTHER', label: expense.label, amount: 15, date: today, version: expense.version }));
    ok(await admin('POST', `/expenses/${expense.id}/archive`, { reason: 'Contrôle du journal' }));
    const rows = ok(await admin('GET', '/audit')).filter((a) => a.entityId === expense.id);
    assert.equal(rows.length, 3);
    const edit = rows.find((a) => a.action === 'Dépense modifiée');
    assert.match(edit.before, /12/);
    assert.match(edit.after, /15/);
    const arch = rows.find((a) => a.action === 'Dépense archivée');
    assert.equal(arch.reason, 'Contrôle du journal');
    assert.equal(arch.role, 'PRESIDENT');
    assert.ok(arch.who && arch.who !== 'Système');
    assert.ok(new Date(rows[0].createdAt) >= new Date(rows[2].createdAt), 'du plus récent au plus ancien');
  });

  test('consultation par mois ; mois invalide refusé', async () => {
    const prev = new Date();
    prev.setMonth(prev.getMonth() - 1);
    const month = prev.toISOString().slice(0, 7);
    const r = ok(await admin('GET', `/audit?month=${month}`));
    assert.ok(Array.isArray(r));
    assert.ok(r.every((a) => a.entityId !== expense.id), 'l’entrée du jour n’est pas dans le mois précédent');
    refused(await admin('GET', '/audit?month=2026-13'), 400);
  });

  test('aucune route pour modifier ou supprimer le journal', async () => {
    for (const [m, p] of [
      ['POST', '/audit'],
      ['PATCH', '/audit'],
      ['DELETE', '/audit'],
    ]) {
      const r = await admin(m, p, m === 'DELETE' ? undefined : { action: 'Falsifié' });
      assert.ok(r.status === 404 || r.status === 405, `${m} ${p} : statut ${r.status}`);
    }
  });

  test('droits : réservé à l’autorisation « audit.view » (agent, superviseur, parent refusés)', async () => {
    refused(await agent('GET', '/audit'), 403);
    refused(await superviseur('GET', '/audit'), 403);
    refused(await parent('GET', '/audit'), 403);
  });
});

describe('Emails envoyés', () => {
  let admin, agent, coach, to;

  before(async () => {
    admin = await as('admin');
    agent = await as('agent');
    coach = await as('coach');
    to = `test.${uid()}@exemple.tn`;
  });

  test('configuration : serveur affiché, jamais de mot de passe', async () => {
    const c = ok(await agent('GET', '/emails/config'));
    assert.ok(['smtp', 'gmail-api', 'brevo'].includes(c.transport));
    assert.equal(typeof c.passwordSet, 'boolean');
    const text = JSON.stringify(c);
    assert.ok(!/"pass"|"password"\s*:|refresh|apiKey/i.test(text), 'aucun secret dans la réponse');
    for (const k of ['pending', 'sent', 'failed']) assert.equal(typeof c[k], 'number');
  });

  test('email de test : adresse invalide refusée', async () => {
    refused(await agent('POST', '/emails/test', { to: 'pas-une-adresse' }), 400);
  });

  test('email de test : envoyé, ou erreur du serveur expliquée ; toujours tracé', async () => {
    const r = await agent('POST', '/emails/test', { to });
    if (r.status !== 200) refused(r, 400, /Email non envoyé/);
    const rows = ok(await agent('GET', '/emails'));
    const row = rows.find((e) => e.to === to);
    assert.ok(row, 'l’email de test apparaît dans la liste');
    assert.equal(row.status, r.status === 200 ? 'SENT' : 'FAILED');
    if (row.status === 'FAILED') {
      assert.ok(row.error, 'la raison de l’échec est gardée');
      const failed = ok(await agent('GET', '/emails?status=FAILED'));
      assert.ok(failed.every((e) => e.status === 'FAILED'));
      assert.deepEqual(ok(await agent('POST', `/emails/${row.id}/resend`)), { queued: 1 });
    } else {
      refused(await agent('POST', `/emails/${row.id}/resend`), 409);
    }
  });

  test('filtre invalide refusé ; email inconnu introuvable', async () => {
    refused(await agent('GET', '/emails?status=PERDU'), 400);
    refused(await agent('POST', '/emails/00000000-0000-0000-0000-000000000000/resend'), 404);
  });

  test('droits : le coach ne voit pas les emails (403)', async () => {
    refused(await coach('GET', '/emails'), 403);
    ok(await admin('GET', '/emails'));
  });
});
