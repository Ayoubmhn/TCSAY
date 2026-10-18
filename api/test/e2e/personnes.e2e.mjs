// Test de bout en bout : entraîneurs, personnel (R12) et parents (R8 suppression ou désactivation, R9 lien d'un mineur).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

const fakeCin = () => ('T' + uid()).slice(0, 12); // CIN fictive unique
const fakeEmail = (prefix = 'e2e') => `${prefix}.${uid()}@exemple.tn`;

describe('Entraîneurs', () => {
  let admin, agent, superviseur, coach, entraineur;

  before(async () => {
    admin = await as('admin');
    agent = await as('agent');
    superviseur = await as('superviseur');
    coach = await as('coach');
  });

  test('création d’un entraîneur sans email (identifiant = CIN)', async () => {
    const cin = fakeCin();
    const r = ok(await admin('POST', '/coaches', { firstName: 'Coach', lastName: `E2E${uid()}`, cin, payMode: 'HOURLY', payRate: 15 }), 'création');
    const list = ok(await admin('GET', '/coaches'));
    entraineur = list.find((c) => c.id === r.id);
    assert.ok(entraineur, 'l’entraîneur apparaît dans la liste');
    assert.equal(entraineur.cin, cin);
    assert.equal(entraineur.isActive, true);
    assert.equal(entraineur.payMode, 'HOURLY');
  });

  test('champs obligatoires et format : refus', async () => {
    refused(await admin('POST', '/coaches', { firstName: 'X', lastName: 'Y', cin: '12', payMode: 'HOURLY', payRate: 10 }), 400);
    refused(await admin('POST', '/coaches', { firstName: 'X', lastName: 'Y', cin: fakeCin(), payMode: 'DAILY', payRate: 10 }), 400);
    refused(await admin('POST', '/coaches', { firstName: 'X', lastName: 'Y', cin: fakeCin(), payMode: 'HOURLY', payRate: -1 }), 400);
  });

  test('R13 : modification avec une version périmée refusée, puis acceptée', async () => {
    const body = { firstName: 'Coach', lastName: entraineur.lastName, cin: entraineur.cin, payMode: 'MONTHLY', payRate: 800 };
    refused(await admin('PATCH', `/coaches/${entraineur.id}`, { ...body, version: entraineur.version + 4 }), 409, /R13/);
    ok(await admin('PATCH', `/coaches/${entraineur.id}`, { ...body, version: entraineur.version }));
    const after = ok(await admin('GET', '/coaches')).find((c) => c.id === entraineur.id);
    assert.equal(after.payMode, 'MONTHLY');
    assert.equal(after.payRate, 800);
    entraineur = after;
  });

  test('fiche profil de l’entraîneur', async () => {
    assert.equal((await admin('GET', `/coaches/${entraineur.id}/profile`)).status, 200);
  });

  test('désactivation puis réactivation (jamais de suppression)', async () => {
    ok(await admin('POST', `/coaches/${entraineur.id}/deactivate`));
    assert.equal(ok(await admin('GET', '/coaches')).find((c) => c.id === entraineur.id).isActive, false);
    ok(await admin('POST', `/coaches/${entraineur.id}/activate`));
    assert.equal(ok(await admin('GET', '/coaches')).find((c) => c.id === entraineur.id).isActive, true);
  });

  test('droits : l’agent gère les entraîneurs, le superviseur et le coach non', async () => {
    assert.equal((await agent('GET', '/coaches')).status, 200);
    refused(await superviseur('POST', '/coaches', { firstName: 'X', lastName: 'Y', cin: fakeCin(), payMode: 'HOURLY', payRate: 10 }), 403);
    refused(await coach('GET', '/coaches'), 403);
  });
});

describe('Personnel (R12)', () => {
  let admin, agent, dt, membre;

  before(async () => {
    admin = await as('admin');
    agent = await as('agent');
    dt = await as('dt');
  });

  test('création d’un agent superviseur', async () => {
    const r = ok(await admin('POST', '/staff', { firstName: 'Staff', lastName: `E2E${uid()}`, cin: fakeCin(), functions: ['SUPERVISOR'], payMode: 'MONTHLY', payRate: 500 }));
    membre = ok(await admin('GET', '/staff')).find((s) => s.id === r.id);
    assert.deepEqual(membre.functions, ['SUPERVISOR']);
  });

  test('fonction obligatoire et connue', async () => {
    refused(await admin('POST', '/staff', { firstName: 'X', lastName: 'Y', cin: fakeCin(), functions: [], payMode: 'MONTHLY', payRate: 1 }), 400);
    refused(await admin('POST', '/staff', { firstName: 'X', lastName: 'Y', cin: fakeCin(), functions: ['PARENT'], payMode: 'MONTHLY', payRate: 1 }), 400);
  });

  test('changement de fonctions (version à jour), version périmée refusée', async () => {
    const body = { firstName: membre.firstName, lastName: membre.lastName, cin: membre.cin, functions: ['SUPERVISOR', 'TECH_DIRECTOR'], payMode: 'MONTHLY', payRate: 550 };
    refused(await admin('PATCH', `/staff/${membre.id}`, { ...body, version: membre.version + 2 }), 409, /R13/);
    const u = ok(await admin('PATCH', `/staff/${membre.id}`, { ...body, version: membre.version }));
    assert.deepEqual([...u.functions].sort(), ['SUPERVISOR', 'TECH_DIRECTOR']);
    membre = u;
  });

  test('une personne qui a déjà un compte reçoit la fonction en plus (même CIN)', async () => {
    const cin = fakeCin();
    const c = ok(await admin('POST', '/coaches', { firstName: 'Double', lastName: `E2E${uid()}`, cin, payMode: 'HOURLY', payRate: 10 }));
    const s = ok(await admin('POST', '/staff', { firstName: 'Double', lastName: 'Role', cin, functions: ['ADMIN_AGENT'], payMode: 'MONTHLY', payRate: 1 }));
    const coachUser = ok(await admin('GET', '/coaches')).find((x) => x.id === c.id).userId;
    assert.equal(s.id, coachUser, 'même compte, pas de doublon');
    const staff = ok(await admin('GET', '/staff')).find((x) => x.id === s.id);
    assert.ok(staff.roles.includes('COACH') && staff.roles.includes('ADMIN_AGENT'));
    ok(await admin('POST', `/staff/${s.id}/deactivate`));
  });

  test('R12 : le dernier président actif ne peut pas être désactivé', async () => {
    const pres = ok(await admin('GET', '/staff')).filter((s) => s.roles.includes('PRESIDENT') && s.isActive);
    if (pres.length !== 1) return; // plusieurs présidents : règle non applicable
    refused(await admin('POST', `/staff/${pres[0].id}/deactivate`), 409, /R12/);
  });

  test('désactivation d’un membre du personnel', async () => {
    const u = ok(await admin('POST', `/staff/${membre.id}/deactivate`));
    assert.equal(u.isActive, false);
  });

  test('droits : seul le président gère le personnel (agent, directeur technique : 403)', async () => {
    refused(await agent('GET', '/staff'), 403);
    refused(await dt('POST', '/staff', { firstName: 'X', lastName: 'Y', cin: fakeCin(), functions: ['SUPERVISOR'], payMode: 'MONTHLY', payRate: 1 }), 403);
  });
});

