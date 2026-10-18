// Test de bout en bout : règles des saisons (R2 une seule saison active, R13 contrôle de version).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, login, ok, refused, uid } from './helpers.mjs';

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

describe('Saisons : verrou R1, réouverture motivée, archivage R8', () => {
  let admin, saison, cloturee;

  before(async () => {
    admin = await as('admin');
  });

  test('l’admin crée une saison passée en « Historique »', async () => {
    const y = 1990 + Math.floor(Math.random() * 15); // année fictive : plusieurs relances possibles
    saison = ok(
      await admin('POST', '/seasons', { label: `E2E ${y} ${uid()}`, startDate: `${y}-09-01`, endDate: `${y + 1}-08-31`, status: 'HISTORICAL' }),
      'création',
    );
    assert.equal(saison.status, 'HISTORICAL');
    assert.equal(saison.version, 1);
  });

  test('une saison ne peut pas être créée directement active (R2)', async () => {
    refused(await admin('POST', '/seasons', { label: `E2E ${uid()}`, startDate: '1980-09-01', endDate: '1981-08-31', status: 'ACTIVE' }), 400);
  });

  test('fin avant début : refusée', async () => {
    refused(await admin('POST', '/seasons', { label: `E2E ${uid()}`, startDate: '1981-09-01', endDate: '1980-08-31' }), 400);
  });

  test('R1 : une saison historique ne se modifie pas', async () => {
    refused(await admin('PATCH', `/seasons/${saison.id}`, { version: saison.version, label: `E2E modifiée ${uid()}` }), 409, /R1/);
  });

  test('R1 : la réouverture sans motif est refusée', async () => {
    refused(await admin('POST', `/seasons/${saison.id}/status`, { status: 'DRAFT', version: saison.version }), 400, /R1/);
  });

  test('R1 : la réouverture avec motif est acceptée, puis la saison se modifie', async () => {
    saison = ok(await admin('POST', `/seasons/${saison.id}/status`, { status: 'DRAFT', version: saison.version, reason: 'Test E2E' }));
    assert.equal(saison.status, 'DRAFT');
    const label = `E2E rouverte ${uid()}`;
    saison = ok(await admin('PATCH', `/seasons/${saison.id}`, { version: saison.version, label }));
    assert.equal(saison.label, label);
  });

  test('la réouverture est tracée dans le journal d’audit avec son motif', async () => {
    const rows = ok(await admin('GET', '/audit')); // mois en cours
    const line = rows.find((l) => l.entityId === saison.id && l.action === 'Saison rouverte');
    assert.ok(line, 'entrée « Saison rouverte » attendue');
    assert.equal(line.reason, 'Test E2E');
  });

  test('transition interdite (brouillon → clôturée) refusée', async () => {
    refused(await admin('POST', `/seasons/${saison.id}/status`, { status: 'CLOSED', version: saison.version }), 400);
  });

  test('R8 : la saison active ne s’archive pas', async () => {
    const active = ok(await admin('GET', '/seasons/active'));
    refused(await admin('DELETE', `/seasons/${active.id}?version=${active.version}`), 409, /R8/);
  });

  test('R1 : la saison clôturée de la démo est verrouillée', async () => {
    cloturee = ok(await admin('GET', '/seasons')).find((s) => s.status === 'CLOSED');
    assert.ok(cloturee, 'une saison clôturée est attendue dans la démo');
    refused(await admin('PATCH', `/seasons/${cloturee.id}`, { version: cloturee.version, label: cloturee.label }), 409, /R1/);
  });

  test('R8 / R13 : archivage avec la bonne version, la saison disparaît de la liste', async () => {
    refused(await admin('DELETE', `/seasons/${saison.id}?version=${saison.version + 3}`), 409, /R13/);
    ok(await admin('DELETE', `/seasons/${saison.id}?version=${saison.version}`), 'archivage');
    const list = ok(await admin('GET', '/seasons'));
    assert.ok(!list.some((s) => s.id === saison.id), 'saison archivée encore listée');
    const all = ok(await admin('GET', '/seasons?includeArchived=true'));
    assert.ok(all.some((s) => s.id === saison.id), 'saison archivée visible avec includeArchived');
  });

  test('toujours une seule saison active', async () => {
    const r = ok(await admin('GET', '/seasons'));
    assert.equal(r.filter((s) => s.status === 'ACTIVE').length, 1);
  });
});
