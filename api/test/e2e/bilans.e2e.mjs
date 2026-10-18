// Test de bout en bout : bilans de période (15 critères), niveau validé par la direction technique, partage aux familles.
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
// Lina Ben Ali est dans « Poussines F » (entraîneur Iheb) ; Adam Sassi n'est dans aucun groupe d'Iheb.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

describe('Bilans des joueurs et niveau', () => {
  let admin, dt, coach, parent, parent2, agent, lina, adam, poussines, evaluationId;
  const level = `Niveau E2E ${uid()}`;
  const scores = { forehand: 4, backhand: 3, serve: 3, footwork: 4, confidence: 5 };

  before(async () => {
    [admin, dt, coach, parent, parent2, agent] = await Promise.all([as('admin'), as('dt'), as('coach'), as('parent'), as('parent2'), as('agent')]);
    const players = ok(await admin('GET', '/players'));
    lina = players.find((p) => p.firstName === 'Lina' && p.lastName === 'Ben Ali');
    adam = players.find((p) => p.firstName === 'Adam');
    assert.ok(lina && adam, 'démo incomplète (relancer npm run db:demo)');
  });

  test('critères et périodes du bilan', async () => {
    const r = ok(await coach('GET', '/evaluations/criteria'));
    assert.equal(r.criteria.length, 15);
    assert.deepEqual(r.periods.map((p) => p.key), ['T1', 'T2', 'T3', 'ETE']);
  });

  test('l’entraîneur voit ses groupes, dont « Poussines F »', async () => {
    const r = ok(await coach('GET', '/evaluations/groups'));
    poussines = r.find((g) => g.name === 'Poussines F');
    assert.ok(poussines, 'groupe « Poussines F » attendu');
    const g = ok(await coach('GET', `/evaluations/group?groupId=${poussines.id}&period=ETE`));
    assert.ok(g.players.some((p) => p.id === lina.id));
  });

  test('l’entraîneur n’ouvre pas le groupe d’un autre entraîneur', async () => {
    const all = ok(await dt('GET', '/evaluations/groups'));
    const mine = ok(await coach('GET', '/evaluations/groups')).map((g) => g.id);
    const other = all.find((g) => !mine.includes(g.id));
    assert.ok(other);
    refused(await coach('GET', `/evaluations/group?groupId=${other.id}&period=T1`), 404);
  });

  test('notes invalides refusées (hors 1–5, critère inconnu, aucun critère, période inconnue)', async () => {
    refused(await coach('PUT', '/evaluations', { playerId: lina.id, period: 'ETE', scores: { forehand: 6 } }), 400);
    refused(await coach('PUT', '/evaluations', { playerId: lina.id, period: 'ETE', scores: { smash: 3 } }), 400);
    refused(await coach('PUT', '/evaluations', { playerId: lina.id, period: 'ETE', scores: {} }), 400);
    refused(await coach('PUT', '/evaluations', { playerId: lina.id, period: 'T9', scores }), 400);
  });

  test('l’entraîneur n’évalue pas un joueur hors de ses groupes', async () => {
    refused(await coach('PUT', '/evaluations', { playerId: adam.id, period: 'ETE', scores }), 403);
    refused(await coach('GET', `/evaluations/player?playerId=${adam.id}`), 403);
  });

  test('l’entraîneur rédige le bilan (non partagé) avec un niveau proposé', async () => {
    const r = ok(
      await coach('PUT', '/evaluations', {
        playerId: lina.id,
        period: 'ETE',
        scores,
        strengths: 'Coup droit régulier',
        toWork: 'Service',
        goals: 'Deuxième balle',
        proposedLevel: level,
        shared: false,
      }),
    );
    evaluationId = r.id;
    assert.equal(r.average, 3.8);
  });

  test('bilan non partagé : invisible du parent', async () => {
    const r = ok(await parent('GET', `/evaluations/player?playerId=${lina.id}`));
    assert.ok(!r.evaluations.some((e) => e.id === evaluationId));
  });

  test('l’entraîneur ne valide pas le niveau ; l’agent sans droit « suivi technique » non plus', async () => {
    refused(await coach('POST', `/evaluations/${evaluationId}/validate-level`), 403);
    refused(await agent('POST', `/evaluations/${evaluationId}/validate-level`), 403);
  });

  test('la direction technique valide le niveau : il devient celui du joueur', async () => {
    const r = ok(await dt('POST', `/evaluations/${evaluationId}/validate-level`));
    assert.equal(r.level, level);
    const p = ok(await dt('GET', `/evaluations/player?playerId=${lina.id}`));
    assert.equal(p.level, level);
    const e = p.evaluations.find((x) => x.id === evaluationId);
    assert.equal(e.levelValidated, true);
    assert.ok(e.levelValidatedBy);
  });

  test('niveau proposé modifié : à valider de nouveau ; partagé : visible et notifié au parent', async () => {
    ok(await coach('PUT', '/evaluations', { playerId: lina.id, period: 'ETE', scores, proposedLevel: `${level} +`, shared: true }));
    const p = ok(await parent('GET', `/evaluations/player?playerId=${lina.id}`));
    const e = p.evaluations.find((x) => x.id === evaluationId);
    assert.ok(e, 'bilan partagé visible du parent');
    assert.equal(e.levelValidated, false);
    assert.equal(p.level, level, 'le niveau du joueur reste l’ancien tant que la direction n’a pas validé');
    const notes = ok(await parent('GET', '/notifications'));
    assert.ok(notes.some((n) => n.title === 'Bilan de Lina Ben Ali disponible'));
  });

  test('un autre parent ne voit pas les bilans de Lina', async () => {
    refused(await parent2('GET', `/evaluations/player?playerId=${lina.id}`), 403);
  });

  test('validation d’un bilan inconnu : 404', async () => {
    refused(await dt('POST', '/evaluations/00000000-0000-4000-8000-000000000000/validate-level'), 404);
  });
});
