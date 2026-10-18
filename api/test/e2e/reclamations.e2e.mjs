// Test de bout en bout : réclamations et suggestions (routage vers le responsable, personne visée qui ne voit rien,
// notes internes, réponse obligatoire pour clore, avis de satisfaction, 5 envois par jour).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
//
// La limite de 5 envois par 24 h et par compte rend les envois « coûteux » : chaque scénario prend un auteur qui a encore
// assez d'envois aujourd'hui (parent, joueur, entraîneur, directeur technique dans l'espace entraîneur), ce qui permet
// de relancer le fichier plusieurs fois par jour ; quand tous les auteurs sont épuisés, le scénario est ignoré (skip).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { ACCOUNTS, as, login, ok, refused, uid } from './helpers.mjs';

const PER_DAY = 5;
const complaint = (extra = {}) => ({ kind: 'COMPLAINT', category: 'PAYMENT', subject: `Reçu manquant ${uid()}`, body: 'Paiement fait sans reçu (test E2E).', ...extra });

describe('Réclamations', () => {
  let admin, agent, superviseur, dtAdmin, authors, agentMe;

  /** Envois restants aujourd'hui pour un auteur. */
  const left = async (c) => PER_DAY - ok(await c('GET', '/complaints/mine')).filter((x) => Date.now() - new Date(x.createdAt).getTime() < 86_400_000).length;
  /** Un auteur qui a encore `n` envois, sinon null. */
  const author = async (n) => {
    for (const a of authors) if ((await left(a)) >= n) return a;
    return null;
  };

  before(async () => {
    admin = await as('admin'); // président : voit tout (sauf ce qui le vise)
    agent = await as('agent'); // payments.collect
    superviseur = await as('superviseur'); // aucune catégorie
    dtAdmin = await as('dt'); // evaluations.manage, groups.manage
    authors = [await as('parent'), await as('parent2'), await as('coach'), await login(ACCOUNTS.dt[0], ACCOUNTS.dt[1], 'coach')];
    agentMe = ok(await agent('GET', '/auth/me'));
  });

  test('contrôles : objet et description obligatoires (sans compter dans la limite)', async () => {
    refused(await authors[0]('POST', '/complaints', complaint({ subject: '' })), 400);
    refused(await authors[0]('POST', '/complaints', complaint({ body: '' })), 400);
    refused(await authors[0]('POST', '/complaints', complaint({ category: 'INCONNUE' })), 400);
  });

  test('paiement visant l’agent : routée à la caisse, jamais visible de l’agent visé', async (t) => {
    const me = await author(1);
    if (!me) return t.skip('limite de 5 envois par jour atteinte pour tous les auteurs de démo');
    const c = ok(await me('POST', '/complaints', complaint({ targetUserId: agentMe.id })));
    assert.equal(c.status, 'NEW');
    assert.equal(c.author, null, 'l’auteur ne reçoit pas la vue responsable');

    // Personne visée : ni dans la liste, ni en détail.
    assert.ok(!ok(await agent('GET', '/complaints')).some((x) => x.id === c.id));
    refused(await agent('GET', `/complaints/${c.id}`), 404);
    // Sans catégorie traitée : 403 ; autre catégorie (direction technique) : invisible.
    refused(await superviseur('GET', '/complaints'), 403);
    assert.ok(!ok(await dtAdmin('GET', '/complaints')).some((x) => x.id === c.id));
    refused(await dtAdmin('GET', `/complaints/${c.id}`), 404);
    // Le président la voit et est prévenu.
    assert.ok(ok(await admin('GET', '/complaints')).some((x) => x.id === c.id));
    assert.ok(ok(await admin('GET', '/notifications')).some((n) => n.title.includes(c.subject)));

    // Échanges : note interne invisible de l'auteur, réponse visible signée « Club TCSAY ».
    ok(await admin('POST', `/complaints/${c.id}/messages`, { body: 'Vérifier le carnet (note interne).', internal: true }));
    ok(await admin('POST', `/complaints/${c.id}/messages`, { body: 'Nous vérifions votre reçu.' }));
    const seen = ok(await me('GET', `/complaints/${c.id}`));
    assert.equal(seen.messages.length, 1);
    assert.equal(seen.messages[0].author, 'Club TCSAY');
    assert.equal(ok(await admin('GET', `/complaints/${c.id}`)).messages.length, 2);
    assert.ok(ok(await me('GET', '/notifications')).some((n) => n.title.startsWith('Réponse à votre réclamation')));

    // Clore : réponse obligatoire ; l'auteur ne change pas le statut ; satisfaction après la clôture.
    refused(await me('POST', `/complaints/${c.id}/satisfaction`, { satisfied: true }), 400);
    refused(await me('POST', `/complaints/${c.id}/status`, { status: 'RESOLVED', message: 'ok' }), 403);
    refused(await admin('POST', `/complaints/${c.id}/status`, { status: 'RESOLVED' }), 400);
    ok(await admin('POST', `/complaints/${c.id}/status`, { status: 'RESOLVED', message: 'Reçu n° 120 remis au secrétariat.' }));
    const closed = ok(await me('GET', `/complaints/${c.id}`));
    assert.equal(closed.status, 'RESOLVED');
    refused(await me('POST', `/complaints/${c.id}/messages`, { body: 'Merci' }), 400);
    ok(await me('POST', `/complaints/${c.id}/satisfaction`, { satisfied: false }));
    assert.equal(ok(await admin('GET', `/complaints/${c.id}`)).satisfied, false);
  });

  test('comportement : président seulement ; entraînement : direction technique', async (t) => {
    const me = await author(2);
    if (!me) return t.skip('limite de 5 envois par jour atteinte pour tous les auteurs de démo');
    const behavior = ok(await me('POST', '/complaints', complaint({ category: 'BEHAVIOR', subject: `Comportement ${uid()}`, targetUserId: agentMe.id })));
    const training = ok(await me('POST', '/complaints', complaint({ category: 'TRAINING', kind: 'SUGGESTION', subject: `Séance ${uid()}` })));
    const dtList = ok(await dtAdmin('GET', '/complaints'));
    assert.ok(!dtList.some((x) => x.id === behavior.id), 'le comportement ne va qu’au président');
    assert.ok(dtList.some((x) => x.id === training.id), 'l’entraînement va à la direction technique');
    assert.ok(ok(await admin('GET', '/complaints')).some((x) => x.id === behavior.id));
    ok(await dtAdmin('POST', `/complaints/${training.id}/status`, { status: 'IN_PROGRESS' }));
    ok(await dtAdmin('POST', `/complaints/${training.id}/status`, { status: 'REJECTED', message: 'Déjà prévu au programme.' }));
    ok(await admin('POST', `/complaints/${behavior.id}/status`, { status: 'RESOLVED', message: 'Entretien fait (test E2E).' }));
    const stats = ok(await admin('GET', '/complaints/stats'));
    assert.ok(stats.total90 >= 2);
  });

  test('limite : au plus 5 envois par jour et par compte', async () => {
    // Un auteur déjà épuisé ne coûte rien ; sinon on épuise celui qui a le moins d'envois restants.
    let me = null;
    let min = PER_DAY + 1;
    for (const a of authors) {
      const l = await left(a);
      if (l < min) [me, min] = [a, l];
    }
    for (let i = 0; i < min; i++) ok(await me('POST', '/complaints', complaint({ kind: 'SUGGESTION', category: 'APP', subject: `Idée ${uid()}` })));
    const r = await me('POST', '/complaints', complaint({ kind: 'SUGGESTION', category: 'APP' }));
    refused(r, 400, /Au plus 5 envois par jour/);
  });
});
