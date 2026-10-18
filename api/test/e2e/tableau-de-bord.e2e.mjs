// Test de bout en bout : tableau de bord (chiffres clés, à traiter) et statistiques financières — les chiffres suivent
// une inscription et un encaissement ; droits (superviseur en lecture, coach et parent refusés).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

const round = (n) => Math.round(n * 1000) / 1000;

describe('Tableau de bord et statistiques financières', () => {
  let admin, superviseur, coach, parent, dash0, stats0, player, installment;
  const tag = uid();

  before(async () => {
    admin = await as('admin');
    superviseur = await as('superviseur');
    coach = await as('coach');
    parent = await as('parent');
    dash0 = ok(await admin('GET', '/dashboard'));
    stats0 = ok(await admin('GET', '/stats/finances'));
  });

  after(async () => {
    if (player) await admin('POST', `/players/${player.id}/archive`);
  });

  test('le tableau de bord porte sur la saison active', async () => {
    const active = ok(await admin('GET', '/seasons/active'));
    assert.equal(dash0.season.id, active.id);
    for (const k of ['activePlayers', 'groupsCount', 'coachesCount', 'cashed', 'lateAmount', 'newThisMonth', 'due', 'reservationsToday']) {
      assert.equal(typeof dash0[k], 'number', `chiffre « ${k} »`);
    }
    assert.ok(dash0.todo && typeof dash0.todo.withoutMembership === 'number');
    assert.equal(round(dash0.late.reduce((t, i) => t + i.remaining, 0)), round(dash0.lateAmount), 'retards = somme des tranches en retard');
    assert.ok(dash0.late.every((i) => i.days > 0));
  });

  test('statistiques : attendu, encaissé, reste et taux cohérents', async () => {
    const s = stats0.summary;
    assert.equal(s.remaining, round(Math.max(0, s.due - s.cashed)));
    if (s.due > 0) assert.equal(s.rate, Math.round((s.cashed / s.due) * 100));
    assert.ok(stats0.months.length >= 12);
    const b = stats0.balance;
    assert.equal(b.net, round(b.cotisations + b.reservations - b.salariesPaid - b.expensesPaid));
  });

  test('nouvelle inscription : joueurs inscrits, nouveaux du mois et attendu augmentent', async () => {
    player = ok(
      await admin('POST', '/players', {
        firstName: `Tdb${tag.replace(/\d/g, 'x')}`,
        lastName: 'Testmajeur',
        birthDate: '1990-05-05',
        gender: 'M',
        email: `tdb.${tag}@exemple.tn`,
        phone: '20000002',
        cin: String(10000000 + Math.floor(Math.random() * 89999999)),
        paymentPlan: 'FULL',
      }),
      'création du joueur',
    );
    assert.ok(player.membership, 'cotisation créée depuis le tarif');
    const d = ok(await admin('GET', '/dashboard'));
    assert.equal(d.activePlayers, dash0.activePlayers + 1);
    assert.equal(d.newThisMonth, dash0.newThisMonth + 1);
    assert.equal(round(d.due), round(dash0.due + player.membership.installments.reduce((t, i) => t + i.amount, 0)));
  });

  test('encaissement : encaissé du tableau de bord et des statistiques augmente', async () => {
    const inst = ok(await admin('GET', `/installments?playerId=${player.id}`));
    installment = inst.find((i) => i.remaining > 0);
    assert.ok(installment);
    ok(await admin('POST', `/installments/${installment.id}/payments`, { amount: 100, method: 'CASH', note: 'Test tableau de bord' }), 'encaissement');
    const d = ok(await admin('GET', '/dashboard'));
    assert.equal(round(d.cashed), round(dash0.cashed + 100));
    assert.equal(d.paymentsCount, dash0.paymentsCount + 1);
    const s = ok(await admin('GET', '/stats/finances'));
    assert.equal(round(s.summary.cashed), round(stats0.summary.cashed + 100));
    assert.equal(round(s.methods.CASH.amount), round(stats0.methods.CASH.amount + 100), 'espèces comptées dans les modes de paiement');
    assert.equal(s.methods.CASH.count, stats0.methods.CASH.count + 1);
  });

  test('statistiques d’une autre saison au choix', async () => {
    const seasons = ok(await admin('GET', '/seasons'));
    const closed = seasons.find((x) => x.status === 'CLOSED');
    if (!closed) return;
    const s = ok(await admin('GET', `/stats/finances?seasonId=${closed.id}`));
    assert.equal(s.season.id, closed.id);
    refused(await admin('GET', '/stats/finances?seasonId=pas-un-id'), 400);
  });

  test('droits : superviseur en lecture ; coach et parent refusés (403)', async () => {
    ok(await superviseur('GET', '/dashboard'));
    ok(await superviseur('GET', '/stats/finances'));
    refused(await coach('GET', '/dashboard'), 403);
    refused(await coach('GET', '/stats/finances'), 403);
    refused(await parent('GET', '/dashboard'), 403);
  });
});
