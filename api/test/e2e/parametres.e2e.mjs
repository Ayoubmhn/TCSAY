// Test de bout en bout : Paramètres du club (réservation), photos de profil (adresse signée, droits du parent),
// compte fédération IJIN (chiffré, relu par son seul propriétaire) et accueil joueur / parent.
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { API, as, ok, refused, uid } from './helpers.mjs';

/** Image PNG minimale (le type est vérifié sur les premiers octets). */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const form = (buf, name = 'photo.png', type = 'image/png') => {
  const f = new FormData();
  f.append('file', new Blob([buf], { type }), name);
  return f;
};

describe('Paramètres du club', () => {
  let admin, parent, coach, before_;

  before(async () => {
    [admin, parent, coach] = await Promise.all(['admin', 'parent', 'coach'].map(as));
    before_ = ok(await admin('GET', '/settings'));
  });

  after(async () => {
    if (before_) await admin('PATCH', '/settings/cancelDelayHours', { value: before_.cancelDelayHours });
  });

  test('tout compte connecté lit les paramètres', async () => {
    for (const c of [parent, coach]) {
      const s = ok(await c('GET', '/settings'));
      assert.equal(typeof s.nightStartHour, 'number');
      assert.equal(typeof s.cancelDelayHours, 'number');
    }
  });

  test('l’admin change le délai d’annulation ; parent et coach ne peuvent pas (403)', async () => {
    const value = before_.cancelDelayHours === 24 ? 48 : 24;
    const r = ok(await admin('PATCH', '/settings/cancelDelayHours', { value }));
    assert.equal(r.cancelDelayHours, value);
    assert.equal(ok(await parent('GET', '/settings')).cancelDelayHours, value);
    refused(await parent('PATCH', '/settings/cancelDelayHours', { value: 1 }), 403);
    refused(await coach('PATCH', '/settings/cancelDelayHours', { value: 1 }), 403);
  });

  test('valeur hors limites, non entière ou paramètre inconnu refusés', async () => {
    refused(await admin('PATCH', '/settings/cancelDelayHours', { value: 500 }), 400);
    refused(await admin('PATCH', '/settings/cancelDelayHours', { value: 2.5 }), 400);
    refused(await admin('PATCH', '/settings/cancelDelayHours', { value: '12' }), 400);
    refused(await admin('PATCH', `/settings/inconnu${uid()}`, { value: 3 }), 404);
  });
});

describe('Photos de profil', () => {
  let admin, parent, parent2, coach, lina, other;

  before(async () => {
    [admin, parent, parent2, coach] = await Promise.all(['admin', 'parent', 'parent2', 'coach'].map(as));
    const me = ok(await parent('GET', '/auth/me'));
    lina = me.players.find((p) => p.firstName === 'Lina');
    assert.ok(lina, 'Lina doit être une enfant de Sana');
    const players = ok(await admin('GET', '/players'));
    other = players.find((p) => !me.players.some((k) => k.id === p.id));
  });

  after(async () => {
    if (lina) await parent('DELETE', `/photos/players/${lina.id}`);
    await coach('DELETE', '/photos/me');
  });

  test('chacun change la sienne : adresse signée, image servie avec son type', async () => {
    const r = ok(await coach('PUT', '/photos/me', form(PNG)));
    assert.match(r.photoUrl, /^\/photos\/[0-9a-f-]+\?v=.+&e=\d+&s=.+/);
    const res = await fetch(API + r.photoUrl);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await res.arrayBuffer()).length, PNG.length);
  });

  test('adresse modifiée (signature ou expiration) : 404', async () => {
    const { photoUrl } = ok(await coach('GET', '/auth/me'));
    assert.ok(photoUrl);
    const badSig = photoUrl.replace(/s=([^&]+)/, (_m, s) => `s=${s.slice(0, -2)}xx`);
    assert.equal((await fetch(API + badSig)).status, 404);
    const later = photoUrl.replace(/e=(\d+)/, (_m, e) => `e=${Number(e) + 86_400_000}`);
    assert.equal((await fetch(API + later)).status, 404);
  });

  test('fichier qui n’est pas une image, vide ou trop lourd : refusé', async () => {
    refused(await coach('PUT', '/photos/me', form(Buffer.from('<?php echo 1; ?>'), 'photo.png')), 400);
    refused(await coach('PUT', '/photos/me', new FormData()), 400);
    const big = Buffer.concat([PNG, Buffer.alloc(401 * 1024)]);
    refused(await coach('PUT', '/photos/me', form(big)));
  });

  test('le parent change la photo de son enfant, pas celle d’un autre joueur', async () => {
    const r = ok(await parent('PUT', `/photos/players/${lina.id}`, form(PNG)));
    assert.ok(r.photoUrl);
    refused(await parent2('PUT', `/photos/players/${lina.id}`, form(PNG)), 403);
    if (other) refused(await parent('PUT', `/photos/players/${other.id}`, form(PNG)), 403);
    refused(await coach('PUT', `/photos/players/${lina.id}`, form(PNG)), 403);
  });

  test('retirer une photo', async () => {
    assert.equal(ok(await coach('DELETE', '/photos/me')).photoUrl, null);
    assert.equal(ok(await coach('GET', '/auth/me')).photoUrl, null);
  });
});

