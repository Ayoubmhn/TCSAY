// Contrôle des alertes Telegram, sans réseau : un faux serveur Telegram local reçoit les messages.
// Lance l'API compilée (dist/) sur une base de DÉMONSTRATION : E2E_DATABASE_URL=<url> npm run test:alerts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { after, before, describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const DB = process.env.E2E_DATABASE_URL;
const PORT = 3190;
const API = `http://localhost:${PORT}/api/v1`;

const received = [];
const waitFor = async (pred, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = received.find(pred);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`message Telegram attendu non reçu (reçus : ${received.map((m) => m.text.split('\n')[0]).join(' / ')})`);
};

describe('Alertes Telegram', { skip: !DB && 'E2E_DATABASE_URL manquant (base de démo)' }, () => {
  let fake, api, telegramUrl;

  before(async () => {
    fake = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ path: req.url, ...JSON.parse(body || '{}') });
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true}');
      });
    });
    await new Promise((r) => fake.listen(0, r));
    telegramUrl = `http://localhost:${fake.address().port}`;
    api = spawn(process.execPath, ['dist/main'], {
      env: { ...process.env, DATABASE_URL: DB, PORT: String(PORT), TELEGRAM_API_URL: telegramUrl, TELEGRAM_BOT_TOKEN: 'jeton-test', TELEGRAM_CHAT_ID: '42', ALERT_INSTANCE: 'Essai' },
      stdio: 'ignore',
    });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${API}/health`)).ok) return;
      } catch {
        /* pas encore prête */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.fail('API non démarrée');
  });

  after(() => {
    api?.kill();
    fake?.close();
  });

  test('le démarrage du serveur est signalé, au bon bot et à la bonne conversation', async () => {
    const m = await waitFor((x) => x.text.includes('Serveur démarré'));
    assert.equal(m.path, '/botjeton-test/sendMessage');
    assert.equal(m.chat_id, '42');
    assert.match(m.text, /^🟢 Essai · Serveur démarré/);
  });

  test('une page plantée sur le site est signalée, sans paramètres ni email', async () => {
    const r = await fetch(`${API}/alerts/client-error`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Mobile' },
      body: JSON.stringify({ message: 'Cannot read properties of undefined (lina@exemple.tn)', page: '/admin/joueurs?q=Lina', stack: 'TypeError\n at PlayersPage (PlayersPage-x.js:1:2)' }),
    });
    assert.equal(r.status, 204);
    const m = await waitFor((x) => x.text.includes('Page du site en erreur'));
    assert.match(m.text, /Page \/admin\/joueurs \(téléphone\)/);
    assert.doesNotMatch(m.text, /q=Lina|lina@exemple\.tn/);
    assert.match(m.text, /<email>/);
  });

  test('la même erreur répétée n’envoie qu’un message (10 min)', async () => {
    const before = received.length;
    for (let i = 0; i < 3; i++) {
      await fetch(`${API}/alerts/client-error`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Erreur répétée', page: '/x' }),
      });
    }
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(received.filter((x) => x.text.includes('Erreur répétée')).length, 1);
    assert.equal(received.length, before + 1);
  });

  test('les erreurs de réseau ou de nouvelle version ne sont pas des bugs : aucune alerte', async () => {
    const before = received.length;
    await fetch(`${API}/alerts/client-error`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Failed to fetch dynamically imported module: /assets/x.js', page: '/' }),
    });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(received.length, before);
  });

  test('message d’essai et résumé du jour : réservés au président', async () => {
    const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@tcsay.tn', password: 'admin1234' }) }).then((r) => r.json());
    let token = login.accessToken;
    if (!token) {
      const saved = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@tcsay.tn', password: 'Raquette2026x' }) }).then((r) => r.json());
      token = saved.accessToken;
    }
    assert.ok(token, 'connexion du président impossible');
    const h = { authorization: `Bearer ${token}`, 'x-espace': 'admin' };
    assert.equal((await fetch(`${API}/alerts/test`, { method: 'POST', headers: h })).status, 201);
    await waitFor((x) => x.text.includes('Message d’essai'));
    assert.equal((await fetch(`${API}/alerts/summary`, { method: 'POST', headers: h })).status, 201);
    const m = await waitFor((x) => x.text.includes('Résumé du jour'));
    assert.match(m.text, /Erreurs du serveur \(500\) : \d+/);
    assert.equal((await fetch(`${API}/alerts/test`, { method: 'POST' })).status, 401);
  });

  test('une erreur imprévue dans une route répond 500 et part sur Telegram (filtre global)', async () => {
    process.env.TELEGRAM_API_URL = telegramUrl;
    process.env.TELEGRAM_BOT_TOKEN = 'jeton-test';
    process.env.TELEGRAM_CHAT_ID = '42';
    const { AlertExceptionFilter } = require('../dist/alerts/alert-exception.filter.js');
    const { HttpException } = require('@nestjs/common');
    const replies = [];
    const adapter = { reply: (_res, body, status) => replies.push({ body, status }), isHeadersSent: () => false, end: () => undefined };
    const filter = new AlertExceptionFilter(adapter);
    const host = (req) => ({ getArgs: () => [req, {}], getArgByIndex: (i) => [req, {}][i], switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }), getType: () => 'http' });
    filter.catch(new TypeError('x is not a function'), host({ method: 'GET', originalUrl: '/api/v1/players/abc?q=Lina', user: { id: 'u1', role: 'ADMIN' } }));
    assert.equal(replies[0].status, 500);
    const m = await waitFor((x) => x.text.includes('Erreur du serveur (500)'));
    assert.match(m.text, /GET \/api\/v1\/players\/abc\n/);
    assert.doesNotMatch(m.text, /q=Lina/);
    assert.match(m.text, /TypeError : x is not a function/);
    // Un refus normal (404) ne déclenche pas d'alerte.
    const n = received.length;
    filter.catch(new HttpException('Introuvable', 404), host({ method: 'GET', originalUrl: '/api/v1/x' }));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(replies[1].status, 404);
    assert.equal(received.length, n);
  });
});
