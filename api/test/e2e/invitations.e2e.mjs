// Test de bout en bout : invitation d'un parent (lien personnel, page publique « Bienvenue », email vérifié par code,
// compte activé). Base de DÉMONSTRATION uniquement ; le code envoyé par email est lu dans la base de démo
// (E2E_DATABASE_URL), sans elle ce scénario est ignoré.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { API, anon, as, ok, refused, uid } from './helpers.mjs';
import { DB_URL, fromIp, lastEmailCode } from './helpers-auth.mjs';

const SIDE = fromIp(10 + Math.floor(Math.random() * 200));

describe('Invitation d’un parent', { skip: !DB_URL && 'E2E_DATABASE_URL absent' }, () => {
  let admin, coach, parent, token, newEmail, cin;

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    const id = uid();
    // Parent créé par le club (compte de test), puis invité à confirmer ses coordonnées.
    parent = ok(
      await admin('POST', '/parents', {
        firstName: 'Invite',
        lastName: `Parent${id}`,
        email: `e2e.invite.${id}@exemple.tn`,
        phone: '+216 20 000 002',
        cin: String(Math.floor(10_000_000 + Math.random() * 89_999_999)),
      }),
    );
    newEmail = `e2e.verifie.${id}@exemple.tn`;
    cin = String(Math.floor(10_000_000 + Math.random() * 89_999_999));
  });

  test('l’entraîneur ne peut pas inviter un parent (403)', async () => {
    refused(await coach('POST', `/parents/${parent.id}/invitation`), 403);
  });

  test('un nouveau lien remplace le précédent', async () => {
    const first = ok(await admin('POST', `/parents/${parent.id}/invitation`));
    const second = ok(await admin('POST', `/parents/${parent.id}/invitation`));
    assert.notEqual(first.token, second.token);
    refused(await anon('GET', `/invitations/${first.token}`), 410);
    token = second.token;
    assert.ok(new Date(second.expiresAt) > new Date(Date.now() + 13 * 86_400_000), 'lien valable 14 jours');
  });

  test('page publique : coordonnées connues, jamais le mot de passe', async () => {
    const r = ok(await anon('GET', `/invitations/${token}`));
    assert.equal(r.firstName, 'Invite');
    assert.equal(r.passwordHash, undefined);
    refused(await anon('GET', `/invitations/jeton-inconnu-${uid()}`), 404);
  });

  test('email d’un autre compte refusé ; email valide : code envoyé', async () => {
    refused(await anon('POST', `/invitations/${token}/email-code`, { email: 'admin@tcsay.tn' }), 400, /déjà utilisé/);
    refused(await anon('POST', `/invitations/${token}/email-code`, { email: 'pas-un-email' }), 400);
    const r = ok(await anon('POST', `/invitations/${token}/email-code`, { email: newEmail }));
    assert.equal(r.sentTo, newEmail);
  });

  test('mauvais code et mot de passe faible refusés', async () => {
    const code = await lastEmailCode(newEmail);
    assert.ok(code, 'code introuvable dans l’email');
    const base = { email: newEmail, phone: '+216 20 111 222', cin };
    refused(await SIDE('POST', `/invitations/${token}/complete`, { ...base, code: code === '000000' ? '111111' : '000000', password: 'Revers2026plat' }), 400, /Code incorrect/);
    refused(await anon('POST', `/invitations/${token}/complete`, { ...base, code, password: 'court' }), 400);
    refused(await anon('POST', `/invitations/${token}/complete`, { ...base, cin: '12', code, password: 'Revers2026plat' }), 400);
  });

  test('coordonnées vérifiées : compte activé, session ouverte, email remplacé', async () => {
    const code = await lastEmailCode(newEmail);
    const r = ok(await anon('POST', `/invitations/${token}/complete`, { email: newEmail, phone: '+216 20 111 222', cin, code, password: 'Revers2026plat' }));
    assert.ok(r.accessToken);
    const res = await fetch(`${API}/auth/me`, { headers: { authorization: `Bearer ${r.accessToken}`, 'x-espace': 'parent' } });
    const me = await res.json();
    assert.equal(res.status, 200);
    assert.equal(me.email, newEmail);
    assert.equal(me.mustChangePassword, false);
    ok(await anon('POST', '/auth/login', { email: newEmail, password: 'Revers2026plat' }), 'connexion avec le nouveau mot de passe');
    ok(await anon('POST', '/auth/login', { email: cin, password: 'Revers2026plat' }), 'connexion avec la CIN');
  });

  test('le lien ne sert qu’une fois (410)', async () => {
    refused(await anon('GET', `/invitations/${token}`), 410);
  });

  test('liste des parents : « Coordonnées reçues »', async () => {
    const list = ok(await admin('GET', '/parents'));
    const p = list.find((x) => x.id === parent.id);
    assert.equal(p.email, newEmail);
    assert.equal(p.invitation?.completed, true);
  });
});
