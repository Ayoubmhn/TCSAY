// Test de bout en bout : albums photos (droits de création, audience, envoi, autorisation photo, identification,
// retrait par la famille, « Prévenir », contrôle de version).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';
import { tinyJpeg, tinyPng } from './helpers-medias.mjs';

const today = () => new Date().toISOString().slice(0, 10);
const album = (extra = {}) => ({ title: `Album ${uid()}`, kind: 'FREE', audience: 'EVERYONE', date: today(), ...extra });
const photo = (thumb = true) => {
  const f = new FormData();
  f.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'photo.png');
  if (thumb) f.append('thumb', new Blob([tinyJpeg()], { type: 'image/jpeg' }), 'thumb.jpg');
  f.append('width', '4');
  f.append('height', '4');
  return f;
};

describe('Albums photos', () => {
  let admin, agent, coach, parent, player, yassine;

  before(async () => {
    admin = await as('admin'); // albums.manage, permissions.manage
    agent = await as('agent'); // sans albums.manage
    coach = await as('coach');
    parent = await as('parent');
    player = await as('parent2');
    yassine = ok(await parent('GET', '/auth/me')).players.find((p) => p.firstName === 'Yassine');
  });

  test('création : famille refusée, entraîneur refusé pour « tout le club »', async () => {
    refused(await parent('POST', '/albums', album()), 403);
    refused(await coach('POST', '/albums', album()), 403);
    refused(await admin('POST', '/albums', album({ kind: 'GROUP' })), 400); // contexte obligatoire
    refused(await admin('POST', '/albums', album({ audience: 'CUSTOM' })), 400); // personne choisie obligatoire
  });

  test('audience « personnes choisies » : seule la famille du joueur choisi voit l’album', async () => {
    const id = ok(await admin('POST', '/albums', album({ audience: 'CUSTOM', playerIds: [yassine.id] }))).id;
    ok(await parent('GET', `/albums/${id}`));
    assert.ok(ok(await parent('GET', '/albums')).albums.some((a) => a.id === id));
    refused(await player('GET', `/albums/${id}`), 404);
    assert.ok(!ok(await player('GET', '/albums')).albums.some((a) => a.id === id));
    // La famille ne gère pas l'album.
    refused(await parent('POST', `/albums/${id}/photos`, photo()), 403);
    ok(await admin('POST', `/albums/${id}/archive`, {}));
    refused(await parent('GET', `/albums/${id}`), 404);
  });

  describe('photo d’un joueur identifié (tout le club)', () => {
    let id, photoId;

    before(async () => {
      // Règle du club inchangée (lue) ; la famille répond explicitement pour Yassine.
      ok(await parent('PUT', `/albums/consent/${yassine.id}`, { consent: false }));
    });

    test('envoi : vignette obligatoire, puis photo ajoutée', async () => {
      id = ok(await admin('POST', '/albums', album())).id;
      refused(await admin('POST', `/albums/${id}/photos`, photo(false)), 400);
      photoId = ok(await admin('POST', `/albums/${id}/photos`, photo())).id;
      assert.ok(photoId);
    });

    test('« Prévenir » : l’audience est notifiée, une seule fois par lot', async () => {
      const r = ok(await admin('POST', `/albums/${id}/notify`));
      assert.equal(r.photos, 1);
      assert.ok(r.notified >= 1);
      refused(await admin('POST', `/albums/${id}/notify`), 400);
    });

    test('l’autorisation photo se règle par la famille seulement', async () => {
      refused(await player('PUT', `/albums/consent/${yassine.id}`, { consent: true }), 403);
      const c = ok(await parent('GET', '/albums/consent'));
      assert.equal(c.players.find((p) => p.id === yassine.id).consent, false);
    });

    test('joueur identifié sans autorisation : photo visible de sa famille et de la direction seulement', async () => {
      ok(await admin('PUT', `/albums/${id}/photos/${photoId}/tags`, { playerIds: [yassine.id], caption: 'Remise des prix' }));
      const mode = ok(await admin('GET', `/albums/${id}`)).mode;
      const seenByOther = ok(await player('GET', `/albums/${id}`)).photos.some((p) => p.id === photoId);
      // OPT_IN (défaut) comme OPT_OUT : un refus explicite cache la photo aux autres familles.
      assert.equal(seenByOther, false, `règle ${mode} : photo cachée à une autre famille`);
      const fam = ok(await parent('GET', `/albums/${id}`)).photos.find((p) => p.id === photoId);
      assert.ok(fam, 'la famille voit la photo de son enfant');
      assert.equal(fam.mine, true);
      const dir = ok(await admin('GET', `/albums/${id}`)).photos.find((p) => p.id === photoId);
      assert.ok(dir.withoutConsent.length >= 1, 'la direction voit qu’il manque l’autorisation');
    });

    test('autorisation accordée : la photo devient visible de tout le club', async () => {
      ok(await parent('PUT', `/albums/consent/${yassine.id}`, { consent: true }));
      assert.ok(ok(await player('GET', `/albums/${id}`)).photos.some((p) => p.id === photoId));
    });

    test('retrait : refusé à une autre famille, immédiat pour la famille du joueur, direction prévenue', async () => {
      refused(await player('POST', `/albums/${id}/photos/${photoId}/hide`, {}), 403);
      ok(await parent('POST', `/albums/${id}/photos/${photoId}/hide`, {}));
      assert.ok(!ok(await player('GET', `/albums/${id}`)).photos.some((p) => p.id === photoId));
      assert.ok(!ok(await parent('GET', `/albums/${id}`)).photos.some((p) => p.id === photoId));
      const dir = ok(await admin('GET', `/albums/${id}`)).photos.find((p) => p.id === photoId);
      assert.equal(dir.hidden, 'Retirée à la demande de la famille');
      assert.ok(ok(await admin('GET', '/notifications')).some((n) => n.title === 'Photo retirée à la demande d’une famille'));
    });

    test('la direction remet la photo en ligne ; la famille ne le peut pas', async () => {
      refused(await parent('POST', `/albums/${id}/photos/${photoId}/restore`), 403);
      ok(await admin('POST', `/albums/${id}/photos/${photoId}/restore`));
      assert.ok(ok(await player('GET', `/albums/${id}`)).photos.some((p) => p.id === photoId));
    });

    test('R13 : modification avec une version périmée refusée', async () => {
      const a = ok(await admin('GET', `/albums/${id}`));
      refused(await admin('PATCH', `/albums/${id}`, { ...album(), title: a.title, version: a.version + 4 }), 400, /R13/);
      ok(await admin('PATCH', `/albums/${id}`, { ...album(), title: `${a.title} (modifié)`, version: a.version }));
      ok(await admin('POST', `/albums/${id}/archive`, {}));
    });
  });

  test('règle des photos : réservée au président (permissions.manage)', async () => {
    refused(await agent('PUT', '/albums/settings', { mode: 'OPT_OUT' }), 403);
  });
});
