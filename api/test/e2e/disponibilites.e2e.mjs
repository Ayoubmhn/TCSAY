// Test de bout en bout : disponibilités (semaine type, exceptions) et assistant de créneau de la direction.
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
// La grille de l'entraîneur Iheb est remise comme avant à la fin ; le groupe créé pour l'assistant est archivé.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

const today = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10); // heure du club (UTC+1)
const inDays = (n) => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('Disponibilités et assistant de créneau', () => {
  let admin, dt, coach, parent, agent, lina, adam, ihebCoachId, saved, group;

  before(async () => {
    [admin, dt, coach, parent, agent] = await Promise.all([as('admin'), as('dt'), as('coach'), as('parent'), as('agent')]);
    ihebCoachId = ok(await coach('GET', '/auth/me')).coachId;
    const players = ok(await admin('GET', '/players'));
    lina = players.find((p) => p.firstName === 'Lina' && p.lastName === 'Ben Ali');
    adam = players.find((p) => p.firstName === 'Adam');
    saved = ok(await coach('GET', '/availability/me')).grid;
  });

  after(async () => {
    if (saved) await coach('PUT', '/availability/me', { grid: saved });
    if (group) await admin('POST', `/groups/${group.id}/archive`);
  });

  test('l’entraîneur enregistre sa semaine type (cases inconnues ignorées)', async () => {
    // Lundi : seulement 10h et 11h possibles (préférées), tout le reste de la semaine indisponible.
    const grid = {};
    for (const day of [0, 1, 2, 3, 4, 5, 6]) for (let h = 8; h <= 21; h++) grid[`${day}-${h}`] = 'I';
    grid['1-10'] = 'P';
    grid['1-11'] = 'P';
    ok(await coach('PUT', '/availability/me', { grid: { ...grid, '7-10': 'D', '1-23': 'D', 'lundi-9': 'D' } }));
    const r = ok(await coach('GET', '/availability/me'));
    assert.equal(r.grid['1-10'], 'P');
    assert.equal(r.grid['7-10'], undefined);
    assert.equal(r.grid['1-23'], undefined);
    assert.equal(r.grid['lundi-9'], undefined);
    assert.equal(r.grid['2-9'], 'I');
    assert.equal(r.hours.length, 14);
  });

  test('exceptions : fin avant début et motif vide refusés ; ajout puis suppression', async () => {
    refused(await coach('POST', '/availability/me/exceptions', { from: inDays(5), to: inDays(2), reason: 'Stage' }), 400);
    refused(await coach('POST', '/availability/me/exceptions', { from: inDays(2), to: inDays(5), reason: '' }), 400);
    const reason = `Stage fédéral ${uid()}`;
    const { id } = ok(await coach('POST', '/availability/me/exceptions', { from: inDays(2), to: inDays(5), reason }));
    assert.ok(ok(await coach('GET', '/availability/me')).exceptions.some((e) => e.id === id && e.reason === reason));
    const dir = ok(await dt('GET', '/availability/coaches')).coaches.find((c) => c.id === ihebCoachId);
    assert.ok(dir.exceptions.some((e) => e.id === id), 'la direction voit l’exception');
    refused(await parent('DELETE', `/availability/me/exceptions/${id}?playerId=${lina.id}`), 404);
    ok(await coach('DELETE', `/availability/me/exceptions/${id}`));
    assert.ok(!ok(await coach('GET', '/availability/me')).exceptions.some((e) => e.id === id));
  });

  test('le parent remplit la grille de Lina, pas celle d’un enfant d’une autre famille', async () => {
    ok(await parent('PUT', '/availability/me', { playerId: lina.id, grid: { '1-10': 'D', '1-11': 'I' } }));
    assert.equal(ok(await parent('GET', `/availability/me?playerId=${lina.id}`)).grid['1-11'], 'I');
    refused(await parent('PUT', '/availability/me', { playerId: adam.id, grid: { '1-10': 'D' } }), 403);
  });

  test('grilles des entraîneurs : direction seulement', async () => {
    const r = ok(await dt('GET', '/availability/coaches'));
    const iheb = r.coaches.find((c) => c.id === ihebCoachId);
    assert.equal(iheb.filled, true);
    assert.ok(iheb.slots.length > 0, 'les créneaux de l’entraîneur sont listés');
    refused(await coach('GET', '/availability/coaches'), 403);
    refused(await agent('GET', '/availability/coaches'), 403);
  });

  test('assistant : seulement les heures où l’entraîneur est disponible, terrain éclairé la nuit', async () => {
    group = ok(
      await admin('POST', '/groups', {
        name: `E2E Assistant ${uid()}`,
        capacity: 4,
        slots: [{ day: 3, startTime: '06:00', endTime: '06:30', coachIds: [] }],
      }),
    );
    ok(await admin('POST', `/groups/${group.id}/members`, { playerId: lina.id }));
    refused(await dt('POST', '/availability/suggest', { coachId: ihebCoachId, duration: 20 }), 400);
    const r = ok(await dt('POST', '/availability/suggest', { coachId: ihebCoachId, groupId: group.id, duration: 60 }));
    assert.equal(r.coachFilled, true);
    assert.equal(r.players.known, 1);
    assert.ok(r.slots.length > 0, 'au moins une proposition');
    for (const s of r.slots) {
      assert.equal(s.day, 1, 'lundi seulement');
      assert.ok(s.startTime >= '10:00' && s.endTime <= '12:00', `${s.startTime}–${s.endTime} hors des heures disponibles`);
      assert.equal(s.preferred, true);
    }
    // Lina est indisponible à 11h : la proposition 10:00–11:00 a tous les joueurs, 11:00–12:00 aucun.
    const ten = r.slots.find((s) => s.startTime === '10:00');
    assert.equal(ten.playersAvailable, 100);
    assert.ok(r.slots.every((s) => s.night === false));
    refused(await coach('POST', '/availability/suggest', { coachId: ihebCoachId, duration: 60 }), 403);
  });

  test('ajout du créneau choisi au groupe, puis le même créneau est refusé (R5)', async () => {
    const r = ok(await dt('POST', '/availability/suggest', { coachId: ihebCoachId, groupId: group.id, duration: 60 }));
    const s = r.slots.find((x) => x.startTime === '10:00');
    const body = { groupId: group.id, coachId: ihebCoachId, courtId: s.courtId, day: s.day, startTime: s.startTime, endTime: s.endTime };
    ok(await dt('POST', '/availability/apply', body));
    const g = ok(await admin('GET', '/groups')).find((x) => x.id === group.id);
    assert.ok(g.slots.some((x) => x.day === 1 && x.startTime === '10:00' && x.court?.id === s.courtId));
    refused(await dt('POST', '/availability/apply', body), 409, /R5/);
    // L'entraîneur est désormais pris le lundi à 10h : l'assistant ne le propose plus.
    const again = ok(await dt('POST', '/availability/suggest', { coachId: ihebCoachId, duration: 60 }));
    assert.ok(!again.slots.some((x) => x.day === 1 && x.startTime < '11:00'));
  });
});
