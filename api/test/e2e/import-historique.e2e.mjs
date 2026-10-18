// Test de bout en bout : import historique (saisons passées) — lecture Excel / Word, aperçu, enregistrement par lot
// (origine IMPORT, R14), joueurs retrouvés d'une saison à l'autre, recettes et dépenses, annulation d'un lot (R8),
// refus sur une saison gérée dans l'application (R1).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { docx, fileForm, xlsx } from './helpers-fichiers.mjs';
import { as, ok, refused, uid } from './helpers.mjs';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Lettres seulement (les noms ne doivent pas contenir de chiffres). */
const letters = () =>
  uid()
    .replace(/[^a-z]/g, '')
    .padEnd(6, 'x')
    .slice(0, 6);

describe('Import historique (R1, R8, R14)', () => {
  let admin, parent, active, s1, s2, playersBatch, incomeBatch;
  const year = 1951 + Math.floor(Math.random() * 38); // années libres, loin des saisons de la démo
  const tag = letters();
  const p1 = `Testa${tag} Historique`;
  const p2 = `Testb${tag} Archive`;

  before(async () => {
    admin = await as('admin');
    parent = await as('parent');
    active = ok(await admin('GET', '/seasons/active'));
    s1 = ok(await admin('POST', '/seasons', { label: `H${year}-${uid()}`, startDate: `${year}-09-01`, endDate: `${year + 1}-08-31`, status: 'HISTORICAL' }), 'saison passée 1');
    s2 = ok(await admin('POST', '/seasons', { label: `H${year + 1}-${uid()}`, startDate: `${year + 1}-09-01`, endDate: `${year + 2}-08-31`, status: 'HISTORICAL' }), 'saison passée 2');
  });

  test('R1 : import refusé dans la saison active (gérée dans l’application)', async () => {
    refused(await admin('POST', `/history/${active.id}/preview/PLAYERS`, { table: [{ name: p1, gender: 'h' }] }), 400, /R1/);
  });

  test('registre inconnu et fichier non Excel / Word refusés', async () => {
    refused(await admin('POST', `/history/${s1.id}/preview/LOTO`, { table: [] }), 400);
    refused(await admin('POST', '/history/read/PLAYERS', fileForm(Buffer.from('a;b'), 'joueurs.csv', 'text/csv')), 400);
  });

  test('lecture d’un Excel : en-têtes reconnus (titre ignoré), lignes du tableau', async () => {
    const file = xlsx([
      ['Liste des adhérents de la saison'],
      ['N°', 'Nom et prénom', 'Genre', 'Date de naissance', 'Remarque'],
      [1, p1, 'Garçon', `12/03/${year - 10}`, 'Cahier p. 3'],
      [2, p2, 'F', '', ''],
      ['', 'TOTAL', '', '', ''],
    ]);
    const r = ok(await admin('POST', '/history/read/PLAYERS', fileForm(file, 'joueurs.xlsx', XLSX)), 'lecture xlsx');
    assert.equal(r.source, 'EXCEL');
    assert.equal(r.table.length, 2, 'la ligne de total est ignorée');
    assert.equal(r.table[0].name, p1);
    assert.equal(r.table[0].gender, 'h');
    assert.equal(r.table[1].gender, 'f');
    assert.equal(r.table[0].birth, `12/03/${year - 10}`, 'date gardée telle que saisie');
  });

  test('lecture d’un Word : journal de caisse à deux colonnes, recettes seulement', async () => {
    const file = docx([
      ['Date', 'Libellé', 'Recettes', 'Dépenses'],
      [`05/10/${year}`, `Cotisation ${p1}`, '120,500', ''],
      [`06/10/${year}`, 'Facture STEG', '', '80'],
      [`07/10/${year}`, 'Don d’un membre', '300', ''],
    ]);
    const r = ok(await admin('POST', '/history/read/INCOME', fileForm(file, 'caisse.docx', DOCX)), 'lecture docx');
    assert.equal(r.source, 'WORD');
    assert.equal(r.table.length, 2, 'la ligne de dépense va dans l’autre registre');
    assert.equal(r.table[0].category, 'FEES');
    assert.equal(r.table[1].category, 'DONATION');
  });

  test('aperçu des joueurs : nouveau, genre manquant en erreur, sans naissance compté en Loisirs', async () => {
    const r = ok(
      await admin('POST', `/history/${s1.id}/preview/PLAYERS`, {
        table: [
          { name: p1, gender: 'h', birth: `${year - 10}-03-12` },
          { name: p2, gender: 'f' },
          { name: `Sansgenre${tag} Test`, gender: '' },
        ],
      }),
    );
    assert.equal(r.total, 3);
    assert.equal(r.errors, 1);
    const [a, b, c] = r.rows;
    assert.equal(a.player, null, 'joueur inconnu : nouveau');
    assert.ok(a.category, 'catégorie proposée d’après l’âge et le genre');
    assert.match(b.messages.join(' '), /Loisirs/);
    assert.equal(c.status, 'error');
  });

  test('enregistrement des joueurs en un lot (les lignes en erreur sont ignorées)', async () => {
    const r = ok(
      await admin('POST', `/history/${s1.id}/commit/PLAYERS`, {
        source: 'EXCEL',
        fileName: 'joueurs.xlsx',
        table: [
          { name: p1, gender: 'h', birth: `${year - 10}-03-12` },
          { name: p2, gender: 'f' },
          { name: `Sansgenre${tag} Test`, gender: '' },
        ],
      }),
    );
    assert.equal(r.created, 2);
    assert.equal(r.skipped, 1);
    playersBatch = r.batchId;
    const players = ok(await admin('GET', `/players?seasonId=${s1.id}&q=${encodeURIComponent(`Testa${tag}`)}`));
    const found = players.find((p) => `${p.firstName} ${p.lastName}` === p1);
    assert.ok(found, 'le joueur importé est inscrit à la saison passée');
    assert.match(found.memberCode ?? '', new RegExp(`^${String(year).slice(2)}TCSAY`), 'code de l’année de la saison');
  });

  test('le même joueur dans la saison suivante est retrouvé automatiquement', async () => {
    const r = ok(await admin('POST', `/history/${s2.id}/preview/PLAYERS`, { table: [{ name: p1, gender: 'h', birth: `${year - 10}-03-12` }] }));
    assert.ok(r.rows[0].player, 'retrouvé par le nom et la naissance');
    assert.equal(r.found, 1);
    const c = ok(await admin('POST', `/history/${s2.id}/commit/PLAYERS`, { source: 'MANUAL', table: [{ name: p1, gender: 'h', birth: `${year - 10}-03-12` }] }));
    assert.equal(c.linked, 1);
    assert.equal(c.created, 0);
  });

  test('un joueur déjà inscrit à la saison est signalé en erreur', async () => {
    const r = ok(await admin('POST', `/history/${s1.id}/preview/PLAYERS`, { table: [{ name: p1, gender: 'h', birth: `${year - 10}-03-12` }] }));
    assert.equal(r.rows[0].status, 'error');
    assert.match(r.rows[0].messages.join(' '), /déjà inscrit/);
  });

  test('recettes : montants lus (virgule), joueur reconnu dans le libellé, total', async () => {
    const table = [
      { date: `${year}-10-05`, label: `Cotisation ${p1}`, amount: '120,500' },
      { date: `${year}-11-02`, label: 'Subvention municipale', amount: '1 000' },
      { date: `${year}-11-03`, label: 'Ligne vide de montant', amount: '' },
    ];
    const pv = ok(await admin('POST', `/history/${s1.id}/preview/INCOME`, { table }));
    assert.equal(pv.errors, 1, 'montant manquant');
    assert.equal(pv.amount, 1120.5);
    assert.equal(pv.rows[0].category, 'FEES');
    assert.equal(pv.rows[0].player?.name, p1);
    assert.equal(pv.rows[1].category, 'GRANT');
    const c = ok(await admin('POST', `/history/${s1.id}/commit/INCOME`, { source: 'WORD', fileName: 'caisse.docx', table }));
    assert.equal(c.created, 2);
    incomeBatch = c.batchId;
    const entries = ok(await admin('GET', `/history/${s1.id}/entries?kind=INCOME`));
    assert.equal(entries.length, 2);
    assert.ok(entries.find((e) => e.category === 'FEES').player, 'recette liée au joueur');
  });

  test('dépenses : nature déduite du libellé (salaire, STEG)', async () => {
    const table = [
      { date: `${year}-12-01`, label: 'Salaire entraîneur décembre', amount: '400' },
      { date: `${year}-12-10`, label: 'Facture STEG', amount: '85,250' },
    ];
    const pv = ok(await admin('POST', `/history/${s1.id}/preview/EXPENSE`, { table }));
    assert.deepEqual(
      pv.rows.map((r) => r.category),
      ['SALARY', 'UTILITIES'],
    );
    const c = ok(await admin('POST', `/history/${s1.id}/commit/EXPENSE`, { source: 'MANUAL', table }));
    assert.equal(c.amount, 485.25);
  });

  test('bilan des saisons passées : joueurs, déjà venus, recettes, dépenses, lots', async () => {
    const all = ok(await admin('GET', '/history'));
    const a = all.find((s) => s.id === s1.id);
    const b = all.find((s) => s.id === s2.id);
    assert.equal(a.players, 2);
    assert.equal(a.importedPlayers, 2);
    assert.equal(a.income, 1120.5);
    assert.equal(a.expenses, 485.25);
    assert.equal(a.result, 635.25);
    assert.equal(a.batches.length, 3);
    assert.equal(b.returning, 1, 'le joueur de la saison précédente compte comme « déjà venu »');
  });

  test('annulation d’un lot : motif obligatoire, écritures archivées, double annulation refusée', async () => {
    refused(await admin('POST', `/history/batches/${incomeBatch}/cancel`, { reason: '' }), 400);
    const r = ok(await admin('POST', `/history/batches/${incomeBatch}/cancel`, { reason: 'Mauvais fichier (test)' }));
    assert.equal(r.entries, 2);
    assert.equal(ok(await admin('GET', `/history/${s1.id}/entries?kind=INCOME`)).length, 0);
    refused(await admin('POST', `/history/batches/${incomeBatch}/cancel`, { reason: 'Encore' }), 400);
  });

  test('annulation du lot des joueurs : inscriptions retirées, joueur sans autre saison archivé (R8)', async () => {
    const r = ok(await admin('POST', `/history/batches/${playersBatch}/cancel`, { reason: 'Test terminé' }));
    assert.equal(r.enrollments, 2);
    assert.equal(r.players, 1, `${p2} n’a pas d’autre saison : archivé ; ${p1} reste (saison suivante)`);
    const a = ok(await admin('GET', '/history')).find((s) => s.id === s1.id);
    assert.equal(a.players, 0);
    assert.ok(a.batches.find((b) => b.id === playersBatch).cancelledAt);
  });

  test('l’annulation est tracée dans l’audit avec son motif', async () => {
    const row = ok(await admin('GET', '/audit')).find((x) => x.entityId === playersBatch && x.action === 'Import historique annulé');
    assert.ok(row);
    assert.equal(row.reason, 'Test terminé');
  });

  test('un parent n’a pas accès à l’import (403)', async () => {
    refused(await parent('GET', '/history'), 403);
    refused(await parent('POST', `/history/${s1.id}/preview/PLAYERS`, { table: [] }), 403);
  });
});
