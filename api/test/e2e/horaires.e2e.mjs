// Test de bout en bout : horaires du club (ouverture, fermeture, nuit, délai d'annulation) — contrôles et séances hors horaires.
// Base de DÉMONSTRATION uniquement. Les horaires d'origine sont remis à la fin.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused } from './helpers.mjs';

describe('Horaires du club', () => {
  let admin, parent, initial;

  before(async () => {
    admin = await as('admin');
    parent = await as('parent');
    initial = ok(await admin('GET', '/settings'));
  });

  after(async () => {
    await admin('PUT', '/settings/hours', initial);
  });

  test('fermeture avant ouverture, nuit hors de la journée : refusées', async () => {
    refused(await admin('PUT', '/settings/hours', { ...initial, openingHour: 20, closingHour: 10 }), 400);
    refused(await admin('PUT', '/settings/hours', { ...initial, nightStartHour: initial.closingHour + 1 > 24 ? 0 : initial.closingHour + 1 }), 400);
  });

  test('séances habituelles hors des nouveaux horaires : refusé (R10)', async () => {
    refused(await admin('PUT', '/settings/hours', { ...initial, openingHour: 18 }), 409, /R10/);
    refused(await admin('PUT', '/settings/hours', { ...initial, closingHour: 12, nightStartHour: 12 }), 409, /R10/);
  });

  test('réservé à la direction (parent : 403)', async () => {
    refused(await parent('PUT', '/settings/hours', initial), 403);
  });

  test('changement accepté puis relu (nuit et délai d’annulation)', async () => {
    const r = ok(await admin('PUT', '/settings/hours', { ...initial, nightStartHour: initial.nightStartHour === 18 ? 19 : 18, cancelDelayHours: 12 }));
    assert.equal(r.cancelDelayHours, 12);
    const s = ok(await admin('GET', '/settings'));
    assert.equal(s.nightStartHour, initial.nightStartHour === 18 ? 19 : 18);
    const t = ok(await admin('GET', '/timetable'));
    assert.equal(t.hours.nightStart, s.nightStartHour);
  });
});
