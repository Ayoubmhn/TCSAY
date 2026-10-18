// Outils partagés par les tests de bout en bout (connexion et appels à l'API).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const API = process.env.E2E_API ?? 'http://localhost:3000/api/v1';

/** fetch avec un message clair si l'API n'est pas lancée. */
async function fetchOrExplain(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(`API injoignable (${API}) : lancez d'abord « npm run start:dev » dans un autre terminal.`);
  }
}

const PW_FILE = join(tmpdir(), 'tcsay-e2e-passwords.json');
function readPasswords() {
  try {
    return JSON.parse(readFileSync(PW_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function savePassword(key, pw) {
  const all = readPasswords();
  if (all[key] === pw) return;
  all[key] = pw;
  try {
    writeFileSync(PW_FILE, JSON.stringify(all));
  } catch {
    /* mémoire facultative */
  }
}

const NEW_PW = 'Raquette2026x'; // mot de passe posé si le compte de démo exige un changement

/** Connexion (avec changement de mot de passe obligatoire si besoin) ; renvoie un client authentifié. */
export async function login(email, password, espace) {
  const post = (path, body, token) =>
    fetchOrExplain(API + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}`, 'x-espace': espace } : {}) },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  // Mot de passe qui a marché au dernier passage (mémorisé sur la machine), puis celui de la démo, puis celui posé par un
  // changement obligatoire : chaque échec compte dans la limite de 20 essais par adresse IP et 5 par identifiant.
  const key = `${API}|${email}`;
  let r;
  let used;
  for (const pw of [...new Set([readPasswords()[key], password, NEW_PW].filter(Boolean))]) {
    r = await post('/auth/login', { email, password: pw });
    if (r.accessToken) {
      used = pw;
      break;
    }
  }
  assert.ok(r.accessToken, `connexion impossible pour ${email} : ${JSON.stringify(r.message)}`);
  if (r.mustChangePassword) {
    await post('/auth/change-password', { currentPassword: used, newPassword: NEW_PW }, r.accessToken);
    r = await post('/auth/login', { email, password: NEW_PW });
    used = NEW_PW;
  }
  savePassword(key, used);
  const token = r.accessToken;
  const call = async (method, path, body, headers = {}) => {
    const form = body instanceof FormData;
    const res = await fetchOrExplain(API + path, {
      method,
      headers: { ...(form ? {} : { 'content-type': 'application/json' }), authorization: `Bearer ${token}`, 'x-espace': espace, ...headers },
      body: body ? (form ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* réponse non JSON (fichier, HTML) : texte brut */
    }
    return { status: res.status, data };
  };
  call.token = token;
  return call;
}

/** Appel sans connexion (routes publiques). */
export async function anon(method, path, body) {
  const res = await fetchOrExplain(API + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** Statut 2xx attendu, avec la réponse dans le message d'échec. */
export function ok(r, what = 'appel') {
  assert.ok(r.status >= 200 && r.status < 300, `${what} : statut ${r.status} ${JSON.stringify(r.data)?.slice(0, 400)}`);
  return r.data;
}

/** Refus attendu (statut 4xx, éventuellement précis) ; vérifie la règle citée dans le message (ex. /R7/). */
export function refused(r, status, rule) {
  if (status) assert.equal(r.status, status, `statut ${r.status} au lieu de ${status} : ${JSON.stringify(r.data)?.slice(0, 400)}`);
  else assert.ok(r.status >= 400 && r.status < 500, `refus attendu, statut ${r.status} : ${JSON.stringify(r.data)?.slice(0, 400)}`);
  if (rule) assert.match(String(r.data?.message), rule);
}

/** Suffixe unique pour les données créées par un test (les tests peuvent être relancés sur la même base). */
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Comptes de la démo (seed). */
export const ACCOUNTS = {
  admin: ['admin@tcsay.tn', 'admin1234', 'admin'],
  agent: ['agent@tcsay.tn', 'temporaire', 'admin'],
  superviseur: ['superviseur@tcsay.tn', 'temporaire', 'admin'],
  dt: ['dt@tcsay.tn', 'temporaire', 'admin'],
  coach: ['iheb@exemple.tn', 'temporaire', 'coach'],
  parent: ['sana.benali@exemple.tn', 'temporaire', 'parent'],
  parent2: ['omar.trabelsi@exemple.tn', 'temporaire', 'parent'],
};
export const as = (name) => login(...ACCOUNTS[name]);


/**
 * Lecture directe de la base de DÉMO (codes envoyés par email, que l'API ne renvoie jamais) : psql sur E2E_DATABASE_URL.
 * Sans cette variable, les tests qui en ont besoin sont ignorés (jamais de repli sur une autre base).
 */
export const DB_URL = process.env.E2E_DATABASE_URL?.replace(/\?.*$/, '');
export async function dbValue(sql) {
  const { execFileSync } = await import('node:child_process');
  assert.ok(DB_URL, 'E2E_DATABASE_URL manquant');
  return execFileSync('psql', [DB_URL, '-tAc', sql], { encoding: 'utf8' }).trim();
}
/** Code à 6 chiffres du dernier email envoyé à cette adresse. */
export async function lastEmailCode(to) {
  const body = await dbValue(`SELECT body FROM "EmailLog" WHERE "to" = '${to.replace(/'/g, "''")}' ORDER BY "createdAt" DESC LIMIT 1`);
  return body.match(/\b(\d{6})\b/)?.[1] ?? null;
}

/**
 * Appels envoyés depuis une autre adresse locale (source 127.0.0.N) : les essais refusés d'un test n'entament pas la
 * limite de 20 échecs par adresse IP des autres tests. Sur une API distante : adresse habituelle.
 * Renvoie call(method, path, body, { token, espace, headers }).
 */
export function fromIp(n) {
  const url = new URL(API);
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  return async (method, path, body, { token, espace, headers: extra = {} } = {}) => {
    const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(espace ? { 'x-espace': espace } : {}), ...extra };
    if (!local) {
      const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, data: await res.json().catch(() => null) };
    }
    const http = await import('node:http');
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: url.port || 80, path: url.pathname.replace(/\/$/, '') + path, method, headers, localAddress: `127.0.0.${n}` },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (text += c));
          res.on('end', () => {
            let data = null;
            try {
              data = text ? JSON.parse(text) : null;
            } catch {
              data = text;
            }
            resolve({ status: res.statusCode, data });
          });
        },
      );
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  };
}
