// Test de bout en bout : tournois (critères, demande d'une famille, refus, tirage non publié puis publié, résultats
// réservés aux concernés, vainqueur au tour suivant, forfait, annulation qui libère les terrains).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

/** Jour éloigné, différent à chaque passage : les créneaux des passages précédents ne gênent pas. */
const farDay = () => new Date(Date.now() + (60 + Math.floor(Math.random() * 600)) * 86_400_000).toISOString().slice(0, 10);

const base = (courtIds, day, extra = {}) => ({
  kind: 'INTERNAL',
  startDate: day,
  endDate: day,
  eligibility: { mode: 'open' },
  format: 'KNOCKOUT',
  maxPlayers: 4,
  familyRequest: true,
  setsToWin: 2,
  games: 6,
  tiebreak: true,
  superTB: false,
  noAd: false,
  courtIds,
  dayStart: '08:00',
  dayEnd: '13:00',
  matchMinutes: 60,
  restMinutes: 0,
  ...extra,
});

describe('Tournoi à élimination directe (résultats réservés)', () => {
  let admin, dt, parent, player, coach, kids, courts, day, t, tid;

  before(async () => {
    admin = await as('admin');
    dt = await as('dt');
    parent = await as('parent');
    player = await as('parent2');
    coach = await as('coach');
    kids = ok(await parent('GET', '/auth/me')).players;
    courts = ok(await admin('GET', '/courts')).filter((c) => c.active && !c.maintenance).map((c) => c.id);
    day = farDay();
  });

  test('famille et entraîneur ne créent pas de tournoi (403)', async () => {
    refused(await parent('POST', '/tournaments', { name: 'X', ...base(courts, day) }), 403);
    refused(await coach('POST', '/tournaments', { name: 'X', ...base(courts, day) }), 403);
  });

  test('contrôles : fin avant début, sans terrain, catégories vides', async () => {
    refused(await dt('POST', '/tournaments', { name: 'X', ...base(courts, day, { endDate: '2020-01-01' }) }), 400);
    refused(await dt('POST', '/tournaments', { name: 'X', ...base([], day) }), 400);
    refused(await dt('POST', '/tournaments', { name: 'X', ...base(courts, day, { eligibility: { mode: 'cats', categoryIds: [] } }) }), 400);
  });

  test('la direction technique crée le tournoi (inscriptions ouvertes, résultats réservés)', async () => {
    const name = `Tournoi test ${uid()}`;
    tid = ok(await dt('POST', '/tournaments', { name, ...base(courts.slice(0, 2), day, { resultsPublic: false }) })).id;
    const list = ok(await parent('GET', '/tournaments'));
    t = list.tournaments.find((x) => x.id === tid);
    assert.ok(t, 'le tournoi ouvert est visible des familles');
    assert.equal(t.status, 'REGISTRATION');
    assert.equal(list.canManage, false);
  });

  test('demande d’une famille, doublon refusé, refus par la direction', async () => {
    const yassine = kids.find((k) => k.firstName === 'Yassine');
    const r = ok(await parent('POST', `/tournaments/${tid}/request`, { playerId: yassine.id }));
    assert.match(r.message, /Demande envoyée/);
    refused(await parent('POST', `/tournaments/${tid}/request`, { playerId: yassine.id }), 400);
    const d = ok(await dt('GET', `/tournaments/${tid}`));
    const e = d.entries.find((x) => x.playerId === yassine.id);
    assert.equal(e.status, 'PENDING');
    // La famille ne voit que les inscrits confirmés.
    assert.ok(!ok(await parent('GET', `/tournaments/${tid}`)).entries.some((x) => x.playerId === yassine.id));
    ok(await dt('DELETE', `/tournaments/${tid}/entries/${e.id}`));
    const notes = ok(await parent('GET', '/notifications'));
    assert.ok(notes.some((n) => n.title.startsWith('Demande refusée')), 'la famille est prévenue du refus');
  });

  test('nouvelle demande, puis validation : inscription confirmée', async () => {
    const yassine = kids.find((k) => k.firstName === 'Yassine');
    ok(await parent('POST', `/tournaments/${tid}/request`, { playerId: yassine.id }));
    ok(await dt('POST', `/tournaments/${tid}/entries`, { playerId: yassine.id }));
    const d = ok(await parent('GET', `/tournaments/${tid}`));
    assert.equal(d.entries.find((x) => x.playerId === yassine.id)?.status, 'CONFIRMED');
    refused(await dt('POST', `/tournaments/${tid}/entries`, { playerId: yassine.id }), 400);
  });

  test('tirage refusé à moins de 2 inscrits, puis tableau complet à 4', async () => {
    refused(await dt('POST', `/tournaments/${tid}/draw`), 400);
    const lina = kids.find((k) => k.firstName === 'Lina');
    ok(await dt('POST', `/tournaments/${tid}/entries`, { playerId: lina.id }));
    ok(await dt('POST', `/tournaments/${tid}/entries`, { name: 'Invité Un (ESS)' }));
    ok(await dt('POST', `/tournaments/${tid}/entries`, { name: 'Invité Deux (CA)' }));
    refused(await dt('POST', `/tournaments/${tid}/entries`, { name: 'Cinquième' }), 400);
    const d = ok(await dt('GET', `/tournaments/${tid}`));
    ok(await dt('PATCH', `/tournaments/${tid}/entries/${d.entries.find((x) => x.playerId === lina.id).id}`, { seed: 1 }));
  });

  test('la publication avant le tirage est refusée', async () => {
    refused(await dt('POST', `/tournaments/${tid}/publish`, { published: true }), 400);
  });

  test('tirage : 3 matchs placés, tableau caché aux familles tant qu’il n’est pas publié', async () => {
    const r = ok(await dt('POST', `/tournaments/${tid}/draw`));
    assert.equal(r.matches, 3);
    assert.deepEqual(r.unplaced, []);
    refused(await dt('POST', `/tournaments/${tid}/draw`), 400);
    const fam = ok(await parent('GET', `/tournaments/${tid}`));
    assert.equal(fam.drawHidden, true);
    assert.deepEqual(fam.matches, []);
    // Créneaux des matchs réservés sur les terrains (type TOURNAMENT).
    const resa = ok(await admin('GET', `/reservations?date=${day}`));
    assert.ok(JSON.stringify(resa).includes('TOURNAMENT'));
    // Après le tirage : plus de retrait ni de modification.
    const e = ok(await dt('GET', `/tournaments/${tid}`)).entries[0];
    refused(await dt('DELETE', `/tournaments/${tid}/entries/${e.id}`), 400);
  });

  test('publication : les familles voient le tableau', async () => {
    ok(await dt('POST', `/tournaments/${tid}/publish`, { published: true }));
    const fam = ok(await parent('GET', `/tournaments/${tid}`));
    assert.equal(fam.drawHidden, false);
    assert.equal(fam.matches.length, 3);
  });

  test('résultat d’un match dont les joueurs ne sont pas connus : refusé', async () => {
    const final = ok(await dt('GET', `/tournaments/${tid}`)).matches.find((m) => m.round === 2);
    assert.equal(final.ready, false);
    refused(await dt('POST', `/tournaments/${tid}/matches/${final.id}/result`, { winner: 0, score: '6-0 6-0' }), 400);
  });

  test('demi-finales : score saisi et forfait ; les vainqueurs remplissent la finale', async () => {
    const d = ok(await dt('GET', `/tournaments/${tid}`));
    const [s1, s2] = d.matches.filter((m) => m.round === 1).sort((a, b) => a.position - b.position);
    refused(await parent('POST', `/tournaments/${tid}/matches/${s1.id}/result`, { winner: 0, score: '6-1 6-0' }), 403);
    ok(await dt('POST', `/tournaments/${tid}/matches/${s1.id}/result`, { winner: 0, score: '6-1 6-0' }));
    refused(await dt('POST', `/tournaments/${tid}/matches/${s1.id}/result`, { winner: 1, score: '6-1 6-0' }), 400);
    ok(await dt('POST', `/tournaments/${tid}/matches/${s2.id}/result`, { winner: 1 }));
    const after = ok(await dt('GET', `/tournaments/${tid}`));
    const final = after.matches.find((m) => m.round === 2);
    assert.equal(final.ready, true);
    assert.equal(final.playerA.name, s1.playerA.name, 'vainqueur de la 1re demi-finale en A');
    assert.equal(final.playerB.name, s2.playerB.name, 'vainqueur de la 2e demi-finale en B');
    const forfeit = after.matches.find((m) => m.id === s2.id);
    assert.equal(forfeit.score, 'Forfait');
  });

  test('résultats réservés : un joueur non concerné ne voit ni vainqueur ni score', async () => {
    const d = ok(await player('GET', `/tournaments/${tid}`));
    const done = d.matches.filter((m) => m.status === 'FINISHED');
    assert.equal(done.length, 2);
    for (const m of done) {
      assert.equal(m.resultHidden, true);
      assert.equal(m.winner, null);
      assert.equal(m.score, null);
    }
    const detail = ok(await player('GET', `/matches/${done[0].id}`));
    assert.equal(detail.hidden, 'private');
    // La famille concernée voit le résultat des matchs de ses enfants.
    const fam = ok(await parent('GET', `/tournaments/${tid}`));
    const own = fam.matches.filter((m) => m.status === 'FINISHED' && m.mine);
    assert.ok(own.length >= 1);
    for (const m of own) assert.equal(m.resultHidden, false);
  });

  test('finale : le tournoi se termine avec son vainqueur', async () => {
    const final = ok(await dt('GET', `/tournaments/${tid}`)).matches.find((m) => m.round === 2);
    ok(await dt('POST', `/tournaments/${tid}/matches/${final.id}/result`, { winner: 0, score: '7-6 6-4' }));
    const d = ok(await dt('GET', `/tournaments/${tid}`));
    assert.equal(d.status, 'FINISHED');
    assert.equal(d.winnerName, final.playerA.name);
    assert.equal(ok(await player('GET', `/tournaments/${tid}`)).winnerName, null, 'vainqueur réservé aux concernés');
    refused(await dt('POST', `/tournaments/${tid}/cancel`, { reason: 'trop tard' }), 400);
  });
});

