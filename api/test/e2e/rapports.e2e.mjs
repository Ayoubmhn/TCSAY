// Test de bout en bout : rapports de fin de saison (moral, financier) — chiffres calculés depuis la base (écritures
// importées comprises), textes du bureau (R13, reprise de la saison précédente), anciens rapports déposés (R8).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { docx, fileForm } from './helpers-fichiers.mjs';
import { as, ok, refused, uid } from './helpers.mjs';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('Rapports de fin de saison', () => {
  let admin, superviseur, parent, coach, s1, s2, file, closed;

  before(async () => {
    admin = await as('admin');
    superviseur = await as('superviseur');
    parent = await as('parent');
    coach = await as('coach');
    const seasons = ok(await admin('GET', '/seasons'));
    closed = seasons.find((s) => s.status === 'CLOSED');
    // Deux saisons passées consécutives, sur des années encore libres (la précédente de s2 doit être s1).
    const used = new Set(seasons.map((s) => Number(s.startDate.slice(0, 4))));
    let y = 1991;
    while (used.has(y) || used.has(y + 1)) y++;
    assert.ok(y < 2009, 'plus d’années libres : relancez sur une base de démo neuve');
    s1 = ok(await admin('POST', '/seasons', { label: `R${y}-${uid()}`, startDate: `${y}-09-01`, endDate: `${y + 1}-08-31`, status: 'HISTORICAL' }));
    s2 = ok(await admin('POST', '/seasons', { label: `R${y + 1}-${uid()}`, startDate: `${y + 1}-09-01`, endDate: `${y + 2}-08-31`, status: 'HISTORICAL' }));
    // Recettes et dépenses du cahier pour la saison s1.
    ok(await admin('POST', `/history/${s1.id}/commit/INCOME`, { source: 'MANUAL', table: [{ date: `${y}-10-01`, label: 'Don', category: 'DONATION', amount: '500' }, { date: `${y}-10-02`, label: 'Cotisations', category: 'FEES', amount: '2000' }] }));
    ok(await admin('POST', `/history/${s1.id}/commit/EXPENSE`, { source: 'MANUAL', table: [{ date: `${y}-11-01`, label: 'Salaire entraîneur', amount: '700' }, { date: `${y}-11-02`, label: 'Balles', category: 'EQUIPMENT', amount: '150' }] }));
  });

  test('rapport financier : recettes et dépenses importées comptées, résultat', async () => {
    const r = ok(await admin('GET', `/seasons/${s1.id}/reports`));
    const f = r.financial;
    assert.equal(f.income.fees, 2000);
    assert.deepEqual(f.income.other, [{ category: 'DONATION', count: 1, amount: 500 }]);
    assert.equal(f.income.imported, true);
    assert.equal(f.income.total, 2500);
    assert.equal(f.expenses.salaries, 700);
    assert.equal(f.expenses.categories.find((c) => c.category === 'EQUIPMENT').amount, 150);
    assert.equal(f.expenses.total, 850);
    assert.equal(f.result, 1650);
    assert.ok(r.moral, 'rapport moral calculé');
  });

  test('la saison suivante compare avec la précédente', async () => {
    const r = ok(await admin('GET', `/seasons/${s2.id}/reports`));
    assert.equal(r.previous.id, s1.id);
    assert.equal(r.financial.previous.result, 1650);
    assert.equal(r.financial.result, 0);
  });

  test('textes du bureau : enregistrés, version (R13), clés inconnues ignorées', async () => {
    let r = ok(await admin('PUT', `/seasons/${s1.id}/reports/drafts/MORAL`, { texts: { intro: 'Introduction test', inconnu: 'x' } }));
    assert.equal(r.version, 1);
    r = ok(await admin('PUT', `/seasons/${s1.id}/reports/drafts/MORAL`, { texts: { intro: 'Introduction v2' }, version: 1 }));
    assert.equal(r.version, 2);
    refused(await admin('PUT', `/seasons/${s1.id}/reports/drafts/MORAL`, { texts: { intro: 'Écrasement' }, version: 1 }), 409, /R13/);
    const d = ok(await admin('GET', `/seasons/${s1.id}/reports`)).drafts.MORAL;
    assert.equal(d.from, 'season');
    assert.equal(d.texts.intro, 'Introduction v2');
    assert.equal(d.texts.inconnu, undefined);
    refused(await admin('PUT', `/seasons/${s1.id}/reports/drafts/AUTRE`, { texts: {} }), 400);
  });

  test('sans textes, la saison suivante reprend ceux de la précédente', async () => {
    const d = ok(await admin('GET', `/seasons/${s2.id}/reports`)).drafts.MORAL;
    assert.equal(d.from, 'previous');
    assert.equal(d.texts.intro, 'Introduction v2');
    assert.equal(d.version, 0);
  });

  test('dépôt d’un ancien rapport : type réel vérifié, Word relu en texte', async () => {
    refused(await admin('POST', `/seasons/${s1.id}/reports/files`, fileForm(Buffer.from('pas un rapport'), 'rapport.docx', DOCX, { kind: 'MORAL' })), 400);
    refused(await admin('POST', `/seasons/${s1.id}/reports/files`, fileForm(Buffer.from('%PDF-1.4'), 'rapport.pdf', 'application/pdf', { kind: 'AUTRE' })), 400);
    const word = docx([['Membres', '42']], 'التقرير الأدبي لسنة الاختبار');
    file = ok(await admin('POST', `/seasons/${s1.id}/reports/files`, fileForm(word, 'rapport-moral.docx', DOCX, { kind: 'MORAL' })), 'dépôt');
    assert.equal(file.kind, 'MORAL');
    const t = ok(await admin('GET', `/seasons/${s1.id}/reports/files/${file.id}/text`));
    assert.ok(t.paragraphs.includes('التقرير الأدبي لسنة الاختبار'));
    const dl = await admin('GET', `/seasons/${s1.id}/reports/files/${file.id}`);
    assert.equal(dl.status, 200);
  });

  test('un PDF déposé n’a pas de texte (refus clair)', async () => {
    const pdf = ok(await admin('POST', `/seasons/${s1.id}/reports/files`, fileForm(Buffer.from('%PDF-1.4\n%test'), 'financier.pdf', 'application/pdf', { kind: 'FINANCIAL' })));
    refused(await admin('GET', `/seasons/${s1.id}/reports/files/${pdf.id}/text`), 400);
  });

  test('la saison suivante voit les rapports déposés de la précédente', async () => {
    const r = ok(await admin('GET', `/seasons/${s2.id}/reports`));
    assert.ok(r.previousFiles.some((f) => f.id === file.id));
  });

  test('R8 : retrait d’un rapport avec motif seulement', async () => {
    refused(await admin('POST', `/seasons/${s1.id}/reports/files/${file.id}/archive`, { reason: '' }), 400, /R8/);
    ok(await admin('POST', `/seasons/${s1.id}/reports/files/${file.id}/archive`, { reason: 'Mauvaise version' }));
    const r = ok(await admin('GET', `/seasons/${s1.id}/reports`));
    assert.ok(!r.files.some((f) => f.id === file.id));
    refused(await admin('POST', `/seasons/${s1.id}/reports/files/${file.id}/archive`, { reason: 'Encore' }), 404);
  });

  test('bilan de l’import : rapports déposés et textes comptés par saison', async () => {
    const h = ok(await admin('GET', '/history')).find((s) => s.id === s1.id);
    assert.equal(h.reports.FINANCIAL, 1);
    assert.equal(h.reports.MORAL, 0);
    assert.deepEqual(h.reports.drafts, ['MORAL']);
  });

  test('rapport d’une saison clôturée de la démo : chiffres calculés', async () => {
    if (!closed) return;
    const r = ok(await superviseur('GET', `/seasons/${closed.id}/reports`));
    assert.equal(typeof r.financial.income.total, 'number');
    assert.ok(Array.isArray(r.files));
  });

  test('droits : superviseur lit sans déposer ; parent et coach refusés', async () => {
    ok(await superviseur('GET', `/seasons/${s1.id}/reports`));
    refused(await superviseur('POST', `/seasons/${s1.id}/reports/files`, fileForm(Buffer.from('%PDF-1.4'), 'x.pdf', 'application/pdf', { kind: 'MORAL' })), 403);
    refused(await parent('GET', `/seasons/${s1.id}/reports`), 403);
    refused(await coach('GET', `/seasons/${s1.id}/reports`), 403);
  });
});
