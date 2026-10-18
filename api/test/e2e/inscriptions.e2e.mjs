// Test de bout en bout : import Excel des joueurs (tableau corrigé à l'écran, R14 origine IMPORT) et réinscriptions (R1, R3).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

const fakeCin = () => ('T' + uid()).slice(0, 12); // CIN fictive unique
const fakeEmail = (prefix = 'e2e') => `${prefix}.${uid()}@exemple.tn`;
/** Ligne vide du tableau d'import (toutes les colonnes du cahier). */
const EMPTY = { n: '', gender: '', name: '', nameAr: '', birth: '', phone: '', email: '', parent: '', parentEmail: '', group: '', city: '', remark: '' };

describe('Import Excel des joueurs (tableau modifiable)', () => {
  let admin, coach, year, rows, nom, preview;

  before(async () => {
    admin = await as('admin');
    coach = await as('coach');
    year = new Date(ok(await admin('GET', '/seasons/active')).startDate).getUTCFullYear();
    nom = `Importe${uid().replace(/\d/g, 'x')}`; // nom sans chiffres, unique
    const tel = String(20_000_000 + Math.floor(Math.random() * 9_999_999)); // téléphone unique : parent nouveau
    rows = [
      { ...EMPTY, n: '1', gender: 'f', name: `Amira ${nom}`, birth: `${year - 10}-05-05`, phone: tel, parent: 'Mounira' },
      { ...EMPTY, n: '2', gender: 'h', name: `Sami ${nom}`, birth: `${year - 8}-02-02`, phone: tel, parent: 'Mounira', group: 'Groupe inconnu E2E' },
      { ...EMPTY, n: '3', gender: '?', name: `Sansgenre ${nom}` },
      { ...EMPTY, n: '4', gender: 'f', name: `Amira ${nom}`, birth: `${year - 10}-05-05` },
    ];
  });

  test('aperçu : rien n’est enregistré, chaque ligne a son statut', async () => {
    preview = ok(await admin('POST', '/players/import/preview-table', { fileName: 'e2e.xlsx', rows }));
    assert.equal(preview.total, 4);
    const [amira, sami, sansGenre, doublon] = preview.rows;
    assert.equal(amira.status, 'ok');
    assert.equal(amira.category.code, 'J11F');
    assert.equal(sami.status, 'warning', 'groupe introuvable = avertissement');
    assert.ok(sami.messages.some((m) => /introuvable/.test(m)));
    assert.equal(sansGenre.status, 'error');
    assert.equal(doublon.status, 'error', 'doublon dans le fichier');
    assert.equal(preview.newParents, 1, 'frère et sœur avec le même téléphone et le même prénom de parent = un seul parent');
    assert.equal(ok(await admin('GET', `/players?q=${nom}`)).length, 0, 'l’aperçu n’enregistre rien');
  });

  test('ligne corrigée à l’écran : l’analyse est refaite', async () => {
    const fixed = rows.map((r, i) => (i === 2 ? { ...r, gender: 'h', birth: `${year - 12}-01-01` } : r));
    const p = ok(await admin('POST', '/players/import/preview-table', { fileName: 'e2e.xlsx', rows: fixed }));
    assert.notEqual(p.rows[2].status, 'error');
  });

  test('enregistrement : lignes valides importées, lignes en erreur ignorées', async () => {
    const r = ok(await admin('POST', '/players/import/commit-table', { fileName: 'e2e.xlsx', rows, plan: 'FULL' }));
    assert.equal(r.skipped.length, 2);
    const players = ok(await admin('GET', `/players?q=${nom}`));
    assert.equal(players.length, 2);
    for (const p of players) {
      assert.equal(p.origin, 'IMPORT', 'R14 : origine IMPORT');
      assert.ok(p.importRef, 'R14 : ligne d’origine conservée');
      assert.equal(p.parents.length, 1);
      assert.match(p.parents[0].email ?? '', /@a-completer\.invalid$/, 'email provisoire du parent (jamais d’envoi)');
    }
    assert.equal(players[0].parents[0].id, players[1].parents[0].id, 'parent partagé par le frère et la sœur');
  });

  test('relancer le même import : déjà enregistrés, rien n’est créé en double', async () => {
    const p = ok(await admin('POST', '/players/import/preview-table', { fileName: 'e2e.xlsx', rows: rows.slice(0, 2) }));
    assert.ok(p.rows.every((r) => r.status === 'error' && r.messages.some((m) => /déjà enregistré/.test(m))));
    refused(await admin('POST', '/players/import/commit-table', { fileName: 'e2e.xlsx', rows: rows.slice(0, 2) }), 400); // aucune ligne importable
    assert.equal(ok(await admin('GET', `/players?q=${nom}`)).length, 2);
  });

  test('colonne inconnue ou mode de paiement CUSTOM refusés', async () => {
    refused(await admin('POST', '/players/import/preview-table', { fileName: 'e2e.xlsx', rows: [{ ...EMPTY, autre: 'x' }] }), 400);
    refused(await admin('POST', '/players/import/commit-table', { fileName: 'e2e.xlsx', rows: [], plan: 'CUSTOM' }), 400);
  });

  test('fichier absent : message clair', async () => {
    refused(await admin('POST', '/players/import/preview', new FormData()), 400);
  });

  test('le coach n’importe pas', async () => {
    refused(await coach('POST', '/players/import/preview-table', { fileName: 'e2e.xlsx', rows }), 403);
  });
});

