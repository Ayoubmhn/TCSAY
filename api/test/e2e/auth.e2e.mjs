// Test de bout en bout : connexion, première connexion (mot de passe temporaire, « Modifier plus tard »),
// changement de mot de passe (sessions coupées) et mot de passe oublié (code par email).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs). Les codes envoyés par email sont lus dans la base
// de démo (E2E_DATABASE_URL) ; sans elle, ces scénarios sont ignorés.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { API, anon, as, ok, refused, uid } from './helpers.mjs';
import { DB_URL, dbValue, fromIp, lastEmailCode } from './helpers-auth.mjs';

/** Essais refusés envoyés depuis une autre adresse locale : la limite par IP des autres tests reste intacte. */
const SIDE = fromIp(10 + Math.floor(Math.random() * 200));

/** Client authentifié par un jeton brut (compte créé par le test). */
const client = (token, espace = 'parent') => async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-espace': espace },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

/** Nouveau parent (compte réel de test) : identifiants envoyés par email, mot de passe temporaire lu dans la base. */
async function newParent(admin) {
  const id = uid();
  const email = `e2e.auth.${id}@exemple.tn`;
  const r = ok(
    await admin('POST', '/parents', {
      firstName: 'Test',
      lastName: `Auth${id}`,
      email,
      phone: '+216 20 000 000',
      cin: String(Math.floor(10_000_000 + Math.random() * 89_999_999)),
    }),
    'création du parent',
  );
  const body = await dbValue(`SELECT body FROM "EmailLog" WHERE "to" = '${email}' ORDER BY "createdAt" DESC LIMIT 1`);
  const password = body.match(/Mot de passe temporaire : (\S+)/)?.[1];
  assert.ok(password, 'mot de passe temporaire introuvable dans l’email');
  return { id: r.id, email, password };
}