describe('Parents (R8, R9)', () => {
  let admin, coach, parent, year, papa, maman, enfant;

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    parent = await as('parent');
    year = new Date(ok(await admin('GET', '/seasons/active')).startDate).getUTCFullYear();
  });

  test('création de deux parents ; email obligatoire', async () => {
    refused(await admin('POST', '/parents', { firstName: 'Sans', lastName: 'Email', phone: '20000000', cin: fakeCin() }), 400);
    const mk = async (firstName) =>
      ok(await admin('POST', '/parents', { firstName, lastName: `E2E${uid()}`, email: fakeEmail('parent'), phone: '20000010', cin: fakeCin() }));
    papa = await mk('Papa');
    maman = await mk('Maman');
    const list = ok(await admin('GET', '/parents'));
    assert.ok(list.some((p) => p.id === papa.id) && list.some((p) => p.id === maman.id));
  });

  test('email déjà utilisé : refusé', async () => {
    const existing = ok(await admin('GET', '/parents')).find((p) => p.id === papa.id);
    const r = await admin('POST', '/parents', { firstName: 'Bis', lastName: 'E2E', email: existing.email, phone: '20000011', cin: fakeCin() });
    assert.ok(r.status === 409 || r.status === 400, `doublon accepté (statut ${r.status})`);
  });

  test('enfant mineur lié au premier parent puis au second', async () => {
    enfant = ok(await admin('POST', '/players', { firstName: 'Enfant', lastName: `E2E${uid()}`, birthDate: `${year - 10}-02-02`, gender: 'F', parentId: papa.id }));
    assert.equal(enfant.parents[0].id, papa.id);
    ok(await admin('POST', `/parents/${maman.id}/links`, { playerId: enfant.id }));
    const prof = ok(await admin('GET', `/parents/${maman.id}/profile`));
    assert.ok(JSON.stringify(prof).includes(enfant.id), 'l’enfant figure sur la fiche du second parent');
  });

  test('R9 : retirer un des deux parents est accepté, retirer le dernier est refusé', async () => {
    ok(await admin('DELETE', `/parents/${maman.id}/links/${enfant.id}`));
    refused(await admin('DELETE', `/parents/${papa.id}/links/${enfant.id}`), 409, /R9/);
  });

  test('R9 : supprimer le seul parent d’un mineur est refusé', async () => {
    refused(await admin('DELETE', `/parents/${papa.id}`), 409, /R9/);
  });

  test('suppression d’un parent sans historique ni enfant', async () => {
    ok(await admin('DELETE', `/parents/${maman.id}`));
    assert.ok(!ok(await admin('GET', '/parents')).some((p) => p.id === maman.id && p.isActive));
  });

  test('R8 : un parent avec un historique se désactive au lieu d’être supprimé', async () => {
    const sana = ok(await admin('GET', '/parents')).find((p) => p.email === 'sana.benali@exemple.tn');
    refused(await admin('DELETE', `/parents/${sana.id}`), 409);
  });

  test('désactivation et réactivation d’un parent', async () => {
    ok(await admin('POST', `/parents/${papa.id}/deactivate`));
    assert.equal(ok(await admin('GET', '/parents')).find((p) => p.id === papa.id).isActive, false);
    ok(await admin('POST', `/parents/${papa.id}/activate`));
    assert.equal(ok(await admin('GET', '/parents')).find((p) => p.id === papa.id).isActive, true);
  });

  test('R13 : modification avec une version périmée refusée', async () => {
    const p = ok(await admin('GET', '/parents')).find((x) => x.id === papa.id);
    refused(await admin('PATCH', `/parents/${p.id}`, { version: p.version + 3, phone: '20000012' }), 409, /R13/);
    ok(await admin('PATCH', `/parents/${p.id}`, { version: p.version, phone: '20000012' }));
    assert.equal(ok(await admin('GET', '/parents')).find((x) => x.id === papa.id).phone, '20000012');
  });

  test('droits : ni le coach ni un parent ne voient la liste des parents', async () => {
    refused(await coach('GET', '/parents'), 403);
    refused(await parent('GET', '/parents'), 403);
  });
});
