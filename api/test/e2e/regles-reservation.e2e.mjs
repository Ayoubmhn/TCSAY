// Test de bout en bout : règles et sécurité des réservations (président, direction, familles).
// Limites par compte / famille / joueur / semaine, délai d'avance, soir et week-end, cotisation en retard,
// terrains ouverts à la réservation, entretien, fermetures temporaires, blocages (manuel, automatique),
// absence sans annuler, tentatives répétées (429).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs). Les règles, terrains et blocages modifiés sont remis
// comme avant ; les réservations créées sont annulées par la direction (sans compter d'annulation pour la famille).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

const tunisToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const PERMISSIVE = { maxUpcomingAccount: 0, maxUpcomingFamily: 0, maxHoursWeek: 0, maxPerDayPlayer: 0, advanceDays: 60, peakPerWeek: 0, cancelsPerMonth: 0, noShowLimit: 0, blockDays: 15, attemptsPerHour: 0, noArrears: false };
const DAY_TIMES = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30'];
const used = new Set();

/** Premier créneau libre (grille de la direction) d'1 h ou plus, avec filtres. */
async function freeSlot(admin, { fromDay = 2, toDay = 40, duration = 60, times = DAY_TIMES, courtId, days, accept } = {}) {
  for (let k = fromDay; k <= toDay; k++) {
    const date = addDays(tunisToday(), k);
    if (days && !days.includes(weekday(date))) continue;
    const g = ok(await admin('GET', `/reservations/grid?date=${date}`), 'grille');
    for (const court of g.courts) {
      if (courtId && court.id !== courtId) continue;
      if (!court.active || court.maintenance) continue;
      const cells = g.slots.find((s) => s.courtId === court.id).times;
      const n = duration / 30;
      for (let i = 0; i + n <= cells.length; i++) {
        const time = cells[i].time;
        if (times && !times.includes(time)) continue;
        if (accept && !accept(date, time, court)) continue;
        if (used.has(`${court.id}|${date}|${time}`)) continue;
        if (cells.slice(i, i + n).every((c) => c.state === 'free')) {
          for (let j = 0; j < n; j++) used.add(`${court.id}|${date}|${cells[i + j].time}`);
          return { courtId: court.id, court: court.name, date, time };
        }
      }
    }
  }
  return null;
}

