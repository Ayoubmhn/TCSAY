// Contrôle des modules activables (version du club) : une API lancée avec MODULES_COUPES refuse les routes des
// modules coupés (404) et garde les autres. Lance l'API compilée (dist/) sur une base de DÉMONSTRATION :
//   E2E_DATABASE_URL=<url> npm run test:modules
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, describe, test } from 'node:test';

const DB = process.env.E2E_DATABASE_URL;
const PORT = 3191;
const API = `http://localhost:${PORT}/api/v1`;
// Version du club validée (docs/VERSION_CLUB.md).
const OFF = 'arabe,budget,disponibilites,evaluation-seances,bilans,exercices';

describe('Modules activables (version du club)', { skip: !DB && 'E2E_DATABASE_URL manquant (base de démo)' }, () => {
  let api;
  let h;

  before(async () => {
    api = spawn(process.execPath, ['dist/main'], {
      env: { ...process.env, DATABASE_URL: DB, PORT: String(PORT), MODULES_COUPES: `${OFF},faute-de-frappe`, TELEGRAM_BOT_TOKEN: '', RATE_LIMIT_PER_MINUTE: '100000' },
      stdio: 'ignore',
    });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${API}/health`)).ok) break;
      } catch {
        /* pas encore prête */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    let token;
    for (const password of ['admin1234', 'Raquette2026x']) {
      const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@tcsay.tn', password }) });
      token = (await r.json()).accessToken;
      if (token) break;
    }
    assert.ok(token, 'connexion du président impossible');
    h = { authorization: `Bearer ${token}`, 'x-espace': 'admin' };
  });

  after(() => api?.kill());

  test('GET /modules (public) donne les modules coupés, sans les clés inconnues', async () => {
    const r = await fetch(`${API}/modules`);
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).disabled.sort(), OFF.split(',').sort());
  });

  test('le profil connecté porte les modules coupés (menu du site)', async () => {
    const me = await fetch(`${API}/auth/me`, { headers: h }).then((r) => r.json());
    assert.deepEqual(me.disabledModules.sort(), OFF.split(',').sort());
  });

  test('les routes des modules coupés répondent 404, même au président', async () => {
    for (const path of ['/projects', '/budget/treasury/forecast', '/availability/coaches', '/exercises', '/evaluations/criteria', '/evaluations/overview', '/progress', '/sessions/review?slotId=x&date=2026-10-01']) {
      const r = await fetch(`${API}${path}`, { headers: h });
      assert.equal(r.status, 404, `${path} devrait être coupé (reçu ${r.status})`);
    }
    // Sans connexion aussi : le module n'existe pas pour cette mise en ligne.
    assert.equal((await fetch(`${API}/projects`)).status, 404);
  });

  test('les autres modules restent ouverts', async () => {
    for (const path of ['/players', '/seasons', '/expenses', '/matches', '/tournaments', '/events', '/stats/finances', '/access/payment/config', '/history']) {
      const r = await fetch(`${API}${path}`, { headers: h });
      assert.ok(r.status < 400, `${path} devrait rester ouvert (reçu ${r.status})`);
    }
  });
});
