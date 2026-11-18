// Test de bout en bout : météo de Sayada (bouton en haut à droite). Tous les espaces y ont accès ; jamais d'erreur,
// même sans réseau vers Open-Meteo (la prévision est alors « indisponible »). Base de DÉMONSTRATION uniquement.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { as, ok } from './helpers.mjs';

describe('Météo', () => {
  for (const name of ['admin', 'coach', 'parent']) {
    test(`${name} : prévision lisible`, async () => {
      const call = await as(name);
      const w = ok(await call('GET', '/weather'));
      assert.equal(typeof w.available, 'boolean');
      assert.equal(w.place, 'Sayada');
      assert.ok(Array.isArray(w.hours));
      if (w.available) assert.ok(w.current && Number.isFinite(w.current.temp));
    });
  }
});
