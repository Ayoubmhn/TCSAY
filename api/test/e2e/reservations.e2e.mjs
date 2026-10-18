// Test de bout en bout : réservations de terrains (famille, entraîneur, direction) et tarifs terrains.
// Créneaux, durées, chevauchements, nuit et éclairage, prix au prorata jour / nuit, annulation (R10), R11, R13.
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs). Chaque réservation créée est annulée à la fin ;
// les règles de réservation sont assouplies le temps du test puis remises comme avant.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused } from './helpers.mjs';

// ───── Outils locaux : jours du club (Africa/Tunis, UTC+1) et recherche d'un créneau libre ─────
const tunisToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const instant = (date, time) => new Date(`${date}T${time}:00+01:00`);
const PERMISSIVE = { maxUpcomingAccount: 0, maxUpcomingFamily: 0, maxHoursWeek: 0, maxPerDayPlayer: 0, advanceDays: 60, peakPerWeek: 0, cancelsPerMonth: 0, noShowLimit: 0, blockDays: 15, attemptsPerHour: 0, noArrears: false };
const used = new Set();

/** Premier créneau libre (grille de la direction) : `duration` minutes consécutives sur un même terrain. */
async function freeSlot(admin, { fromDay = 2, toDay = 40, duration = 60, lit, times, accept } = {}) {
  for (let k = fromDay; k <= toDay; k++) {
    const date = addDays(tunisToday(), k);
    const g = ok(await admin('GET', `/reservations/grid?date=${date}`), 'grille');
    for (const court of g.courts) {
      if (lit !== undefined && court.lit !== lit) continue;
      if (!court.active || court.maintenance) continue;
      const cells = g.slots.find((s) => s.courtId === court.id).times;
      const n = duration / 30;
      for (let i = 0; i + n <= cells.length; i++) {
        const time = cells[i].time;
        if (times && !times.includes(time)) continue;
        if (accept && !accept(date, time)) continue;
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

describe('Réservations de terrains', () => {
  let admin, parent, other, coach, rulesBefore, rates, yassine, omar;
  const created = [];
  const rate = (type, period) => rates.find((r) => r.type === type && r.period === period).pricePerHour;

  before(async () => {
    admin = await as('admin');
    parent = await as('parent');
    other = await as('parent2');
    coach = await as('coach');
    rulesBefore = ok(await admin('GET', '/reservations/rules'));
    ok(await admin('PUT', '/reservations/rules', PERMISSIVE), 'règles assouplies');
    rates = ok(await parent('GET', '/court-rates'), 'tarifs');
    const me = ok(await parent('GET', '/auth/me'));
    yassine = me.players.find((p) => p.firstName === 'Yassine');
    omar = ok(await other('GET', '/auth/me')).players[0];
    assert.ok(yassine && omar, 'enfants de la démo introuvables (relancer npm run db:demo)');
  });

  after(async () => {
    for (const id of created) await admin('POST', `/reservations/${id}/cancel`, { reason: 'Nettoyage test E2E' });
    if (rulesBefore) await admin('PUT', '/reservations/rules', rulesBefore);
  });

  /** Réserve et mémorise la réservation pour l'annuler à la fin. */
  async function book(client, body, what = 'réservation') {
    const r = ok(await client('POST', '/reservations', body), what);
    created.push(r.id);
    return r;
  }

  describe('famille', () => {
    let slot, resa;

    test('le parent réserve 1 h de jour pour Yassine, au tarif loisir de jour', async () => {
      slot = await freeSlot(admin, { times: ['09:00', '09:30', '10:00', '10:30', '11:00'] });
      assert.ok(slot, 'aucun créneau libre en matinée');
      resa = await book(parent, { courtId: slot.courtId, date: slot.date, time: slot.time, playerId: yassine.id });
      assert.equal(resa.type, 'LEISURE');
      assert.equal(resa.time, slot.time);
      assert.equal(resa.player.id, yassine.id);
      assert.equal(resa.price, rate('LEISURE', 'DAY'));
    });

    test('la réservation apparaît dans « Mes réservations », la grille et la liste de la direction', async () => {
      const mine = ok(await parent('GET', `/reservations/mine?playerId=${yassine.id}`));
      assert.ok(mine.some((r) => r.id === resa.id), 'absente de Mes réservations');
      const grid = ok(await parent('GET', `/reservations/grid?date=${slot.date}&playerId=${yassine.id}`));
      const cell = grid.slots.find((s) => s.courtId === slot.courtId).times.find((t) => t.time === slot.time);
      assert.equal(cell.state, 'mine');
      const seen = ok(await other('GET', `/reservations/grid?date=${slot.date}`));
      assert.equal(seen.slots.find((s) => s.courtId === slot.courtId).times.find((t) => t.time === slot.time).state, 'taken');
      const day = ok(await admin('GET', `/reservations?date=${slot.date}`));
      assert.ok(day.some((r) => r.id === resa.id), 'absente de la liste du jour');
    });

    test('pas de double réservation : même créneau refusé (409)', async () => {
      refused(await other('POST', '/reservations', { courtId: slot.courtId, date: slot.date, time: slot.time, playerId: omar.id }), 409);
    });

    test('pas de chevauchement : départ 30 min plus tôt sur le même terrain refusé (409)', async () => {
      const [h, m] = slot.time.split(':').map(Number);
      const earlier = `${String(m ? h : h - 1).padStart(2, '0')}:${m ? '00' : '30'}`;
      refused(await admin('POST', '/reservations', { courtId: slot.courtId, date: slot.date, time: earlier, duration: 60 }), 409);
    });

    test('la famille ne voit pas la grille d’un enfant qui n’est pas le sien', async () => {
      const r = await parent('GET', `/reservations/grid?date=${slot.date}&playerId=${omar.id}`);
      assert.ok(r.status === 403 || r.status === 404, `statut ${r.status}`);
    });

    test('un autre compte ne peut pas annuler cette réservation (403)', async () => {
      refused(await other('POST', `/reservations/${resa.id}/cancel`, {}), 403);
    });

    test('le parent annule sa réservation à plus de 24 h', async () => {
      ok(await parent('POST', `/reservations/${resa.id}/cancel`, {}), 'annulation');
      const mine = ok(await parent('GET', `/reservations/mine?playerId=${yassine.id}`));
      assert.ok(!mine.some((r) => r.id === resa.id), 'toujours dans Mes réservations');
      refused(await parent('POST', `/reservations/${resa.id}/cancel`, {}), 404);
    });
  });

  describe('heures et durées', () => {
    test('départ hors heure pile ou demi-heure refusé (400)', async () => {
      const s = await freeSlot(admin);
      refused(await parent('POST', '/reservations', { courtId: s.courtId, date: s.date, time: '10:15', playerId: yassine.id }), 400);
    });

    test('durée de moins d’1 h, de plus de 4 h ou hors tranches de 30 min refusée (400)', async () => {
      const s = await freeSlot(admin);
      for (const duration of [30, 75, 270]) {
        refused(await parent('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time, duration, playerId: yassine.id }), 400);
      }
    });

    test('une réservation qui finit après la fermeture est refusée (400)', async () => {
      const s = await freeSlot(admin);
      refused(await admin('POST', '/reservations', { courtId: s.courtId, date: s.date, time: '21:30', duration: 60 }), 400);
    });

    test('2 h 30 (5 demi-heures) acceptées, prix = 2,5 h au tarif de jour', async () => {
      const s = await freeSlot(admin, { duration: 150, times: ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00'] });
      assert.ok(s, 'aucun créneau libre de 2 h 30');
      const r = await book(parent, { courtId: s.courtId, date: s.date, time: s.time, duration: 150, playerId: yassine.id });
      assert.equal(r.endTimeLabel, (() => { const [h, m] = s.time.split(':').map(Number); const e = h * 60 + m + 150; return `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`; })());
      assert.equal(r.price, Math.round(2.5 * rate('LEISURE', 'DAY') * 1000) / 1000);
    });

    test('R10 : un créneau passé ne se réserve pas (409)', async () => {
      const s = await freeSlot(admin);
      refused(await parent('POST', '/reservations', { courtId: s.courtId, date: addDays(tunisToday(), -1), time: '10:00', playerId: yassine.id }), 409, /R10/);
    });

    test('date au mauvais format refusée (400)', async () => {
      const s = await freeSlot(admin);
      refused(await parent('POST', '/reservations', { courtId: s.courtId, date: '20/10/2026', time: '10:00', playerId: yassine.id }), 400);
    });
  });

  describe('nuit, éclairage et prix au prorata', () => {
    test('terrain sans éclairage : pas de jeu après le début de la nuit (409)', async () => {
      const grid = ok(await admin('GET', `/reservations/grid?date=${addDays(tunisToday(), 3)}`));
      const unlit = grid.courts.find((c) => !c.lit && c.active && !c.maintenance);
      if (!unlit) return; // la démo a l'annexe sans éclairage
      const night = String(grid.nightStartHour).padStart(2, '0');
      refused(await parent('POST', '/reservations', { courtId: unlit.id, date: grid.date, time: `${night}:00`, playerId: yassine.id }), 409, /éclairé/);
      refused(await parent('POST', '/reservations', { courtId: unlit.id, date: grid.date, time: `${String(grid.nightStartHour - 1).padStart(2, '0')}:30`, playerId: yassine.id }), 409, /éclairé/);
    });

    test('1 h de nuit au tarif de nuit', async () => {
      const s = await freeSlot(admin, { lit: true, times: ['20:00', '20:30', '21:00'] });
      assert.ok(s, 'aucun créneau de nuit libre');
      const r = await book(parent, { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id });
      assert.equal(r.price, rate('LEISURE', 'NIGHT'));
    });

    test('à cheval sur la nuit (30 min de jour + 30 min de nuit) : prix au prorata', async () => {
      const grid = ok(await admin('GET', `/reservations/grid?date=${addDays(tunisToday(), 2)}`));
      const before = `${String(grid.nightStartHour - 1).padStart(2, '0')}:30`;
      const s = await freeSlot(admin, { lit: true, times: [before] });
      assert.ok(s, `aucun terrain éclairé libre à ${before}`);
      const r = await book(parent, { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id });
      assert.equal(r.price, Math.round(((rate('LEISURE', 'DAY') + rate('LEISURE', 'NIGHT')) / 2) * 1000) / 1000);
    });
  });

  describe('entraîneur (séance privée)', () => {
    let resa;

    test('sans élève : refusé (400)', async () => {
      const s = await freeSlot(admin);
      refused(await coach('POST', '/reservations', { courtId: s.courtId, date: s.date, time: s.time }), 400);
    });

    test('avec un élève : séance privée au tarif privé, visible dans ses réservations', async () => {
      const s = await freeSlot(admin, { times: ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30'] });
      resa = await book(coach, { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }, 'séance privée');
      assert.equal(resa.type, 'PRIVATE');
      assert.ok(resa.coach, 'entraîneur absent de la réservation');
      assert.equal(resa.price, rate('PRIVATE', 'DAY'));
      const mine = ok(await coach('GET', '/reservations/mine'));
      assert.ok(mine.some((r) => r.id === resa.id));
    });

    test('la famille de l’élève voit la séance privée et peut l’annuler, pas un autre compte', async () => {
      const mine = ok(await parent('GET', `/reservations/mine?playerId=${yassine.id}`));
      assert.ok(mine.some((r) => r.id === resa.id), 'séance privée absente pour la famille');
      refused(await other('POST', `/reservations/${resa.id}/cancel`, {}), 403);
    });

    test('l’entraîneur annule sa séance à plus de 24 h', async () => {
      ok(await coach('POST', `/reservations/${resa.id}/cancel`, {}), 'annulation');
      assert.ok(!ok(await coach('GET', '/reservations/mine')).some((r) => r.id === resa.id));
    });
  });

  describe('annulation à moins de 24 h (R10) et annulation forcée par la direction', () => {
    let resa;

    test('la direction réserve pour Yassine dans les prochaines 24 h', async (t) => {
      const now = Date.now();
      const s = await freeSlot(admin, {
        fromDay: 0,
        toDay: 1,
        accept: (date, time) => {
          const at = instant(date, time).getTime();
          return at > now + 10 * 60_000 && at < now + 22 * 3600_000;
        },
      });
      if (!s) return t.skip('aucun créneau libre dans les prochaines 24 h');
      resa = await book(admin, { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id }, 'réservation de la direction');
      assert.equal(resa.bookedById, ok(await admin('GET', '/auth/me')).id);
    });

    test('le parent ne peut plus l’annuler (R10)', async (t) => {
      if (!resa) return t.skip('pas de réservation dans les 24 h');
      refused(await parent('POST', `/reservations/${resa.id}/cancel`, {}), 409, /R10/);
    });

    test('la direction doit donner un motif (400) puis annule (forcé)', async (t) => {
      if (!resa) return t.skip('pas de réservation dans les 24 h');
      refused(await admin('POST', `/reservations/${resa.id}/cancel`, {}), 400);
      ok(await admin('POST', `/reservations/${resa.id}/cancel`, { reason: 'Test E2E : annulation forcée' }), 'annulation forcée');
      const mine = ok(await parent('GET', `/reservations/mine?playerId=${yassine.id}`));
      assert.ok(!mine.some((r) => r.id === resa.id));
    });
  });

  describe('terrain avec réservations à venir (R11)', () => {
    test('désactivation refusée tant qu’il reste des réservations à venir', async () => {
      const s = await freeSlot(admin);
      const r = await book(admin, { courtId: s.courtId, date: s.date, time: s.time }, 'réservation de la direction');
      refused(await admin('POST', `/courts/${s.courtId}/deactivate`), 409, /R11/);
      const court = ok(await admin('GET', '/courts')).find((c) => c.id === s.courtId);
      assert.equal(court.active, true);
      ok(await admin('POST', `/reservations/${r.id}/cancel`, { reason: 'Test E2E' }));
    });
  });

  describe('tarifs terrains', () => {
    let leisureDay;

    test('tout le monde lit les tarifs ; une famille ne les modifie pas (403)', async () => {
      const list = ok(await parent('GET', '/court-rates'));
      leisureDay = list.find((r) => r.type === 'LEISURE' && r.period === 'DAY');
      assert.ok(leisureDay);
      refused(await parent('PATCH', `/court-rates/${leisureDay.id}`, { version: leisureDay.version, pricePerHour: 1 }), 403);
    });

    test('R13 : version périmée refusée ; prix négatif refusé (400)', async () => {
      refused(await admin('PATCH', `/court-rates/${leisureDay.id}`, { version: leisureDay.version + 5, pricePerHour: 11 }), 409, /R13/);
      refused(await admin('PATCH', `/court-rates/${leisureDay.id}`, { version: leisureDay.version, pricePerHour: -1 }), 400);
    });

    test('nouveau tarif appliqué aux nouvelles réservations, puis remis', async () => {
      const changed = ok(await admin('PATCH', `/court-rates/${leisureDay.id}`, { version: leisureDay.version, pricePerHour: leisureDay.pricePerHour + 7 }));
      try {
        assert.equal(changed.version, leisureDay.version + 1);
        const s = await freeSlot(admin, { times: ['11:00', '11:30', '12:00', '12:30', '13:00'] });
        const r = await book(parent, { courtId: s.courtId, date: s.date, time: s.time, playerId: yassine.id });
        assert.equal(r.price, leisureDay.pricePerHour + 7);
      } finally {
        const now = ok(await admin('GET', '/court-rates')).find((r) => r.id === leisureDay.id);
        ok(await admin('PATCH', `/court-rates/${leisureDay.id}`, { version: now.version, pricePerHour: leisureDay.pricePerHour }), 'tarif remis');
      }
    });
  });
});
