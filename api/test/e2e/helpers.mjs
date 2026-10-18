// Outils partagés par les tests de bout en bout (connexion et appels à l'API).
import assert from 'node:assert/strict';

export const API = process.env.E2E_API ?? 'http://localhost:3000/api/v1';

/** fetch avec un message clair si l'API n'est pas lancée. */
async function fetchOrExplain(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(`API injoignable (${API}) : lancez d'abord « npm run start:dev » dans un autre terminal.`);
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
  let r = await post('/auth/login', { email, password: NEW_PW });
  if (!r.accessToken || r.mustChangePassword) {
    r = await post('/auth/login', { email, password });
    assert.ok(r.accessToken, `connexion impossible pour ${email} : ${JSON.stringify(r.message)}`);
    if (r.mustChangePassword) {
      await post('/auth/change-password', { currentPassword: password, newPassword: NEW_PW }, r.accessToken);
      r = await post('/auth/login', { email, password: NEW_PW });
    }
  }
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

