// Test de bout en bout : mises à jour par fichier — affectation aux groupes (Excel, nom corrigé d'après la liste,
// groupe exact seulement) et paiements du cahier (tableau corrigé à l'écran : réduction, paiement, reçu, n° déjà
// enregistré refusé). Le joueur est créé par le test (aucune donnée de la démo n'est modifiée).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { fileForm, xlsx } from './helpers-fichiers.mjs';
import { as, ok, refused, uid } from './helpers.mjs';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('Mises à jour par fichier (groupes, paiements du cahier)', () => {
  let admin, coach, parent, player, group, receipt;
  const tag = uid().replace(/\d/g, '').padEnd(5, 'q').slice(0, 5);
  const first = `Maj${tag}`;
  const last = 'Testmajeur';

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    parent = await as('parent');
    player = ok(
      await admin('POST', '/players', {
        firstName: first,
        lastName: last,
        birthDate: '1991-04-04',
        gender: 'M',
        email: `maj.${uid()}@exemple.tn`,
        phone: '20000003',
        cin: String(10000000 + Math.floor(Math.random() * 89999999)),
        paymentPlan: 'FULL',
      }),
      'création du joueur',
    );
    const groups = ok(await admin('GET', '/groups'));
    group = groups.find((g) => g.members.length < g.capacity - 1);
    assert.ok(group, 'un groupe avec des places est attendu dans la démo');
    receipt = 8_000_000 + Math.floor(Math.random() * 999_999);
  });

  after(async () => {
    if (group && player) await admin('DELETE', `/groups/${group.id}/members/${player.id}`);
    if (player) await admin('POST', `/players/${player.id}/archive`);
  });

  test('fichier non Excel refusé ; colonne « Groupe » obligatoire', async () => {
    refused(await admin('POST', '/imports/groups/preview', fileForm(Buffer.from('x'), 'groupes.csv', 'text/csv')), 400);
    refused(await admin('POST', '/imports/groups/preview', fileForm(xlsx([['Joueur'], [`${first} ${last}`]]), 'groupes.xlsx', XLSX)), 400);
  });

  test('aperçu des groupes : nom à corriger, groupe inconnu en erreur', async () => {
    const file = xlsx([
      ['Groupe', 'Joueur'],
      [group.name, `${first} ${last}e`],
      ['Groupe qui n’existe pas', `${first} ${last}`],
    ]);
    const r = ok(await admin('POST', '/imports/groups/preview', fileForm(file, 'groupes.xlsx', XLSX)));
    assert.equal(r.total, 2);
    assert.equal(r.rows[0].player?.id, player.id, 'joueur reconnu malgré la faute');
    assert.equal(r.rows[0].correction?.to, `${first} ${last}e`);
    assert.equal(r.rows[0].action, 'add');
    assert.equal(r.rows[1].status, 'error');
    assert.match(r.rows[1].messages.join(' '), /introuvable/);
  });

  test('confirmation : joueur ajouté au groupe et nom corrigé (la ligne en erreur est ignorée)', async () => {
    const file = xlsx([
      ['Groupe', 'Joueur'],
      [group.name, `${first} ${last}e`],
      ['Groupe qui n’existe pas', `${first} ${last}`],
    ]);
    const r = ok(await admin('POST', '/imports/groups/commit', fileForm(file, 'groupes.xlsx', XLSX, { correctNames: 'true' })));
    assert.equal(r.moved, 1);
    assert.equal(r.renamed, 1);
    assert.equal(r.skipped.length, 1);
    const p = ok(await admin('GET', `/players/${player.id}`));
    assert.equal(p.lastName, `${last}e`);
    const g = ok(await admin('GET', '/groups')).find((x) => x.id === group.id);
    assert.equal(g.members.length, group.members.length + 1);
  });

  test('relancer le même fichier ne change rien (déjà dans ce groupe)', async () => {
    const file = xlsx([
      ['Groupe', 'Joueur'],
      [group.name, `${first} ${last}e`],
    ]);
    const r = ok(await admin('POST', '/imports/groups/preview', fileForm(file, 'groupes.xlsx', XLSX)));
    assert.equal(r.rows[0].action, 'none');
    assert.match(r.rows[0].messages.join(' '), /déjà dans ce groupe/);
  });

  const row = (over = {}) => ({ name: `${first} ${last}e`, nameAr: '', amount: '900', paid: '300', method: 'chèque', receipt: String(receipt), date: '2026-10-01', ...over });

  test('paiements du cahier : aperçu (réduction signalée, somme trop élevée et inconnu en erreur)', async () => {
    const r = ok(
      await admin('POST', '/imports/payments/preview-table', {
        fileName: 'cahier-test.xlsx',
        rows: [row(), row({ name: `Inconnu${tag} Personne`, receipt: '' }), row({ name: `${first} ${last}e`, paid: '5000', receipt: String(receipt + 1) })],
      }),
    );
    assert.equal(r.rows[0].player?.id, player.id);
    assert.equal(r.rows[0].status, 'warning');
    assert.match(r.rows[0].messages.join(' '), /réduction/);
    assert.equal(r.rows[0].method, 'CHEQUE');
    assert.equal(r.rows[1].status, 'error');
    assert.equal(r.rows[2].status, 'error');
    assert.equal(r.amount, 300);
  });

  test('confirmation : réduction, paiement par chèque et reçu du carnet enregistrés', async () => {
    const r = ok(await admin('POST', '/imports/payments/commit-table', { fileName: 'cahier-test.xlsx', rows: [row()] }));
    assert.equal(r.imported.length, 1);
    assert.equal(r.total, 300);
    assert.equal(r.failed.length, 0);
    const inst = ok(await admin('GET', `/installments?playerId=${player.id}`));
    const paid = inst.reduce((t, i) => t + i.paid, 0);
    const total = inst.reduce((t, i) => t + i.amount, 0);
    assert.equal(paid, 300);
    assert.equal(total, 900, 'montant dû ramené à 900 (réduction)');
  });

  test('le même n° de reçu n’est jamais importé deux fois', async () => {
    const r = ok(await admin('POST', '/imports/payments/preview-table', { fileName: 'cahier-test.xlsx', rows: [row()] }));
    assert.equal(r.rows[0].status, 'error');
    assert.match(r.rows[0].messages.join(' '), /déjà enregistré/);
    refused(await admin('POST', '/imports/payments/commit-table', { fileName: 'cahier-test.xlsx', rows: [row()] }), 400);
  });

  test('l’import est tracé dans l’audit', async () => {
    const rows = ok(await admin('GET', '/audit'));
    assert.ok(rows.some((a) => a.action === 'Paiement importé (cahier)' && a.reason === 'cahier-test.xlsx' && a.target.includes(String(receipt))));
    assert.ok(rows.some((a) => a.action === 'Nom corrigé (liste)' && a.entityId === player.id));
  });

  test('droits : coach et parent refusés (403)', async () => {
    refused(await coach('POST', '/imports/payments/preview-table', { fileName: 'x.xlsx', rows: [] }), 403);
    refused(await parent('POST', '/imports/payments/preview-table', { fileName: 'x.xlsx', rows: [] }), 403);
  });
});
