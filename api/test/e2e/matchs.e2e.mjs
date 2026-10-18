// Test de bout en bout : matchs suivis point par point (création par tout acteur, droits de saisie, score recalculé,
// annulation du dernier point, abandon avec motif, terrain réservé pour le match).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

/** Date AAAA-MM-JJ dans n jours. */
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const FORMAT = { setsToWin: 2, games: 4, tiebreak: true, superTB: false, noAd: true };

describe('Matchs : saisie point par point', () => {
  let admin, parent, player, coach, yassine, matchId;

  before(async () => {
    admin = await as('admin');
    parent = await as('parent');
    player = await as('parent2'); // Omar Trabelsi : compte joueur
    coach = await as('coach');
    const me = ok(await parent('GET', '/auth/me'));
    yassine = me.players.find((p) => p.firstName === 'Yassine');
    assert.ok(yassine, 'Yassine Ben Ali (enfant de Sana) attendu dans la démo');
  });

  test('un parent (spectateur) crée un match amical avec un adversaire hors club', async () => {
    const r = await parent('POST', '/matches', { kind: 'FRIENDLY', date: inDays(0), playerAId: yassine.id, playerBName: `Adversaire ${uid()}`, ...FORMAT });
    matchId = ok(r, 'création du match').id;
    assert.ok(matchId);
  });

  test('deux fois le même joueur est refusé', async () => {
    refused(await parent('POST', '/matches', { kind: 'INTERNAL', date: inDays(0), playerAId: yassine.id, playerBId: yassine.id, ...FORMAT }), 400);
  });

  test('un parent ne réserve pas de terrain depuis un match (403)', async () => {
    const courts = ok(await admin('GET', '/courts'));
    const r = await parent('POST', '/matches', { kind: 'FRIENDLY', date: inDays(3), courtId: courts[0].id, time: '09:00', duration: 60, playerAId: yassine.id, playerBName: 'X', ...FORMAT });
    refused(r, 403);
  });

  test('un autre compte (joueur sans lien) ne peut ni lancer ni saisir', async () => {
    refused(await player('POST', `/matches/${matchId}/start`, { firstServer: 0 }), 403);
    const d = ok(await player('GET', `/matches/${matchId}`));
    assert.equal(d.canScore, false);
  });

  test('un point avant le lancement est refusé', async () => {
    refused(await parent('POST', `/matches/${matchId}/points`, { winner: 0, firstIn: true }), 400);
  });

  test('le créateur lance le match (A sert)', async () => {
    ok(await parent('POST', `/matches/${matchId}/start`, { firstServer: 0 }));
    refused(await parent('POST', `/matches/${matchId}/start`, { firstServer: 0 }), 400);
    const d = ok(await parent('GET', `/matches/${matchId}`));
    assert.equal(d.status, 'LIVE');
    assert.equal(d.canScore, true);
  });

  test('ace du receveur et double faute sur 1re balle refusés', async () => {
    refused(await parent('POST', `/matches/${matchId}/points`, { winner: 1, firstIn: true, kind: 'ACE' }), 400);
    refused(await parent('POST', `/matches/${matchId}/points`, { winner: 1, firstIn: true, kind: 'DF' }), 400);
  });

  test('4 points gagnés par A = 1 jeu à 0 (score recalculé depuis les points)', async () => {
    ok(await parent('POST', `/matches/${matchId}/points`, { winner: 0, firstIn: true, kind: 'ACE' }));
    for (let i = 0; i < 3; i++) ok(await parent('POST', `/matches/${matchId}/points`, { winner: 0, firstIn: true }));
    const d = ok(await parent('GET', `/matches/${matchId}`));
    assert.equal(d.points.length, 4);
    assert.deepEqual(d.state.sets[0].games, [1, 0], JSON.stringify(d.state.sets));
    assert.equal(d.stats.all[0].aces, 1);
    assert.equal(d.stats.all[0].pointsWon, 4);
    assert.equal(d.stats.all[1].pointsWon, 0);
  });

  test('annuler le dernier point revient à 40-0 dans le 1er jeu', async () => {
    ok(await parent('DELETE', `/matches/${matchId}/points/last`));
    const d = ok(await parent('GET', `/matches/${matchId}`));
    assert.equal(d.points.length, 3);
    assert.deepEqual(d.state.sets[0].games, [0, 0]);
    assert.deepEqual(d.state.point, ['40', '0']);
  });

  test('l’entraîneur sans lien avec les joueurs ne saisit pas', async () => {
    // Iheb n'entraîne pas forcément Yassine : s'il l'entraîne, la saisie est permise (règle « entraîneur des joueurs »).
    const d = ok(await coach('GET', `/matches/${matchId}`));
    const r = await coach('POST', `/matches/${matchId}/points`, { winner: 0, firstIn: true });
    if (d.canScore) {
      ok(r);
      ok(await coach('DELETE', `/matches/${matchId}/points/last`));
    } else refused(r, 403);
  });

  test('la direction (matches.manage) peut saisir aussi', async () => {
    ok(await admin('POST', `/matches/${matchId}/points`, { winner: 0, firstIn: true }));
    ok(await admin('DELETE', `/matches/${matchId}/points/last`));
  });

  test('le match se termine tout seul au dernier point (2 sets à 0)', async () => {
    let r;
    for (let i = 0; i < 60; i++) {
      r = ok(await parent('POST', `/matches/${matchId}/points`, { winner: 0, firstIn: true }));
      if (r.finished) break;
    }
    assert.equal(r.finished, true, 'le match devait se terminer');
    const d = ok(await parent('GET', `/matches/${matchId}`));
    assert.equal(d.status, 'FINISHED');
    assert.equal(d.winner, 0);
    assert.equal(d.points.length, 32, '2 sets × 4 jeux × 4 points (point décisif)');
    assert.match(String(d.score), /4-0/);
  });

  test('après la fin : point refusé, abandon refusé', async () => {
    refused(await parent('POST', `/matches/${matchId}/points`, { winner: 1, firstIn: true }), 400);
    refused(await parent('POST', `/matches/${matchId}/abandon`, { reason: 'test' }), 400);
  });

  test('annuler le dernier point dans les 30 minutes rouvre le match', async () => {
    ok(await parent('DELETE', `/matches/${matchId}/points/last`));
    const d = ok(await parent('GET', `/matches/${matchId}`));
    assert.equal(d.status, 'LIVE');
    assert.equal(d.winner, null);
    const r = ok(await parent('POST', `/matches/${matchId}/points`, { winner: 0, firstIn: true }));
    assert.equal(r.finished, true);
  });

  test('le match est visible de tous dans la liste et dans le bilan du joueur', async () => {
    const list = ok(await player('GET', '/matches'));
    assert.ok(list.some((m) => m.id === matchId));
    const s = ok(await parent('GET', `/matches/player/summary?playerId=${yassine.id}`));
    assert.ok(s, 'bilan du joueur');
  });
});

