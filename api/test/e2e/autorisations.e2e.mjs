// Test de bout en bout : autorisations par rôle (@Perm), espaces (X-Espace), module Autorisations du président
// protégé par code (X-Code-Autorisations), rôles des comptes (R12, R13).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, login, ok, refused, uid } from './helpers.mjs';
import { fromIp } from './helpers-auth.mjs';

const CODE = '482917';
const SIDE = fromIp(10 + Math.floor(Math.random() * 200));
const H = { 'x-code-autorisations': CODE };

describe('Autorisations selon le rôle et l’espace', () => {
  let parent, coach, agent, superviseur, dt;

  before(async () => {
    [parent, coach, agent, superviseur, dt] = await Promise.all(['parent', 'coach', 'agent', 'superviseur', 'dt'].map(as));
  });

  test('le superviseur voit le tableau de bord (stats.view) mais pas les joueurs ni l’audit', async () => {
    ok(await superviseur('GET', '/dashboard'));
    refused(await superviseur('POST', '/parents', { firstName: 'X', lastName: 'Y', email: `x.${uid()}@exemple.tn`, phone: '1', cin: '12345678' }), 403);
    refused(await superviseur('GET', '/audit'), 403);
  });

  test('l’agent administratif n’a pas les statistiques ni le module Autorisations', async () => {
    refused(await agent('GET', '/dashboard'), 403);
    refused(await agent('GET', '/permissions', undefined, H), 403);
    ok(await agent('GET', '/planning'), 'planning (planning.view)');
  });

  test('parent et coach : aucune route d’administration', async () => {
    for (const c of [parent, coach]) {
      refused(await c('GET', '/dashboard'), 403);
      refused(await c('GET', '/audit'), 403);
    }
  });

  test('un parent qui demande l’espace admin reste dans son espace (403)', async () => {
    const r = await login('sana.benali@exemple.tn', 'temporaire', 'admin');
    refused(await r('GET', '/dashboard'), 403);
    const me = ok(await r('GET', '/auth/me'));
    assert.equal(me.space, 'parent');
  });

  test('directeur technique : le planning dans l’espace admin, pas dans l’espace coach', async () => {
    ok(await dt('GET', '/planning'));
    refused(await dt('GET', '/planning', undefined, { 'x-espace': 'coach' }), 403);
    const me = ok(await dt('GET', '/auth/me', undefined, { 'x-espace': 'coach' }));
    assert.equal(me.space, 'coach');
    assert.deepEqual(me.permissions, []);
  });
});

describe('Module Autorisations (président, code de sécurité)', () => {
  let admin, superviseur, matrix;

  before(async () => {
    admin = await as('admin');
    superviseur = await as('superviseur');
  });

  after(async () => {
    // Droits du superviseur remis comme avant le test.
    if (matrix) await admin('PUT', '/permissions/roles/SUPERVISOR', { permissions: matrix.SUPERVISOR }, H);
  });

  test('créer ou remplacer le code exige le mot de passe du président', async () => {
    refused(await SIDE('POST', '/permissions/code', { password: 'faux-mot-1', code: CODE }, { token: admin.token, espace: 'admin' }), 400);
    refused(await admin('POST', '/permissions/code', { password: 'admin1234', code: '12' }), 400);
    ok(await admin('POST', '/permissions/code', { password: 'admin1234', code: CODE }));
    assert.equal(ok(await admin('GET', '/permissions/code-status')).hasCode, true);
  });

  test('sans code ou avec un mauvais code : 403', async () => {
    refused(await admin('GET', '/permissions'), 403);
    const r = await SIDE('GET', '/permissions', undefined, { token: admin.token, espace: 'admin', headers: { 'x-code-autorisations': '000000' } });
    refused(r, 403, /incorrect/);
  });

  test('avec le code : catalogue, rôles réglables et matrice', async () => {
    const r = ok(await admin('GET', '/permissions', undefined, H));
    assert.ok(r.catalog.some((p) => p.key === 'budget.manage'));
    assert.deepEqual(r.roles.map((x) => x.role).sort(), ['ADMIN_AGENT', 'SUPERVISOR', 'TECH_DIRECTOR']);
    matrix = r.matrix;
    assert.ok(matrix.SUPERVISOR.includes('stats.view'));
  });

  test('le superviseur, même avec le code, n’ouvre pas le module', async () => {
    refused(await superviseur('GET', '/permissions', undefined, H), 403);
  });

  test('le président ne change pas ses propres droits ; autorisation inconnue refusée', async () => {
    refused(await admin('PUT', '/permissions/roles/PRESIDENT', { permissions: [] }, H), 400);
    refused(await admin('PUT', '/permissions/roles/SUPERVISOR', { permissions: ['pas.une.autorisation'] }, H), 400);
  });

  test('donner « Historique des actions » au superviseur ouvre l’audit ; le retirer le referme', async () => {
    refused(await superviseur('GET', '/audit'), 403);
    const withAudit = [...new Set([...matrix.SUPERVISOR, 'audit.view'])];
    ok(await admin('PUT', '/permissions/roles/SUPERVISOR', { permissions: withAudit }, H));
    ok(await superviseur('GET', '/audit'));
    ok(await admin('PUT', '/permissions/roles/SUPERVISOR', { permissions: matrix.SUPERVISOR.filter((p) => p !== 'audit.view') }, H));
    refused(await superviseur('GET', '/audit'), 403);
  });

  test('chaque modification de droits va dans l’historique des actions', async () => {
    const r = ok(await admin('GET', '/audit'));
    const rows = Array.isArray(r) ? r : (r.items ?? r.rows ?? r.data ?? []);
    assert.ok(rows.some((a) => a.action === 'Autorisations modifiées'), 'action « Autorisations modifiées » attendue');
  });
});

