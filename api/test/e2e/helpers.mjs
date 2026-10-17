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
  return async (method, path, body) => {
    const res = await fetchOrExplain(API + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-espace': espace },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