describe('Réinscriptions pour une nouvelle saison', () => {
  let admin, parent, brouillon, cloturee, joueur, cats;

  before(async () => {
    admin = await as('admin');
    parent = await as('parent');
    const seasons = ok(await admin('GET', '/seasons'));
    const active = seasons.find((s) => s.status === 'ACTIVE');
    brouillon = seasons.find((s) => s.status === 'DRAFT' && s.startDate > active.startDate);
    cloturee = seasons.find((s) => s.status === 'CLOSED');
    cats = ok(await admin('GET', '/categories'));
    const year = new Date(active.startDate).getUTCFullYear();
    joueur = ok(await admin('POST', '/players', {
      firstName: 'Reinscrit', lastName: `E2E${uid()}`, birthDate: `${year - 9}-03-03`, gender: 'M',
      newParent: { firstName: 'Parent', lastName: `E2E${uid()}`, phone: '20000030', email: fakeEmail('parent'), cin: fakeCin() },
    }));
  });

  test('liste : le joueur de la saison active, avec sa catégorie proposée pour la nouvelle saison', async () => {
    assert.ok(brouillon, 'une saison brouillon suivante est attendue dans la démo');
    const r = ok(await admin('GET', `/reenrollments?seasonId=${brouillon.id}`));
    const row = r.players.find((p) => p.id === joueur.id);
    assert.ok(row, 'joueur absent de la liste');
    assert.equal(row.enrolled, null);
    assert.equal(row.suggested.name, 'Benjamins (-11)', 'un an de plus = catégorie suivante');
    assert.ok(r.plans.length > 0, 'modes de paiement proposés');
  });

  test('R3 : catégorie hors norme sans motif = ligne ignorée', async () => {
    const r = ok(await admin('POST', '/reenrollments', {
      seasonId: brouillon.id, items: [{ playerId: joueur.id, categoryId: cats.find((c) => c.code === 'J18M').id, paymentPlan: 'FULL' }],
    }));
    assert.equal(r.enrolled, 0);
    assert.match(r.skipped[0].reason, /R3/);
  });

  test('réinscription avec la catégorie proposée, puis refus du doublon', async () => {
    const r = ok(await admin('POST', '/reenrollments', { seasonId: brouillon.id, items: [{ playerId: joueur.id, paymentPlan: 'FULL' }] }));
    assert.equal(r.enrolled, 1, JSON.stringify(r.skipped));
    const again = ok(await admin('POST', '/reenrollments', { seasonId: brouillon.id, items: [{ playerId: joueur.id, paymentPlan: 'FULL' }] }));
    assert.equal(again.enrolled, 0);
    assert.match(again.skipped[0].reason, /déjà inscrit/);
    const list = ok(await admin('GET', `/reenrollments?seasonId=${brouillon.id}`));
    assert.ok(list.players.find((p) => p.id === joueur.id).enrolled);
  });

  test('R1 : pas de réinscription dans une saison clôturée', async () => {
    refused(await admin('POST', '/reenrollments', { seasonId: cloturee.id, items: [{ playerId: joueur.id, paymentPlan: 'FULL' }] }), 409, /R1/);
  });

  test('le parent n’a pas accès aux réinscriptions', async () => {
    refused(await parent('GET', `/reenrollments?seasonId=${brouillon.id}`), 403);
  });
});