describe('Tournoi : critères et annulation', () => {
  let dt, admin, parent, kids, courts;

  before(async () => {
    admin = await as('admin');
    dt = await as('dt');
    parent = await as('parent');
    kids = ok(await parent('GET', '/auth/me')).players;
    courts = ok(await admin('GET', '/courts')).filter((c) => c.active && !c.maintenance).map((c) => c.id);
  });

  test('tournoi réservé aux filles : demande refusée pour un garçon, dérogation avec motif par la direction', async () => {
    const yassine = kids.find((k) => k.firstName === 'Yassine');
    const id = ok(await dt('POST', '/tournaments', { name: `Filles ${uid()}`, ...base(courts, farDay(), { eligibility: { mode: 'open', gender: 'F' } }) })).id;
    refused(await parent('POST', `/tournaments/${id}/request`, { playerId: yassine.id }), 400);
    refused(await dt('POST', `/tournaments/${id}/entries`, { playerId: yassine.id }), 400);
    ok(await dt('POST', `/tournaments/${id}/entries`, { playerId: yassine.id, derogationReason: 'Manque de joueuses (test E2E)' }));
    const e = ok(await dt('GET', `/tournaments/${id}`)).entries.find((x) => x.playerId === yassine.id);
    assert.equal(e.derogationReason, 'Manque de joueuses (test E2E)');
    ok(await dt('POST', `/tournaments/${id}/cancel`, { reason: 'Fin du test' }));
  });

  test('inscriptions par le club seulement : la demande d’une famille est refusée (403)', async () => {
    const id = ok(await dt('POST', '/tournaments', { name: `Club ${uid()}`, ...base(courts, farDay(), { familyRequest: false }) })).id;
    refused(await parent('POST', `/tournaments/${id}/request`, { playerId: kids[0].id }), 403);
    ok(await dt('POST', `/tournaments/${id}/cancel`, { reason: 'Fin du test' }));
  });

  test('annulation : motif obligatoire, terrains libérés, tournoi retiré de la liste', async () => {
    const day = farDay();
    const id = ok(await dt('POST', '/tournaments', { name: `Annulé ${uid()}`, ...base(courts.slice(0, 1), day) })).id;
    ok(await dt('POST', `/tournaments/${id}/entries`, { name: 'Joueur Alpha' }));
    ok(await dt('POST', `/tournaments/${id}/entries`, { name: 'Joueur Bêta' }));
    assert.equal(ok(await dt('POST', `/tournaments/${id}/draw`)).matches, 1);
    const count = (rows) => rows.filter((r) => JSON.stringify(r).includes('TOURNAMENT')).length;
    const before = count(ok(await admin('GET', `/reservations?date=${day}`)));
    assert.ok(before >= 1);
    refused(await dt('POST', `/tournaments/${id}/cancel`, { reason: ' ' }), 400);
    ok(await dt('POST', `/tournaments/${id}/cancel`, { reason: 'Pluie (test E2E)' }));
    assert.equal(count(ok(await admin('GET', `/reservations?date=${day}`))), before - 1, 'le créneau du match est libéré');
    assert.ok(!ok(await dt('GET', '/tournaments')).tournaments.some((x) => x.id === id));
  });

  test('R13 : modification avec une version périmée refusée', async () => {
    const day = farDay();
    const id = ok(await dt('POST', '/tournaments', { name: `Version ${uid()}`, ...base(courts, day) })).id;
    const t = ok(await dt('GET', `/tournaments/${id}`));
    refused(await dt('PATCH', `/tournaments/${id}`, { name: t.name, ...base(courts, day), version: t.version + 3 }), undefined, /R13/);
    ok(await dt('PATCH', `/tournaments/${id}`, { name: `${t.name} (modifié)`, ...base(courts, day), version: t.version }));
    ok(await dt('POST', `/tournaments/${id}/cancel`, { reason: 'Fin du test' }));
  });
});
