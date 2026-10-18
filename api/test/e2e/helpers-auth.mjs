// Outils des tests d'authentification et de sécurité (lecture de la base de démo, appels depuis une autre adresse locale).
import assert from 'node:assert/strict';
import { API } from './helpers.mjs';

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
