// Test de bout en bout : sécurité de l'API (limite des essais de connexion, en-têtes HTTP, validation des données).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs). Les essais refusés partent d'une adresse locale annexe
// (127.0.0.N) : le blocage ne touche que cette adresse, jamais les autres tests.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { API, anon, as, ok, refused, uid } from './helpers.mjs';
import { fromIp } from './helpers-auth.mjs';

describe('Limite des essais de connexion', () => {
  test('5 échecs pour un identifiant : bloqué 15 min (429), même avec le bon mot de passe', async () => {
    const side = fromIp(10 + Math.floor(Math.random() * 200));
    let status = 0;
    for (let i = 0; i < 6 && status !== 429; i++) {
      status = (await side('POST', '/auth/login', { email: 'admin@tcsay.tn', password: `faux-${i}-essai` })).status;
      if (i < 4) assert.ok(status === 401 || status === 429, `statut ${status}`);
    }
    assert.equal(status, 429, 'blocage attendu au plus tard au 6e essai');
    const good = await side('POST', '/auth/login', { email: 'admin@tcsay.tn', password: 'admin1234' });
    refused(good, 429);
    assert.match(String(good.data.message), /Trop d’essais/);
  });

  test('le blocage vise l’identifiant depuis cette adresse : ailleurs, la connexion marche', async () => {
    ok(await anon('POST', '/auth/login', { email: 'admin@tcsay.tn', password: 'admin1234' }));
  });

  test('un autre identifiant depuis l’adresse bloquée reste accepté', async () => {
    const side = fromIp(10 + Math.floor(Math.random() * 200));
    for (let i = 0; i < 5; i++) await side('POST', '/auth/login', { email: `bloque.${uid()}@exemple.tn`, password: 'faux-mot-1' });
    ok(await side('POST', '/auth/login', { email: 'admin@tcsay.tn', password: 'admin1234' }));
  });
});

describe('En-têtes et validation', () => {
  test('route publique de santé et en-têtes de sécurité', async () => {
    const res = await fetch(`${API}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-store', 'données personnelles : jamais en cache');
    assert.equal(res.headers.get('x-powered-by'), null, 'la technologie du serveur ne doit pas être annoncée');
  });

  test('champ inconnu refusé (liste blanche) : 400', async () => {
    refused(await anon('POST', '/auth/login', { email: 'admin@tcsay.tn', password: 'admin1234', role: 'ADMIN' }), 400);
  });

  test('corps JSON illisible : 400, jamais une erreur serveur', async () => {
    const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":' });
    assert.equal(res.status, 400);
  });

  test('identifiant mal formé dans l’adresse : 400 ; inconnu : 404', async () => {
    const admin = await as('admin');
    refused(await admin('GET', '/parents/pas-un-uuid/profile'), 400);
    refused(await admin('GET', '/parents/00000000-0000-4000-8000-000000000000/profile'), 404);
  });

  test('route inexistante : 404', async () => {
    refused(await anon('GET', `/route-inexistante-${uid()}`), 404);
  });
});
