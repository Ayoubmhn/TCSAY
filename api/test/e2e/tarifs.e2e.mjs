// Test de bout en bout : tarifs d'entraînement (tarif commun à la paire, R1, R6, R13, droits).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused } from './helpers.mjs';

describe('Tarifs d’entraînement (paire, R1, R6, R13)', () => {
  let admin, coach, parent, seasons, lutins, lutines, closedFee;
  const restore = [];

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    parent = await as('parent');
    seasons = ok(await admin('GET', '/seasons'));
    const fees = ok(await admin('GET', '/fees'));
    lutins = fees.find((f) => f.category.pairCode === 'J6' && f.category.gender === 'M' && !f.group);
    lutines = fees.find((f) => f.category.pairCode === 'J6' && f.category.gender === 'F' && !f.group);
    assert.ok(lutins && lutines, 'tarifs Lutins / Lutines (-6) attendus dans la démo');
  });

  // Remet les montants d'origine (la base reste utilisable par les autres tests).
  after(async () => {
    for (const { id, amount, depositAmount, seasonId, reason } of restore) {
      const cur = ok(await admin('GET', `/fees?seasonId=${seasonId}`)).find((f) => f.id === id);
      await admin('PATCH', `/fees/${id}`, { version: cur.version, amount, depositAmount, pair: true, reason });
    }
  });

  test('la liste des tarifs de la saison active est lisible', async () => {
    const fees = ok(await admin('GET', '/fees'));
    assert.ok(fees.length >= 29, 'un tarif par catégorie');
    assert.ok(fees.every((f) => f.season.status === 'ACTIVE'));
  });

  test('tarif d’une catégorie pour le formulaire joueur', async () => {
    const r = ok(await admin('GET', `/fees/for-category?categoryId=${lutins.categoryId}`));
    assert.equal(r.amount, lutins.amount);
  });

  test('modifier Lutins applique le même montant à Lutines (tarif commun)', async () => {
    restore.push({ id: lutins.id, amount: lutins.amount, depositAmount: lutins.depositAmount, seasonId: lutins.seasonId });
    const amount = lutins.amount + 7;
    ok(await admin('PATCH', `/fees/${lutins.id}`, { version: lutins.version, amount, depositAmount: 0 }));
    const fees = ok(await admin('GET', '/fees'));
    assert.equal(fees.find((f) => f.id === lutins.id).amount, amount);
    assert.equal(fees.find((f) => f.id === lutines.id).amount, amount, 'la catégorie fille de la paire suit');
  });

  test('« pair: false » ne modifie qu’une catégorie', async () => {
    const fees = ok(await admin('GET', '/fees'));
    const cur = fees.find((f) => f.id === lutins.id);
    const sister = fees.find((f) => f.id === lutines.id);
    ok(await admin('PATCH', `/fees/${lutins.id}`, { version: cur.version, amount: cur.amount + 1, depositAmount: 0, pair: false }));
    const after2 = ok(await admin('GET', '/fees'));
    assert.equal(after2.find((f) => f.id === lutins.id).amount, cur.amount + 1);
    assert.equal(after2.find((f) => f.id === lutines.id).amount, sister.amount, 'Lutines inchangée');
  });

  test('l’acompte ne dépasse jamais le montant', async () => {
    const cur = ok(await admin('GET', '/fees')).find((f) => f.id === lutins.id);
    const r = ok(await admin('PATCH', `/fees/${lutins.id}`, { version: cur.version, amount: cur.amount, depositAmount: cur.amount + 500, pair: false }));
    assert.equal(r.depositAmount, r.amount);
  });

  test('R13 : une version périmée est refusée', async () => {
    const cur = ok(await admin('GET', '/fees')).find((f) => f.id === lutins.id);
    refused(await admin('PATCH', `/fees/${lutins.id}`, { version: cur.version - 1, amount: 900, depositAmount: 0 }), undefined, /R13/);
  });

  test('montant négatif refusé', async () => {
    const cur = ok(await admin('GET', '/fees')).find((f) => f.id === lutins.id);
    refused(await admin('PATCH', `/fees/${lutins.id}`, { version: cur.version, amount: -5, depositAmount: 0 }), 400);
  });

  test('un tarif en double (même catégorie, une seule) est refusé', async () => {
    refused(await admin('POST', '/fees', { categoryId: lutins.categoryId, amount: 500, depositAmount: 0, pair: false }), 409);
  });

  test('R1 : créer un tarif sur une saison clôturée est refusé', async () => {
    const closed = seasons.find((s) => s.status === 'CLOSED');
    assert.ok(closed, 'une saison clôturée est attendue dans la démo');
    refused(await admin('POST', '/fees', { seasonId: closed.id, categoryId: lutins.categoryId, amount: 500, depositAmount: 0 }), 409, /R1/);
  });

  test('R6 : saison clôturée, modification sans motif refusée, avec motif acceptée', async () => {
    const closed = seasons.find((s) => s.status === 'CLOSED');
    closedFee = ok(await admin('GET', `/fees?seasonId=${closed.id}`))[0];
    assert.ok(closedFee, 'un tarif sur la saison clôturée est attendu dans la démo');
    refused(await admin('PATCH', `/fees/${closedFee.id}`, { version: closedFee.version, amount: closedFee.amount + 1, depositAmount: 0 }), 400, /R6/);
    restore.push({ id: closedFee.id, amount: closedFee.amount, depositAmount: closedFee.depositAmount, seasonId: closed.id, reason: 'Test E2E : retour à la valeur' });
    const r = ok(await admin('PATCH', `/fees/${closedFee.id}`, { version: closedFee.version, amount: closedFee.amount + 1, depositAmount: 0, reason: 'Test E2E : correction' }));
    assert.equal(r.amount, closedFee.amount + 1);
  });

  test('l’entraîneur et le parent ne peuvent pas modifier un tarif (403)', async () => {
    refused(await coach('POST', '/fees', { categoryId: lutins.categoryId, amount: 1, depositAmount: 0 }), 403);
    refused(await parent('PATCH', `/fees/${lutins.id}`, { version: 1, amount: 1, depositAmount: 0 }), 403);
  });
});