describe('Compte fédération IJIN', () => {
  let admin, agent, parent, parent2, coach, lina;

  before(async () => {
    [admin, agent, parent, parent2, coach] = await Promise.all(['admin', 'agent', 'parent', 'parent2', 'coach'].map(as));
    lina = ok(await parent('GET', '/auth/me')).players.find((p) => p.firstName === 'Lina');
  });

  after(async () => {
    await coach('PUT', '/me/federation', { login: '' });
    if (lina) await admin('PUT', '/federation/accounts', { kind: 'player', id: lina.id, login: '' });
  });

  test('chacun enregistre le sien, le mot de passe n’est relu que par lui', async () => {
    const r = ok(await coach('PUT', '/me/federation', { login: 'ijin.test', password: 'Secret-IJIN-1' }));
    assert.deepEqual(r, { login: 'ijin.test', hasPassword: true });
    assert.deepEqual(ok(await coach('GET', '/me/federation')), { login: 'ijin.test', hasPassword: true });
    assert.equal(ok(await coach('POST', '/me/federation/reveal')).password, 'Secret-IJIN-1');
    // Un autre compte relit seulement le sien (aucun mot de passe enregistré).
    refused(await parent2('POST', '/me/federation/reveal'), 400);
  });

  test('identifiant vide : compte fédération supprimé', async () => {
    assert.deepEqual(ok(await coach('PUT', '/me/federation', { login: '' })), { login: null, hasPassword: false });
  });

  test('le club enregistre l’IJIN d’un joueur sans compte : ses parents le relisent, pas les autres', async () => {
    ok(await agent('PUT', '/federation/accounts', { kind: 'player', id: lina.id, login: 'lina.ijin', password: 'Lina-IJIN-2026' }));
    const listed = ok(await agent('GET', '/federation/accounts?q=Lina')).find((x) => x.id === lina.id);
    assert.equal(listed.login, 'lina.ijin');
    assert.equal(listed.hasPassword, true);
    assert.equal(listed.password, undefined, 'le club ne relit jamais le mot de passe');
    const kid = ok(await parent('GET', '/me/federation/kids')).find((k) => k.playerId === lina.id);
    assert.equal(kid.login, 'lina.ijin');
    assert.equal(ok(await parent('POST', `/me/federation/kids/${lina.id}/reveal`)).password, 'Lina-IJIN-2026');
    refused(await parent2('POST', `/me/federation/kids/${lina.id}/reveal`), 403);
  });

  test('sans l’autorisation « IJIN » : 403', async () => {
    refused(await coach('GET', '/federation/accounts'), 403);
    refused(await parent('PUT', '/federation/accounts', { kind: 'player', id: lina.id, login: 'x' }), 403);
  });
});

describe('Accueil joueur / parent', () => {
  let parent, coach, admin, lina, other;

  before(async () => {
    [parent, coach, admin] = await Promise.all(['parent', 'coach', 'admin'].map(as));
    const me = ok(await parent('GET', '/auth/me'));
    lina = me.players.find((p) => p.firstName === 'Lina');
    other = ok(await admin('GET', '/players')).find((p) => !me.players.some((k) => k.id === p.id));
  });

  test('le parent voit l’accueil de son enfant', async () => {
    const r = ok(await parent('GET', `/me/overview?playerId=${lina.id}`));
    assert.equal(r.player.id, lina.id);
    assert.equal(typeof r.dueAmount, 'number');
  });

  test('pas l’accueil d’un enfant qui n’est pas le sien ; refusé au coach', async () => {
    if (other) refused(await parent('GET', `/me/overview?playerId=${other.id}`), 403);
    refused(await coach('GET', '/me/overview'), 403);
    refused(await parent('GET', '/me/overview?playerId=pas-un-uuid'), 400);
  });
});
