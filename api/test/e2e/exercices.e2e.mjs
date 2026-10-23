// Test de bout en bout : exercices (bibliothèque, exercice donné à un groupe ou à un joueur, « Marquer fait »).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
// L'entraîneur Iheb anime « Poussines F » (Lina Ben Ali) ; Adam Sassi n'est dans aucun de ses groupes.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, login, ok, refused, uid } from './helpers.mjs';
import { openAccess } from './helpers-paiements.mjs';

const today = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10); // heure du club (UTC+1)
const inDays = (n) => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('Exercices', () => {
  let admin, dt, coach, otherCoach, parent, parent2, agent, lina, yassine, adam, poussines;
  let exerciseId, groupAssignment, playerAssignment;
  const title = `Gainage E2E ${uid()}`;

  let restoreAccess = async () => {};

  before(async () => {
    [admin, dt, coach, parent, parent2, agent] = await Promise.all([as('admin'), as('dt'), as('coach'), as('parent'), as('parent2'), as('agent')]);
    otherCoach = await login('dt@tcsay.tn', 'temporaire', 'coach'); // le directeur technique, dans son espace entraîneur
    const players = ok(await admin('GET', '/players'));
    lina = players.find((p) => p.firstName === 'Lina' && p.lastName === 'Ben Ali');
    yassine = players.find((p) => p.firstName === 'Yassine' && p.lastName === 'Ben Ali');
    adam = players.find((p) => p.firstName === 'Adam');
    poussines = ok(await coach('GET', '/evaluations/groups')).find((g) => g.name === 'Poussines F');
    assert.ok(lina && yassine && adam && poussines, 'démo incomplète (relancer npm run db:demo)');
    restoreAccess = await openAccess(admin, parent, [lina]);
  });

  after(async () => {
    await restoreAccess();
  });

  test('création : champs obligatoires et lien vidéo en https', async () => {
    refused(await coach('POST', '/exercises', { title: '', kind: 'PHYSICAL', instructions: 'x' }), 400);
    refused(await coach('POST', '/exercises', { title, kind: 'YOGA', instructions: 'x' }), 400);
    refused(await coach('POST', '/exercises', { title, kind: 'PHYSICAL', instructions: 'x', videoUrl: 'http://exemple.tn/v' }), 400);
  });

  test('l’entraîneur crée un exercice : il apparaît dans la bibliothèque', async () => {
    exerciseId = ok(
      await coach('POST', '/exercises', {
        title,
        kind: 'PHYSICAL',
        durationMin: 10,
        instructions: '3 séries de 30 secondes',
        videoUrl: 'https://exemple.tn/video',
      }),
    ).id;
    const list = ok(await coach('GET', '/exercises'));
    const e = list.find((x) => x.id === exerciseId);
    assert.ok(e);
    assert.equal(e.mine, true);
    assert.equal(e.author, 'Iheb');
  });

  test('sans l’autorisation « suivi technique », l’agent n’ouvre pas la bibliothèque', async () => {
    refused(await agent('GET', '/exercises'), 403);
  });

  test('un autre entraîneur ne modifie pas l’exercice ; la direction technique oui', async () => {
    const body = { title, kind: 'PHYSICAL', durationMin: 12, instructions: '3 séries de 40 secondes' };
    refused(await otherCoach('PATCH', `/exercises/${exerciseId}`, body), 403);
    ok(await dt('PATCH', `/exercises/${exerciseId}`, body));
    assert.equal(ok(await coach('GET', '/exercises')).find((x) => x.id === exerciseId).durationMin, 12);
  });

  test('donner : un groupe OU un joueur, échéance passée refusée, pas les groupes des autres', async () => {
    refused(await coach('POST', `/exercises/${exerciseId}/assign`, {}), 400);
    refused(await coach('POST', `/exercises/${exerciseId}/assign`, { groupId: poussines.id, playerId: lina.id }), 400);
    refused(await coach('POST', `/exercises/${exerciseId}/assign`, { groupId: poussines.id, dueDate: inDays(-2) }), 400);
    refused(await coach('POST', `/exercises/${exerciseId}/assign`, { playerId: adam.id }), 403);
    const all = ok(await dt('GET', '/evaluations/groups'));
    const mine = ok(await coach('GET', '/evaluations/groups')).map((g) => g.id);
    const other = all.find((g) => !mine.includes(g.id));
    refused(await coach('POST', `/exercises/${exerciseId}/assign`, { groupId: other.id }), 403);
  });

  test('l’entraîneur donne l’exercice au groupe et à Lina ; la famille est prévenue', async () => {
    groupAssignment = ok(await coach('POST', `/exercises/${exerciseId}/assign`, { groupId: poussines.id, dueDate: inDays(7), note: 'Avant samedi' }));
    assert.ok(groupAssignment.players >= 1);
    playerAssignment = ok(await coach('POST', `/exercises/${exerciseId}/assign`, { playerId: lina.id }));
    assert.equal(playerAssignment.players, 1);
    const notes = ok(await parent('GET', '/notifications'));
    assert.ok(notes.some((n) => n.title === `Nouvel exercice : ${title}`));
  });

  test('le parent voit l’exercice de Lina, pas celui d’un enfant d’une autre famille', async () => {
    const r = ok(await parent('GET', `/exercises/mine?playerId=${lina.id}`));
    const a = r.find((x) => x.id === groupAssignment.id);
    assert.ok(a, 'exercice du groupe attendu');
    assert.equal(a.dueDate, inDays(7));
    assert.equal(a.doneAt, null);
    refused(await parent('GET', `/exercises/mine?playerId=${adam.id}`), 403);
  });

  test('« Marquer fait » : refusé pour un enfant non concerné ou d’une autre famille', async () => {
    refused(await parent('PUT', `/exercises/assignments/${playerAssignment.id}/done`, { playerId: yassine.id, done: true }), 403);
    refused(await parent2('PUT', `/exercises/assignments/${playerAssignment.id}/done`, { playerId: lina.id, done: true }), 403);
  });

  test('le parent marque l’exercice fait : l’entraîneur le voit', async () => {
    ok(await parent('PUT', `/exercises/assignments/${groupAssignment.id}/done`, { playerId: lina.id, done: true }));
    ok(await parent('PUT', `/exercises/assignments/${groupAssignment.id}/done`, { playerId: lina.id, done: true }), 'deux fois sans erreur');
    const mine = ok(await parent('GET', `/exercises/mine?playerId=${lina.id}`)).find((x) => x.id === groupAssignment.id);
    assert.ok(mine.doneAt);
    const given = ok(await coach('GET', '/exercises/assignments')).find((x) => x.id === groupAssignment.id);
    assert.equal(given.done, 1);
    assert.ok(!given.missing.includes('Lina Ben Ali'));
  });

  test('« Pas fait » : retiré', async () => {
    ok(await parent('PUT', `/exercises/assignments/${groupAssignment.id}/done`, { playerId: lina.id, done: false }));
    const given = ok(await coach('GET', '/exercises/assignments')).find((x) => x.id === groupAssignment.id);
    assert.equal(given.done, 0);
  });

  test('l’entraîneur ne voit que les exercices qu’il a donnés', async () => {
    const r = ok(await otherCoach('GET', '/exercises/assignments'));
    assert.ok(!r.some((x) => x.id === groupAssignment.id));
  });

  test('archivage (R8) : sorti de la bibliothèque, toujours visible de la famille', async () => {
    refused(await otherCoach('POST', `/exercises/${exerciseId}/archive`), 403);
    ok(await coach('POST', `/exercises/${exerciseId}/archive`));
    assert.ok(!ok(await coach('GET', '/exercises')).some((x) => x.id === exerciseId));
    refused(await coach('POST', `/exercises/${exerciseId}/assign`, { playerId: lina.id }), 404);
    assert.ok(ok(await parent('GET', `/exercises/mine?playerId=${lina.id}`)).some((x) => x.id === groupAssignment.id));
  });
});