describe('Rôles des comptes (R12, R13)', () => {
  let admin, account;

  before(async () => {
    admin = await as('admin');
    ok(await admin('POST', '/permissions/code', { password: 'admin1234', code: CODE }));
    const id = uid();
    const email = `e2e.roles.${id}@exemple.tn`;
    const created = ok(
      await admin('POST', '/parents', { firstName: 'Test', lastName: `Roles${id}`, email, phone: '+216 20 000 001', cin: String(Math.floor(10_000_000 + Math.random() * 89_999_999)) }),
    );
    account = { id: created.id, email };
  });

  const find = async (q) => ok(await admin('GET', `/permissions/users?q=${encodeURIComponent(q)}`, undefined, H));

  test('R12 : retirer le rôle président au seul président est refusé', async () => {
    const all = ok(await admin('GET', '/permissions/users', undefined, H));
    const presidents = all.filter((u) => u.roles.includes('PRESIDENT') && u.isActive);
    if (presidents.length !== 1) return; // plusieurs présidents dans la base : scénario non applicable (rien n'est retiré)
    const p = presidents[0];
    const r = await admin('PUT', `/permissions/users/${p.id}`, { version: p.version, roles: ['ADMIN_AGENT'] }, H);
    // Filet de sécurité : si la règle ne tenait pas, le rôle président est rendu tout de suite.
    if (r.status < 300) await admin('PUT', `/permissions/users/${p.id}`, { version: r.data.version, roles: p.roles }, H);
    refused(r, 409, /R12/);
  });

  test('un compte garde au moins un rôle ; rôle joueur sans fiche : genre et naissance exigés', async () => {
    const [u] = await find(account.email);
    refused(await admin('PUT', `/permissions/users/${u.id}`, { version: u.version, roles: [] }, H), 400);
    refused(await admin('PUT', `/permissions/users/${u.id}`, { version: u.version, roles: ['PARENT', 'PLAYER'] }, H), 400, /genre/);
    refused(await admin('PUT', `/permissions/users/${u.id}`, { version: u.version, roles: ['PARENT', 'ROI'] }, H), 400);
  });

  test('ajouter le rôle superviseur ouvre l’espace admin avec ses droits ; R13 sur une version périmée', async () => {
    const [u] = await find(account.email);
    const r = ok(await admin('PUT', `/permissions/users/${u.id}`, { version: u.version, roles: ['PARENT', 'SUPERVISOR'] }, H));
    assert.deepEqual([...r.roles].sort(), ['PARENT', 'SUPERVISOR']);
    refused(await admin('PUT', `/permissions/users/${u.id}`, { version: u.version, roles: ['PARENT'] }, H), 409, /R13/);
    // Remise au seul rôle parent.
    ok(await admin('PUT', `/permissions/users/${u.id}`, { version: r.version, roles: ['PARENT'] }, H));
    const [back] = await find(account.email);
    assert.deepEqual(back.roles, ['PARENT']);
  });

  test('identifiant de compte invalide : 400, jamais une erreur serveur', async () => {
    refused(await admin('PUT', '/permissions/users/pas-un-uuid', { version: 1, roles: ['PARENT'] }, H), 400);
    refused(await admin('PUT', '/permissions/users/00000000-0000-4000-8000-000000000000', { version: 1, roles: ['PARENT'] }, H), 404);
  });
});
