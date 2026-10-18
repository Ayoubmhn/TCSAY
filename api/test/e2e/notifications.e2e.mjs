// Test de bout en bout : notifications (cloche) et messages du club (aperçu, envoi, exclusions, droit notifications.send).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

describe('Messages du club et cloche', () => {
  let admin, agent, superviseur, dt, parent, player, coach, sana, omar, title;

  before(async () => {
    admin = await as('admin');
    agent = await as('agent');
    superviseur = await as('superviseur');
    dt = await as('dt');
    parent = await as('parent');
    player = await as('parent2');
    coach = await as('coach');
    sana = ok(await parent('GET', '/auth/me'));
    omar = ok(await player('GET', '/auth/me'));
    title = `Message test ${uid()}`;
  });

  test('sans notifications.send : superviseur et directeur technique refusés (403)', async () => {
    refused(await superviseur('POST', '/notifications/broadcasts/preview', { roles: ['PARENTS'] }), 403);
    refused(await dt('POST', '/notifications/broadcasts', { title: 'x', body: 'y', target: 'PARENTS' }), 403);
    refused(await dt('GET', '/notifications/broadcasts'), 403);
  });

  test('famille et entraîneur ne voient pas l’envoi (403)', async () => {
    refused(await parent('GET', '/notifications/broadcasts'), 403);
    refused(await coach('POST', '/notifications/broadcasts/preview', { roles: ['PARENTS'] }), 403);
  });

  test('aperçu : nombre de destinataires et libellé, exclusion d’une personne', async () => {
    const all = ok(await agent('POST', '/notifications/broadcasts/preview', { roles: ['PARENTS'] }));
    assert.ok(all.recipients >= 1);
    assert.match(all.audience, /parents/i);
    const minus = ok(await agent('POST', '/notifications/broadcasts/preview', { roles: ['PARENTS'], excludeUserIds: [sana.id] }));
    assert.equal(minus.recipients, all.recipients - 1);
    assert.match(minus.audience, /sauf/);
    const none = ok(await agent('POST', '/notifications/broadcasts/preview', {}));
    assert.equal(none.recipients, 0);
  });

  test('titre et message obligatoires ; envoi sans destinataire refusé', async () => {
    refused(await agent('POST', '/notifications/broadcasts', { title: '', body: 'Corps', userIds: [sana.id] }), 400);
    refused(await agent('POST', '/notifications/broadcasts', { title: 'Titre', body: '', userIds: [sana.id] }), 400);
    refused(await agent('POST', '/notifications/broadcasts', { title: 'Titre', body: 'Corps' }), 400);
  });

  test('l’agent envoie à des personnes choisies : seules elles le reçoivent', async () => {
    const r = ok(await agent('POST', '/notifications/broadcasts', { title, body: 'Entraînement annulé (test E2E).', userIds: [sana.id] }));
    assert.equal(r.recipients, 1);
    const hist = ok(await agent('GET', '/notifications/broadcasts'));
    assert.ok(hist.some((b) => b.id === r.id && b.recipients === 1));

    const mine = ok(await parent('GET', '/notifications'));
    assert.ok(mine.some((n) => n.title === title), 'Sana reçoit le message');
    const other = ok(await player('GET', '/notifications'));
    assert.ok(!other.some((n) => n.title === title), 'Omar ne le reçoit pas');
  });

  test('cloche : non lues, lecture d’une notification puis « tout lire »', async () => {
    const before = ok(await parent('GET', '/notifications/count')).unread;
    assert.ok(before >= 1);
    const n = ok(await parent('GET', '/notifications?filter=unread')).find((x) => x.title === title);
    assert.ok(n);
    ok(await parent('POST', `/notifications/${n.id}/read`));
    assert.equal(ok(await parent('GET', '/notifications/count')).unread, before - 1);
    ok(await parent('POST', '/notifications/read-all'));
    assert.equal(ok(await parent('GET', '/notifications/count')).unread, 0);
  });

  test('on ne lit pas la notification d’un autre compte', async () => {
    const t2 = `${title} B`;
    ok(await admin('POST', '/notifications/broadcasts', { title: t2, body: 'Pour Omar.', userIds: [omar.id] }));
    const n = ok(await player('GET', '/notifications')).find((x) => x.title === t2);
    ok(await parent('POST', `/notifications/${n.id}/read`)); // sans effet pour un autre compte
    const again = ok(await player('GET', '/notifications')).find((x) => x.id === n.id);
    assert.equal(again.readAt, null, 'la notification d’Omar reste non lue');
  });

  test('envoi à tous les entraîneurs : l’entraîneur le reçoit, pas les parents', async () => {
    const t3 = `${title} coachs`;
    const r = ok(await agent('POST', '/notifications/broadcasts', { title: t3, body: 'Réunion technique.', target: 'COACHES' }));
    assert.ok(r.recipients >= 1);
    assert.ok(ok(await coach('GET', '/notifications')).some((n) => n.title === t3));
    assert.ok(!ok(await parent('GET', '/notifications')).some((n) => n.title === t3));
  });
});
