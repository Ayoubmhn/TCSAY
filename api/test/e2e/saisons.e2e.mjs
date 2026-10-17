// Test de bout en bout : règles des saisons (R2 une seule saison active, R13 contrôle de version).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { login } from './helpers.mjs';

describe('Saisons (R2, R13)', () => {
  let admin, parent, brouillon;

  // 1. PRÉPARER : se connecter avec les comptes dont le scénario a besoin
  before(async () => {
    admin = await login('admin@tcsay.tn', 'admin1234', 'admin');
    parent = await login('sana.benali@exemple.tn', 'temporaire', 'parent');
  });

  test('la démo contient une saison active et une saison brouillon', async () => {
    // 2. AGIR : appeler l'API comme le ferait l'écran
    const r = await admin('GET', '/seasons');
    // 3. VÉRIFIER : comparer le résultat à ce qui est attendu
    assert.equal(r.status, 200);
    assert.equal(r.data.filter((s) => s.status === 'ACTIVE').length, 1, 'une seule saison ACTIVE');
    brouillon = r.data.find((s) => s.status === 'DRAFT');
    assert.ok(brouillon, 'une saison brouillon est attendue dans la démo');
  });

  test('R2 : activer une 2e saison est refusé', async () => {
    const r = await admin('POST', `/seasons/${brouillon.id}/status`, { status: 'ACTIVE', version: brouillon.version });
    assert.ok(r.status >= 400, `activation acceptée (statut ${r.status})`);
    assert.match(String(r.data.message), /R2/);
  });

  test('R13 : une version périmée est refusée', async () => {
    const r = await admin('POST', `/seasons/${brouillon.id}/status`, { status: 'CLOSED', version: brouillon.version + 5 });
    assert.ok(r.status >= 400, `version périmée acceptée (statut ${r.status})`);
    assert.match(String(r.data.message), /R13/);
  });

  test('un parent ne peut pas changer une saison', async () => {
    const r = await parent('POST', `/seasons/${brouillon.id}/status`, { status: 'CLOSED', version: brouillon.version });
    assert.equal(r.status, 403);
  });

  test('rien n’a changé : toujours une seule saison active', async () => {
    const r = await admin('GET', '/seasons');
    assert.equal(r.data.filter((s) => s.status === 'ACTIVE').length, 1);
    assert.equal(r.data.find((s) => s.id === brouillon.id).status, 'DRAFT');
  });
});