describe('Règles et sécurité des réservations', () => {
  let admin, parent, other, coach, rulesBefore, yassine, lina, omar, otherId, coachUserId;
  const created = [];

  before(async () => {
    admin = await as('admin');
    parent = await as('parent');
    other = await as('parent2');
    coach = await as('coach');
    rulesBefore = ok(await admin('GET', '/reservations/rules'));
    ok(await admin('PUT', '/reservations/rules', PERMISSIVE), 'règles assouplies');
    const me = ok(await parent('GET', '/auth/me'));
    yassine = me.players.find((p) => p.firstName === 'Yassine');
    lina = me.players.find((p) => p.firstName === 'Lina');
    const om = ok(await other('GET', '/auth/me'));
    omar = om.players[0];
    otherId = om.id;
    coachUserId = ok(await coach('GET', '/auth/me')).id;
    assert.ok(yassine && lina && omar, 'comptes de la démo introuvables (relancer npm run db:demo)');
    // Un blocage resté d'une exécution précédente fausserait les tests : on le lève.
    for (const b of ok(await admin('GET', '/reservations/security')).blocks) {
      if ([otherId, coachUserId, me.id].includes(b.user.id)) await admin('POST', `/reservations/blocks/${b.id}/lift`);
    }
  });

  after(async () => {
    for (const id of created) await admin('POST', `/reservations/${id}/cancel`, { reason: 'Nettoyage test E2E' });
    for (const b of ok(await admin('GET', '/reservations/security')).blocks) {
      if ([otherId, coachUserId].includes(b.user.id)) await admin('POST', `/reservations/blocks/${b.id}/lift`);
    }
    if (rulesBefore) await admin('PUT', '/reservations/rules', rulesBefore);
  });

  const setRules = async (patch) => ok(await admin('PUT', '/reservations/rules', { ...PERMISSIVE, ...patch }), 'règles');
  async function book(client, body, what = 'réservation') {
    const r = ok(await client('POST', '/reservations', body), what);
    created.push(r.id);
    return r;
  }

  describe('réglage des règles', () => {
    test('tout le monde lit les règles ; seul le président les modifie', async () => {
      const r = ok(await parent('GET', '/reservations/rules'));
      assert.equal(typeof r.maxUpcomingAccount, 'number');
      refused(await parent('PUT', '/reservations/rules', PERMISSIVE), 403);
      refused(await coach('PUT', '/reservations/rules', PERMISSIVE), 403);
    });

    test('valeurs hors bornes refusées (400)', async () => {
      refused(await admin('PUT', '/reservations/rules', { ...PERMISSIVE, advanceDays: 0 }), 400);
      refused(await admin('PUT', '/reservations/rules', { ...PERMISSIVE, maxUpcomingAccount: 99 }), 400);
      refused(await admin('PUT', '/reservations/rules', { ...PERMISSIVE, noArrears: 'oui' }), 400);
    });

    test('la famille voit ses limites', async () => {
      const u = ok(await parent('GET', '/reservations/limits'));
      for (const k of ['upcomingAccount', 'upcomingFamily', 'hoursWeek', 'peakWeek', 'lastDay']) assert.ok(k in u, `champ ${k} absent`);
      assert.equal(u.block, null);
    });
  });

  describe('limites', () => {
    test('1 réservation par jour et par joueur', async () => {
      await setRules({ maxPerDayPlayer: 1 });
      const a = await freeSlot(admin);
      await book(parent, { courtId: a.courtId, date: a.date, time: a.time, playerId: yassine.id });
      const b = await freeSlot(admin, { fromDay: 0, accept: (date) => date === a.date });
      assert.ok(b, 'pas de second créneau libre le même jour');
      refused(await parent('POST', '/reservations', { courtId: b.courtId, date: b.date, time: b.time, playerId: yassine.id }), 403, /par jour/);
      await setRules({});
    });

    test('réservations à venir par compte', async () => {
      const u = ok(await other('GET', '/reservations/limits'));
      let current = u.upcomingAccount;
      if (current === 0) {
        const s = await freeSlot(admin);
        await book(other, { courtId: s.courtId, date: s.date, time: s.time, playerId: omar.id });
        current = 1;
      }
      await setRules({ maxUpcomingAccount: current });
      const s = await freeSlot(admin);
      refused(await other('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: omar.id }), 403, /par compte/);
      await setRules({});
    });

    test('réservations à venir par famille', async () => {
      const u = ok(await parent('GET', '/reservations/limits'));
      let current = u.upcomingFamily;
      if (current === 0) {
        const s = await freeSlot(admin);
        await book(parent, { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id });
        current = 1;
      }
      await setRules({ maxUpcomingFamily: current });
      const s = await freeSlot(admin);
      refused(await parent('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }), 403, /par famille/);
      await setRules({});
    });

    test('heures par semaine', async () => {
      await setRules({ maxHoursWeek: 1 });
      const s = await freeSlot(admin, { duration: 120 });
      refused(await parent('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, duration: 120, playerId: yassine.id }), 403, /par semaine/);
      await setRules({});
    });

    test('délai d’avance : pas de réservation au-delà de N jours', async () => {
      await setRules({ advanceDays: 3 });
      const s = await freeSlot(admin, { fromDay: 8, toDay: 30 });
      refused(await parent('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }), 403, /à l’avance/);
      // L'entraîneur aussi est soumis au délai d'avance.
      refused(await coach('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }), 403, /à l’avance/);
      // La direction n'est pas limitée.
      const r = await book(admin, { courtId: s.courtId, date: s.date, time: s.time });
      assert.ok(r.id);
      await setRules({});
    });

    test('soir et week-end : limite par semaine', async () => {
      // Un samedi ou un dimanche (heures demandées), dans la même semaine (lundi → dimanche) : samedi puis dimanche.
      const sat = await freeSlot(admin, { days: [6] });
      assert.ok(sat, 'pas de samedi libre');
      await book(parent, { courtId: sat.courtId, date: sat.date, time: sat.time, playerId: yassine.id });
      const peak = ok(await parent('GET', `/reservations/limits?date=${sat.date}`)).peakWeek;
      assert.ok(peak >= 1, 'le samedi compte comme heure demandée');
      await setRules({ peakPerWeek: peak });
      const sun = await freeSlot(admin, { fromDay: 0, accept: (date) => date === addDays(sat.date, 1) });
      assert.ok(sun, 'pas de dimanche libre');
      refused(await parent('POST', '/reservations', { courtId: sun.courtId, date: sun.date, time: sun.time, playerId: lina.id }), 403, /soir ou le week-end/);
      await setRules({});
    });

    test('cotisation échue non payée : réservation refusée pour ce joueur', async (t) => {
      const late = ok(await admin('GET', `/installments?playerId=${lina.id}`)).some((i) => i.remaining > 0 && i.dueDate < tunisToday());
      if (!late) return t.skip('Lina n’a plus de tranche échue (payée par un autre test)');
      await setRules({ noArrears: true });
      const s = await freeSlot(admin);
      const r = await parent('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: lina.id });
      // Refus par la règle « cotisation à jour » ou par l'accès après paiement (module fermé) : 403 dans les deux cas.
      refused(r, 403);
      await setRules({});
    });
  });

  describe('terrains ouverts à la réservation', () => {
    let court;

    before(async () => {
      court = ok(await admin('GET', '/courts')).find((c) => c.active && c.lit && !c.maintenance);
    });

    after(async () => {
      const now = ok(await admin('GET', '/courts')).find((c) => c.id === court.id);
      await admin('PATCH', `/courts/${court.id}`, { version: now.version, bookFamilies: court.bookFamilies, bookCoaches: court.bookCoaches, bookNight: court.bookNight, bookDays: court.bookDays, bookFrom: court.bookFrom, bookTo: court.bookTo });
      if (now.maintenance) await admin('POST', `/courts/${court.id}/maintenance`, { maintenance: false });
    });

    const patch = async (data) => {
      const now = ok(await admin('GET', '/courts')).find((c) => c.id === court.id);
      return ok(await admin('PATCH', `/courts/${court.id}`, { version: now.version, ...data }), 'terrain');
    };

    test('terrain fermé aux familles : absent de leur grille, réservation refusée, l’entraîneur peut', async () => {
      await patch({ bookFamilies: false });
      const s = await freeSlot(admin, { courtId: court.id });
      const grid = ok(await parent('GET', `/reservations/grid?date=${s.date}&playerId=${yassine.id}`));
      assert.ok(!grid.courts.some((c) => c.id === court.id), 'terrain encore visible pour la famille');
      refused(await parent('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }), 403, /pas ouvert/);
      const r = await book(coach, { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }, 'séance privée');
      assert.equal(r.type, 'PRIVATE');
      await patch({ bookFamilies: true });
    });

    test('terrain fermé aux entraîneurs', async () => {
      await patch({ bookCoaches: false });
      const s = await freeSlot(admin, { courtId: court.id });
      refused(await coach('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }), 403, /pas ouvert/);
      await patch({ bookCoaches: true });
    });

    test('pas de réservation le soir sur ce terrain', async () => {
      await patch({ bookNight: false });
      const s = await freeSlot(admin, { courtId: court.id, times: ['20:00', '20:30', '21:00'] });
      assert.ok(s, 'pas de créneau du soir libre');
      refused(await parent('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }), 403, /le soir/);
      await patch({ bookNight: true });
    });

    test('jours et heures d’ouverture à la réservation', async () => {
      const s = await freeSlot(admin, { courtId: court.id, times: ['08:00', '08:30', '09:00'] });
      const wd = weekday(s.date);
      await patch({ bookDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== wd) });
      refused(await parent('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }), 403, /ce jour-là/);
      await patch({ bookDays: [0, 1, 2, 3, 4, 5, 6], bookFrom: '10:00', bookTo: '16:00' });
      refused(await parent('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }), 403, /à partir de 10:00/);
      refused(await admin('PATCH', `/courts/${court.id}`, { version: ok(await admin('GET', '/courts')).find((c) => c.id === court.id).version, bookFrom: '16:00', bookTo: '10:00' }), 400);
      await patch({ bookFrom: null, bookTo: null });
    });

    test('terrain en entretien : réservation refusée (409), même pour la direction', async () => {
      const s = await freeSlot(admin, { courtId: court.id });
      ok(await admin('POST', `/courts/${court.id}/maintenance`, { maintenance: true }));
      try {
        refused(await parent('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }), 409, /entretien/);
        refused(await admin('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time }), 409, /entretien/);
        const grid = ok(await parent('GET', `/reservations/grid?date=${s.date}&playerId=${yassine.id}`));
        assert.ok(grid.slots.find((x) => x.courtId === court.id).times.every((t) => ['maintenance', 'past'].includes(t.state)));
      } finally {
        ok(await admin('POST', `/courts/${court.id}/maintenance`, { maintenance: false }));
      }
    });

    test('fermeture temporaire : refus pour la famille, affichée « closed », retirée ensuite', async () => {
      const s = await freeSlot(admin, { courtId: court.id });
      refused(await admin('POST', `/courts/${court.id}/closures`, { fromDate: s.date, toDate: addDays(s.date, -1), reason: 'Test' }), 400);
      refused(await admin('POST', `/courts/${court.id}/closures`, { fromDate: s.date, toDate: s.date, reason: '' }), 400);
      refused(await parent('POST', `/courts/${court.id}/closures`, { fromDate: s.date, toDate: s.date, reason: 'Test' }), 403);
      const closure = ok(await admin('POST', `/courts/${court.id}/closures`, { fromDate: s.date, toDate: s.date, reason: `Résine E2E ${uid()}` }));
      try {
        refused(await parent('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }), 403, /Fermé à la réservation/);
        const grid = ok(await parent('GET', `/reservations/grid?date=${s.date}&playerId=${yassine.id}`));
        assert.equal(grid.slots.find((x) => x.courtId === court.id).times.find((t) => t.time === s.time).state, 'closed');
      } finally {
        ok(await admin('DELETE', `/courts/closures/${closure.id}`), 'fermeture retirée');
      }
      await book(parent, { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id });
    });
  });

  describe('blocages', () => {
    let blockId;

    test('motif obligatoire ; une famille ne bloque pas', async () => {
      refused(await admin('POST', '/reservations/blocks', { userId: otherId, reason: '', days: 1 }), 400);
      refused(await parent('POST', '/reservations/blocks', { userId: otherId, reason: 'Test', days: 1 }), 403);
      refused(await parent('GET', '/reservations/security'), 403);
    });

    test('la direction suspend un compte : réservation refusée, blocage affiché', async () => {
      blockId = ok(await admin('POST', '/reservations/blocks', { userId: otherId, reason: 'Test E2E', days: 2 })).id;
      const s = await freeSlot(admin);
      refused(await other('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: omar.id }), 403, /suspendue/);
      assert.equal(ok(await other('GET', '/reservations/limits')).block.reason, 'Test E2E');
      assert.ok(ok(await admin('GET', '/reservations/security')).blocks.some((b) => b.id === blockId && b.user.id === otherId));
    });

    test('déblocage : le compte réserve de nouveau ; déjà levé = 404', async () => {
      ok(await admin('POST', `/reservations/blocks/${blockId}/lift`));
      refused(await admin('POST', `/reservations/blocks/${blockId}/lift`), 404);
      const s = await freeSlot(admin);
      await book(other, { courtId: s.courtId, date: s.date, time: s.time, playerId: omar.id });
    });

    test('annulations répétées : blocage automatique au-delà de la limite', async () => {
      // L'entraîneur annule deux séances privées avec une limite d'1 annulation par mois.
      await setRules({ cancelsPerMonth: 1 });
      // (Les annulations des autres tests comptent aussi : on s'arrête dès que le blocage tombe, 2 annulations au plus.)
      const blockOf = async () => ok(await admin('GET', '/reservations/security')).blocks.find((b) => b.user.id === coachUserId);
      let block;
      for (let i = 0; i < 2 && !block; i++) {
        const s = await freeSlot(admin);
        const r = ok(await coach('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }));
        ok(await coach('POST', `/reservations/${r.id}/cancel`, {}));
        block = await blockOf();
      }
      assert.ok(block, 'blocage automatique absent');
      assert.equal(block.by, 'Automatique');
      const s = await freeSlot(admin);
      refused(await coach('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }), 403, /suspendue/);
      ok(await admin('POST', `/reservations/blocks/${block.id}/lift`));
      await setRules({});
    });
  });

  describe('absence sans annuler', () => {
    test('créneau pas encore commencé : refusé (400) ; inconnu : 404 ; famille : 403', async () => {
      const s = await freeSlot(admin);
      const r = await book(admin, { courtId: s.courtId, date: s.date, time: s.time });
      refused(await admin('POST', `/reservations/${r.id}/no-show`), 400, /pas encore commencé/);
      refused(await admin('POST', '/reservations/00000000-0000-4000-8000-000000000000/no-show'), 404);
      refused(await parent('POST', `/reservations/${r.id}/no-show`), 403);
    });
  });

  describe('tentatives répétées depuis un appareil', () => {
    test('au-delà de la limite horaire : 429', async () => {
      // Limite basse le temps du test (l'adresse IP compte aussi : on reste à 3 tentatives au total).
      await setRules({ attemptsPerHour: 2 });
      const device = `e2e-${uid()}`;
      const s = await freeSlot(admin);
      const past = { courtId: s.courtId, date: addDays(tunisToday(), -1), time: '10:00', playerId: yassine.id };
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await parent('POST', '/reservations', past, { 'x-device': device })).status);
      await setRules({});
      // Sans limite, la date passée donnerait 409 (R10) ; la 3e tentative dépasse la limite de 2 par heure.
      assert.ok(statuses.every((st) => st === 409 || st === 429), `statuts ${statuses}`);
      assert.equal(statuses[2], 429, `statuts ${statuses}`);
    });
  });
});
