// Test de bout en bout : événements (brouillon puis publication, audience, participation pour un enfant, places
// limitées « Complet », affichage seul, archivage, contrôle de version).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';
import { tinyPng } from './helpers-medias.mjs';

const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const event = (extra = {}) => ({
  title: `Événement ${uid()}`,
  date: inDays(10),
  startTime: '17:00',
  endTime: '19:00',
  place: 'Club-house',
  tag: 'Fête',
  audience: 'EVERYONE',
  rsvp: true,
  ...extra,
});

describe('Événements', () => {
  let agent, superviseur, parent, player, omar, sana, kids, yassine, lina;

  before(async () => {
    agent = await as('agent'); // events.manage
    superviseur = await as('superviseur');
    parent = await as('parent');
    player = await as('parent2');
    sana = ok(await parent('GET', '/auth/me'));
    omar = ok(await player('GET', '/auth/me')); // compte joueur : répond pour sa propre fiche
    kids = sana.players;
    yassine = kids.find((k) => k.firstName === 'Yassine');
    lina = kids.find((k) => k.firstName === 'Lina');
  });

  test('sans events.manage : création refusée (403)', async () => {
    refused(await superviseur('POST', '/events', event()), 403);
    refused(await parent('POST', '/events', event()), 403);
  });

  test('contrôles : groupe sans groupe choisi, fin avant début, personnes choisies vides', async () => {
    refused(await agent('POST', '/events', event({ audience: 'GROUPS' })), 400);
    refused(await agent('POST', '/events', event({ startTime: '19:00', endTime: '18:00' })), 400);
    refused(await agent('POST', '/events', event({ audience: 'CUSTOM' })), 400);
  });

  describe('brouillon pour un joueur choisi, places limitées', () => {
    let id, title;

    test('brouillon : invisible de la famille', async () => {
      const e = event({ audience: 'CUSTOM', playerIds: [yassine.id], capacity: 1 });
      title = e.title;
      id = ok(await agent('POST', '/events', e)).id;
      assert.ok(!ok(await parent('GET', '/events')).some((x) => x.id === id));
      refused(await parent('GET', `/events/${id}`), 404);
    });

    test('publication : la famille concernée est prévenue, pas les autres', async () => {
      const r = ok(await agent('POST', `/events/${id}/publish`));
      assert.ok(r.notified >= 1);
      refused(await agent('POST', `/events/${id}/publish`), 400);
      assert.ok(ok(await parent('GET', '/notifications')).some((n) => n.title.includes(title)));
      assert.ok(ok(await parent('GET', '/events')).some((x) => x.id === id));
      refused(await player('GET', `/events/${id}`), 404);
      refused(await player('POST', `/events/${id}/respond`, { going: true, playerId: omar.playerId }), 404);
    });

    test('le parent répond pour l’enfant invité seulement', async () => {
      const d = ok(await parent('GET', `/events/${id}`));
      assert.deepEqual(d.respondents.map((r) => r.playerId), [yassine.id]);
      refused(await parent('POST', `/events/${id}/respond`, { going: true, playerId: lina.id }), 403);
      ok(await parent('POST', `/events/${id}/respond`, { going: true, playerId: yassine.id }));
      const after = ok(await parent('GET', `/events/${id}`));
      assert.equal(after.going, 1);
      assert.equal(after.full, true, '1 place sur 1 : complet');
      const m = ok(await agent('GET', `/events/${id}`));
      assert.equal(m.responses.length, 1);
      assert.equal(m.responses[0].going, true);
    });

    test('places : impossible de descendre sous le nombre de participants', async () => {
      const d = ok(await agent('GET', `/events/${id}`));
      const body = { ...event({ audience: 'CUSTOM', playerIds: [yassine.id] }), title, capacity: 1, version: d.version };
      refused(await agent('PATCH', `/events/${id}`, { ...body, rsvp: true, capacity: 1, version: d.version + 5 }), 400, /R13/);
      ok(await agent('PATCH', `/events/${id}`, { ...body, capacity: 2 }));
    });

    test('archivé : disparaît pour la famille', async () => {
      ok(await agent('POST', `/events/${id}/archive`, {}));
      refused(await parent('GET', `/events/${id}`), 404);
      refused(await parent('POST', `/events/${id}/respond`, { going: false, playerId: yassine.id }), 404);
      ok(await agent('POST', `/events/${id}/archive`, { restore: true }));
      ok(await parent('GET', `/events/${id}`));
      ok(await agent('POST', `/events/${id}/archive`, {}));
    });
  });

  test('tout le club, 1 place : le 2e participant reçoit « Complet », libéré si le 1er se retire', async () => {
    const id = ok(await agent('POST', '/events', event({ capacity: 1, publish: true }))).id;
    ok(await player('POST', `/events/${id}/respond`, { going: true, playerId: omar.playerId }));
    refused(await parent('POST', `/events/${id}/respond`, { going: true, playerId: yassine.id }), 400);
    const msg = await parent('POST', `/events/${id}/respond`, { going: true, playerId: yassine.id });
    assert.match(String(msg.data.message), /Complet/);
    ok(await player('POST', `/events/${id}/respond`, { going: false, playerId: omar.playerId }));
    ok(await parent('POST', `/events/${id}/respond`, { going: true, playerId: yassine.id }));
    ok(await agent('POST', `/events/${id}/archive`, {}));
  });

  test('affichage seul : pas d’inscription', async () => {
    const id = ok(await agent('POST', '/events', event({ rsvp: false, publish: true }))).id;
    refused(await player('POST', `/events/${id}/respond`, { going: true, playerId: omar.playerId }), 400);
    ok(await agent('POST', `/events/${id}/archive`, {}));
  });

  test('affiche : image refusée si ce n’est pas une image, acceptée en PNG', async () => {
    const id = ok(await agent('POST', '/events', event({ rsvp: false }))).id;
    const bad = new FormData();
    bad.append('file', new Blob([Buffer.from('pas une image')], { type: 'image/png' }), 'x.png');
    refused(await agent('PUT', `/events/${id}/poster`, bad), 400);
    const good = new FormData();
    good.append('file', new Blob([tinyPng()], { type: 'image/png' }), 'affiche.png');
    ok(await agent('PUT', `/events/${id}/poster`, good));
    assert.ok(ok(await agent('GET', `/events/${id}`)).posterUrl);
    ok(await agent('POST', `/events/${id}/archive`, {}));
  });
});
