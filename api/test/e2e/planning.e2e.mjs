// Test de bout en bout : planning des terrains d'un jour (séances des groupes, réservations, légende des entraîneurs).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs). La réservation créée est annulée à la fin.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused } from './helpers.mjs';

const tunisToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

describe('Planning des terrains', () => {
  let admin, agent, parent, coach, resa, slot;

  before(async () => {
    admin = await as('admin');
    agent = await as('agent');
    parent = await as('parent');
    coach = await as('coach');
  });

  after(async () => {
    if (resa) await admin('POST', `/reservations/${resa.id}/cancel`, { reason: 'Nettoyage test E2E' });
  });

  test('la direction voit le planning du jour : terrains, horaires du club, légende', async () => {
    const p = ok(await admin('GET', '/planning'));
    assert.equal(p.date, tunisToday());
    assert.ok(p.courts.length > 0, 'aucun terrain');
    assert.ok(p.openingHour < p.closingHour);
    assert.equal(typeof p.nightStartHour, 'number');
    assert.ok(Array.isArray(p.sessions) && Array.isArray(p.reservations) && Array.isArray(p.legend));
  });

  test('un jour de semaine de la saison active montre les séances des groupes', async () => {
    let found = null;
    for (let k = 1; k <= 7 && !found; k++) {
      const date = addDays(tunisToday(), k);
      if ([0, 6].includes(weekday(date))) continue;
      const p = ok(await admin('GET', `/planning?date=${date}`));
      if (p.sessions.length) found = p;
    }
    assert.ok(found, 'aucune séance de groupe en semaine (relancer npm run db:demo)');
    const s = found.sessions[0];
    assert.ok(s.group?.id && s.group?.name, 'séance sans groupe');
    assert.equal(typeof s.members, 'number');
    assert.ok('present' in s.attendance && 'absent' in s.attendance);
    assert.ok(found.courts.some((c) => c.id === s.courtId) || s.courtId == null);
  });

  test('une réservation apparaît dans le planning de son jour', async () => {
    for (let k = 3; k <= 30 && !resa; k++) {
      const date = addDays(tunisToday(), k);
      const g = ok(await admin('GET', `/reservations/grid?date=${date}`));
      for (const row of g.slots) {
        const i = row.times.findIndex((t, j) => t.state === 'free' && row.times[j + 1]?.state === 'free' && t.time >= '09:00' && t.time <= '15:00');
        if (i >= 0) {
          slot = { courtId: row.courtId, date, time: row.times[i].time };
          resa = ok(await admin('POST', '/reservations', { courtId: slot.courtId, date, time: slot.time }), 'réservation');
          break;
        }
      }
    }
    assert.ok(resa, 'aucun créneau libre');
    const p = ok(await admin('GET', `/planning?date=${slot.date}`));
    const r = p.reservations.find((x) => x.id === resa.id);
    assert.ok(r, 'réservation absente du planning');
    assert.equal(r.courtId, slot.courtId);
    assert.equal(r.startTime, slot.time);
    assert.equal(r.type, 'LEISURE');
  });

  test('une réservation annulée disparaît du planning', async () => {
    ok(await admin('POST', `/reservations/${resa.id}/cancel`, { reason: 'Test E2E' }));
    const p = ok(await admin('GET', `/planning?date=${slot.date}`));
    assert.ok(!p.reservations.some((x) => x.id === resa.id));
    resa = null;
  });

  test('l’agent administratif (planning.view) y a accès', async () => {
    ok(await agent('GET', '/planning'));
  });

  test('famille et entraîneur : planning de la direction refusé (403)', async () => {
    refused(await parent('GET', '/planning'), 403);
    refused(await coach('GET', '/planning'), 403);
  });

  test('date au mauvais format refusée (400)', async () => {
    refused(await admin('GET', '/planning?date=18-10-2026'), 400);
  });
});
