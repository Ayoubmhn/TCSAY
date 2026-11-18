// Contrôle de la météo, sans réseau : un faux serveur Open-Meteo local répond à l'API.
// Lance l'API compilée (dist/) sur une base de DÉMONSTRATION : E2E_DATABASE_URL=<url> npm run test:weather
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';

const DB = process.env.E2E_DATABASE_URL;
const pad = (n) => String(n).padStart(2, '0');
const hourOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;

async function start(port, env) {
  const proc = spawn(process.execPath, ['dist/main'], { env: { ...process.env, DATABASE_URL: DB, PORT: String(port), TZ: 'Africa/Tunis', ...env }, stdio: 'ignore' });
  const api = `http://localhost:${port}/api/v1`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${api}/health`)).ok) break;
    } catch {
      /* pas encore prête */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const r = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@tcsay.tn', password: 'admin1234' }) });
  assert.equal(r.status, 200, 'connexion admin@tcsay.tn');
  const { accessToken } = await r.json();
  const get = (path, token = accessToken) => fetch(`${api}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { proc, get };
}

describe('Météo (faux serveur Open-Meteo)', { skip: !DB && 'E2E_DATABASE_URL manquant (base de démo)' }, () => {
  let fake, ok, down;
  const calls = [];

  before(async () => {
    process.env.TZ = 'Africa/Tunis';
    // 3 jours d'heures à partir de minuit (heure du club) ; pluie de 17 h à 19 h.
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const time = [];
    for (let i = 0; i < 72; i++) time.push(hourOf(new Date(midnight.getTime() + i * 3600_000)));
    const hour = (t) => Number(t.slice(11, 13));
    fake = createServer((req, res) => {
      calls.push(req.url);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          current: { time: hourOf(new Date()), temperature_2m: 18.4, weather_code: 61, wind_speed_10m: 21.6 },
          hourly: {
            time,
            temperature_2m: time.map(() => 17.6),
            weather_code: time.map((t) => (hour(t) >= 17 && hour(t) <= 19 ? 61 : 3)),
            precipitation_probability: time.map((t) => (hour(t) >= 17 && hour(t) <= 19 ? 80 : hour(t) === 20 ? null : 10)),
          },
        }),
      );
    });
    await new Promise((r) => fake.listen(0, r));
    ok = await start(3191, { WEATHER_BASE_URL: `http://localhost:${fake.address().port}` });
    down = await start(3192, { WEATHER_BASE_URL: 'http://localhost:9' });
  });

  after(() => {
    ok?.proc.kill();
    down?.proc.kill();
    fake?.close();
  });

  test('lisible sans connexion (aucune donnée personnelle)', async () => {
    const r = await ok.get('/weather', null);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).place, 'Sayada');
  });

  test('prévision de Sayada : heure en cours et suivantes, valeurs arrondies, coordonnées du club seulement', async () => {
    const w = await (await ok.get('/weather')).json();
    assert.equal(w.available, true);
    assert.equal(w.place, 'Sayada');
    assert.deepEqual({ temp: w.current.temp, code: w.current.code, wind: w.current.wind }, { temp: 18, code: 61, wind: 22 });
    assert.equal(w.hours[0].time, hourOf(new Date()));
    assert.ok(w.hours.every((h) => h.time >= hourOf(new Date()) && Number.isInteger(h.temp)));
    const rainy = w.hours.find((h) => h.time.endsWith('T18:00'));
    assert.deepEqual({ rain: rainy.rain, code: rainy.code }, { rain: 80, code: 61 });
    assert.equal(w.hours.find((h) => h.time.endsWith('T20:00')).rain, 0, 'probabilité absente = 0');
    assert.match(calls[0], /latitude=35\.6717&longitude=10\.8936&timezone=Africa%2FTunis/);
  });

  test('une seule lecture chez Open-Meteo pour tous les comptes (cache de 30 min)', async () => {
    await Promise.all([ok.get('/weather'), ok.get('/weather'), ok.get('/weather')]);
    assert.equal(calls.length, 1);
  });

  test('service injoignable : pas de météo, jamais d’erreur', async () => {
    const r = await down.get('/weather');
    assert.equal(r.status, 200);
    const w = await r.json();
    assert.equal(w.available, false);
    assert.deepEqual(w.hours, []);
    assert.match(w.error, /^Open-Meteo injoignable/);
  });
});