describe('Matchs : abandon et terrain réservé', () => {
  let admin, parent, coach, yassine;

  before(async () => {
    admin = await as('admin');
    parent = await as('parent');
    coach = await as('coach');
    yassine = ok(await parent('GET', '/auth/me')).players.find((p) => p.firstName === 'Yassine');
  });

  test('abandon : motif obligatoire, score atteint conservé', async () => {
    const id = ok(await parent('POST', '/matches', { kind: 'FRIENDLY', date: inDays(0), playerAId: yassine.id, playerBName: 'Adversaire abandon', ...FORMAT })).id;
    ok(await parent('POST', `/matches/${id}/start`, { firstServer: 1 }));
    for (let i = 0; i < 4; i++) ok(await parent('POST', `/matches/${id}/points`, { winner: 1, firstIn: true }));
    refused(await parent('POST', `/matches/${id}/abandon`, { reason: '' }), 400);
    ok(await parent('POST', `/matches/${id}/abandon`, { reason: 'Blessure (test E2E)' }));
    const d = ok(await parent('GET', `/matches/${id}`));
    assert.equal(d.status, 'ABANDONED');
    assert.equal(d.endReason, 'Blessure (test E2E)');
    assert.ok(d.score, 'le score atteint est gardé');
    refused(await parent('DELETE', `/matches/${id}/points/last`), 400);
  });

  test('l’entraîneur réserve le terrain : créneau MATCH, double réservation refusée, libéré à l’annulation', async () => {
    const courts = ok(await admin('GET', '/courts')).filter((c) => c.active && !c.maintenance && c.lit);
    const date = inDays(20);
    let created, slot;
    // Premier créneau libre (pas d'entraînement ni de réservation) entre 8 h et 12 h.
    for (const c of courts) {
      for (const time of ['08:00', '09:00', '10:00', '11:00']) {
        const r = await coach('POST', '/matches', { kind: 'INTERNAL', date, courtId: c.id, time, duration: 60, playerAName: 'Joueur A', playerBName: 'Joueur B', ...FORMAT });
        if (r.status < 300) {
          created = r.data.id;
          slot = { courtId: c.id, time };
          break;
        }
        assert.equal(r.status, 409, `refus inattendu : ${r.status} ${JSON.stringify(r.data)}`);
      }
      if (created) break;
    }
    assert.ok(created, 'aucun créneau libre trouvé');

    const day = ok(await admin('GET', `/reservations?date=${date}`));
    const rows = JSON.stringify(day);
    assert.match(rows, /MATCH/, 'la réservation du match apparaît dans les réservations du jour');

    const again = await admin('POST', '/matches', { kind: 'INTERNAL', date, ...slot, duration: 60, playerAName: 'C', playerBName: 'D', ...FORMAT });
    refused(again, 409);

    ok(await coach('POST', `/matches/${created}/abandon`, { reason: 'Annulé (test E2E)' }));
    const retry = await admin('POST', '/matches', { kind: 'INTERNAL', date, ...slot, duration: 60, playerAName: 'C', playerBName: 'D', ...FORMAT });
    const id2 = ok(retry, 'le terrain libéré se réserve à nouveau').id;
    ok(await admin('POST', `/matches/${id2}/abandon`, { reason: 'Nettoyage (test E2E)' }));
  });

  test('créneau passé refusé (R10)', async () => {
    const courts = ok(await admin('GET', '/courts'));
    refused(await admin('POST', '/matches', { kind: 'INTERNAL', date: inDays(-2), courtId: courts[0].id, time: '10:00', duration: 60, playerAName: 'A', playerBName: 'B', ...FORMAT }), 409, /R10/);
  });
});
