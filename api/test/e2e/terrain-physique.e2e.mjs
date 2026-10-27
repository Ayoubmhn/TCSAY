// Test de bout en bout : terrain réservé aux séances physiques (démo : Annexe). Pas de tennis dessus (R5), pas de réservation
// en ligne, réglage refusé tant que des séances de tennis y sont placées. Base de DÉMONSTRATION uniquement.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

describe('Terrain réservé aux séances physiques', () => {
  let admin, parent, annexe, court3;
  const groups = [];
  const courts = async () => ok(await admin('GET', '/courts'));
  const setPhysical = async (value) => {
    const c = (await courts()).find((x) => x.id === annexe.id);
    return admin('PATCH', `/courts/${annexe.id}`, { version: c.version, physicalOnly: value });
  };
  // Créneaux à 05:00 le dimanche : aucun groupe de la démo à cette heure.
  const tennis = (courtId) => ({ day: 0, startTime: '05:00', endTime: '06:00', courtId, coachIds: [], kind: 'TENNIS' });
  const physical = (courtId) => ({ day: 0, startTime: '06:00', endTime: '07:00', courtId, coachIds: [], kind: 'PHYSICAL' });
  const group = (slots) =>
    admin('POST', '/groups', { name: `Physique ${uid()}`, capacity: 6, weeklyMinutes: 60, sessionMinutes: 60, physicalMinutes: 60, physicalSessionMinutes: 60, slots });

  before(async () => {
    admin = await as('admin');
    parent = await as('parent');
    const list = await courts();
    annexe = list.find((c) => c.name === 'Annexe');
    court3 = list.find((c) => c.name === 'Court 3');
    assert.ok(annexe && court3, 'terrains de la démo introuvables (relancer npm run db:demo)');
    if (!annexe.physicalOnly) ok(await setPhysical(true), 'Annexe au physique');
  });

  after(async () => {
    for (const id of groups) await admin('POST', `/groups/${id}/archive`);
    await setPhysical(true);
  });

  test('pas de séance de tennis sur un terrain réservé au physique (R5)', async () => {
    refused(await group([tennis(annexe.id)]), 409, /R5/);
  });

  test('une séance physique y est placée, le tennis sur un autre terrain', async () => {
    const g = ok(await group([tennis(court3.id), physical(annexe.id)]));
    groups.push(g.id);
    assert.ok(g.slots.some((s) => s.kind === 'PHYSICAL' && s.court?.id === annexe.id));
  });

  test('le terrain n’apparaît pas dans la grille de réservation des familles', async () => {
    const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const grid = ok(await parent('GET', `/reservations/grid?date=${date}`));
    assert.ok(!grid.courts.some((c) => c.id === annexe.id));
    const adminGrid = ok(await admin('GET', `/reservations/grid?date=${date}`));
    assert.ok(adminGrid.courts.some((c) => c.id === annexe.id), 'la direction le voit toujours');
  });

  test('réservé au physique refusé tant que du tennis y est placé ; accepté une fois déplacé', async () => {
    ok(await setPhysical(false), 'terrain normal');
    const g = ok(await group([tennis(annexe.id)]));
    groups.push(g.id);
    refused(await setPhysical(true), 409, /R5/);
    ok(await admin('POST', `/groups/${g.id}/archive`));
    ok(await setPhysical(true), 'de nouveau réservé au physique');
    assert.equal((await courts()).find((c) => c.id === annexe.id).physicalOnly, true);
  });
});