describe('Connexion', () => {
  test('mauvais mot de passe et compte inconnu : même refus 401', async () => {
    const bad = await SIDE('POST', '/auth/login', { email: 'admin@tcsay.tn', password: 'pas-le-bon-1' });
    const unknown = await SIDE('POST', '/auth/login', { email: `personne.${uid()}@exemple.tn`, password: 'pas-le-bon-1' });
    refused(bad, 401);
    refused(unknown, 401);
    assert.equal(bad.data.message, unknown.data.message, 'le message ne doit pas révéler si le compte existe');
  });

  test('identifiant vide refusé (400)', async () => {
    refused(await anon('POST', '/auth/login', { email: '', password: 'x' }), 400);
  });

  test('connexion par email : session de 12 h, « Rester connecté » : 30 jours', async () => {
    const short = ok(await anon('POST', '/auth/login', { email: 'admin@tcsay.tn', password: 'admin1234' }));
    const long = ok(await anon('POST', '/auth/login', { email: 'ADMIN@tcsay.tn ', password: 'admin1234', remember: true }));
    assert.equal(short.expiresIn, 12 * 3600);
    assert.equal(long.expiresIn, 30 * 24 * 3600);
    assert.ok(short.accessToken && long.accessToken);
  });

  test('connexion par CIN (Sana Ben Ali)', async () => {
    const r = await anon('POST', '/auth/login', { email: '08000201', password: 'temporaire' });
    // Le mot de passe a pu être changé par un passage précédent (helpers : NEW_PW) : l'un des deux doit marcher.
    const r2 = r.status === 200 ? r : await anon('POST', '/auth/login', { email: '08000201', password: 'Raquette2026x' });
    assert.ok(ok(r2).accessToken);
  });

  test('sans jeton ou avec un jeton falsifié : 401', async () => {
    refused(await anon('GET', '/auth/me'), 401);
    const admin = await as('admin');
    const forged = admin.token.slice(0, -4) + (admin.token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    refused(await client(forged, 'admin')('GET', '/auth/me'), 401);
  });

  test('profil connecté : le parent voit ses enfants, l’admin ses autorisations', async () => {
    const parent = await as('parent');
    const me = ok(await parent('GET', '/auth/me'));
    assert.equal(me.role, 'PARENT');
    assert.ok(me.players.some((p) => p.firstName === 'Lina'), 'Lina doit être dans les enfants de Sana');
    const admin = await as('admin');
    const am = ok(await admin('GET', '/auth/me'));
    assert.equal(am.space, 'admin');
    assert.ok(am.permissions.includes('permissions.manage'), 'le président a toutes les autorisations');
  });
});

describe('Première connexion et changement de mot de passe', { skip: !DB_URL && 'E2E_DATABASE_URL absent' }, () => {
  let admin, account, token;

  before(async () => {
    admin = await as('admin');
    account = await newParent(admin);
  });

  test('mot de passe temporaire : connexion avec changement obligatoire', async () => {
    const r = ok(await anon('POST', '/auth/login', { email: account.email, password: account.password }));
    assert.equal(r.mustChangePassword, true);
    token = r.accessToken;
  });

  test('tant que le mot de passe n’est pas changé : seules quelques routes répondent (403 ailleurs)', async () => {
    const c = client(token);
    ok(await c('GET', '/auth/me'), 'profil');
    const r = await c('GET', '/settings');
    refused(r, 403);
    assert.match(String(r.data.message), /mot de passe temporaire/i);
  });

  test('« Modifier plus tard » : accès ouvert, rappel du mot de passe temporaire', async () => {
    const c = client(token);
    ok(await c('POST', '/auth/change-password/later'));
    ok(await c('GET', '/settings'));
    const me = ok(await c('GET', '/auth/me'));
    assert.equal(me.mustChangePassword, false);
    assert.equal(me.temporaryPassword, true);
  });

  test('mot de passe trop simple refusé', async () => {
    const c = client(token);
    refused(await c('POST', '/auth/change-password', { newPassword: 'court1' }), 400);
    refused(await c('POST', '/auth/change-password', { newPassword: 'abcdefghijkl' }), 400, /lettre et un chiffre/);
    refused(await c('POST', '/auth/change-password', { newPassword: `Auth${account.email.split('.')[2]}99` }), 400);
  });

  test('mot de passe temporaire : changement sans l’ancien ; l’ancienne session est coupée', async () => {
    const r = ok(await client(token)('POST', '/auth/change-password', { newPassword: 'Filet2026court' }));
    assert.ok(r.accessToken, 'un nouveau jeton est rendu pour cette session');
    refused(await client(token)('GET', '/auth/me'), 401);
    ok(await client(r.accessToken)('GET', '/auth/me'));
    token = r.accessToken;
    refused(await anon('POST', '/auth/login', { email: account.email, password: account.password }), 401);
  });

  test('mot de passe définitif : l’ancien est exigé (mauvais = 400)', async () => {
    const c = (method, path, body) => SIDE(method, path, body, { token, espace: 'parent' });
    refused(await c('POST', '/auth/change-password', { newPassword: 'Volee2026revers' }), 400, /actuel incorrect/);
    refused(await c('POST', '/auth/change-password', { currentPassword: 'faux-123456', newPassword: 'Volee2026revers' }), 400);
    refused(await c('POST', '/auth/change-password', { currentPassword: 'Filet2026court', newPassword: 'Filet2026court' }), 400, /différent/);
    const r = ok(await c('POST', '/auth/change-password', { currentPassword: 'Filet2026court', newPassword: 'Volee2026revers' }));
    token = r.accessToken;
    ok(await anon('POST', '/auth/login', { email: account.email, password: 'Volee2026revers' }));
  });

  test('l’historique des actions garde le changement de mot de passe (sans le mot de passe)', async () => {
    const rows = await dbValue(`SELECT count(*) FROM "AuditLog" WHERE "entityId" = '${account.id}' AND action = 'Mot de passe changé'`);
    assert.ok(Number(rows) >= 2);
    const leak = await dbValue(`SELECT count(*) FROM "AuditLog" WHERE "entityId" = '${account.id}' AND (coalesce(before,'') || coalesce(after,'')) LIKE '%Volee2026%'`);
    assert.equal(Number(leak), 0, 'le mot de passe ne doit jamais apparaître dans l’audit');
  });

  describe('Mot de passe oublié', () => {
    test('réponse identique pour un compte connu ou inconnu', async () => {
      const known = ok(await SIDE('POST', '/auth/forgot-password', { email: account.email }));
      const unknown = ok(await SIDE('POST', '/auth/forgot-password', { email: `personne.${uid()}@exemple.tn` }));
      assert.deepEqual(known, unknown);
    });

    test('mauvais code refusé, bon code accepté, sessions coupées, code à usage unique', async () => {
      const code = await lastEmailCode(account.email);
      assert.ok(code, 'code introuvable dans l’email');
      const wrong = code === '000000' ? '111111' : '000000';
      refused(await SIDE('POST', '/auth/reset-password', { email: account.email, code: wrong, newPassword: 'Smash2026lifte' }), 400, /Code incorrect/);
      refused(await SIDE('POST', '/auth/reset-password', { email: account.email, code: '12', newPassword: 'Smash2026lifte' }), 400);
      ok(await anon('POST', '/auth/reset-password', { email: account.email, code, newPassword: 'Smash2026lifte' }));
      refused(await client(token)('GET', '/auth/me'), 401);
      ok(await anon('POST', '/auth/login', { email: account.email, password: 'Smash2026lifte' }));
      refused(await SIDE('POST', '/auth/reset-password', { email: account.email, code, newPassword: 'Autre2026balle' }), 400);
    });

    test('un nouveau code annule le précédent', async () => {
      ok(await SIDE('POST', '/auth/forgot-password', { email: account.email }));
      const first = await lastEmailCode(account.email);
      ok(await SIDE('POST', '/auth/forgot-password', { email: account.email }));
      const second = await lastEmailCode(account.email);
      if (first !== second) {
        refused(await SIDE('POST', '/auth/reset-password', { email: account.email, code: first, newPassword: 'Autre2026balle' }), 400);
      }
      ok(await anon('POST', '/auth/reset-password', { email: account.email, code: second, newPassword: 'Autre2026balle' }));
    });
  });
});

describe('Guide de première utilisation', () => {
  test('les étapes vues sont gardées sur le compte, sans doublon, et renvoyées par /auth/me', async () => {
    const parent = await as('parent');
    const step = `essai.${uid().toLowerCase()}`;
    const first = ok(await parent('POST', '/auth/guide', { steps: [step, 'famille.bienvenue'] }));
    assert.ok(first.guideSeen.includes(step));
    const again = ok(await parent('POST', '/auth/guide', { steps: [step] }));
    assert.equal(again.guideSeen.filter((s) => s === step).length, 1);
    const me = ok(await parent('GET', '/auth/me'));
    assert.ok(me.guideSeen.includes(step) && me.guideSeen.includes('famille.bienvenue'));
  });

  test('identifiant d’étape invalide refusé (400), connexion obligatoire (401)', async () => {
    const parent = await as('parent');
    refused(await parent('POST', '/auth/guide', { steps: ['<script>'] }), 400);
    refused(await anon('POST', '/auth/guide', { steps: ['famille.bienvenue'] }), 401);
  });
});
