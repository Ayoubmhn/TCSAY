// Test de bout en bout : projets (devis, décision du bureau, états, dépenses rattachées, archivage R8, version R13),
// budget de la saison (prévu / réel, R1 saison verrouillée) et trésorerie (solde, prévision sur 12 mois).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

const today = new Date().toISOString().slice(0, 10);
const pdf = () => new Blob(['%PDF-1.4\n% devis e2e\n'], { type: 'application/pdf' });

/** Ajoute un devis (multipart : champs texte + fichier facultatif). */
function quoteForm(fields, withFile = false) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  if (withFile) f.append('file', pdf(), 'devis.pdf');
  return f;
}

describe('Projets : devis et décision du bureau', () => {
  let admin, superviseur, parent, agent, project, quoteA, quoteB, expense;
  const title = `Résine terrain test ${uid()}`;

  before(async () => {
    admin = await as('admin');
    superviseur = await as('superviseur');
    parent = await as('parent');
    agent = await as('agent');
  });

  test('création refusée sans titre ou avec une priorité hors 1–3', async () => {
    refused(await admin('POST', '/projects', { title: '', category: 'COURT', priority: 1 }), 400);
    refused(await admin('POST', '/projects', { title, category: 'COURT', priority: 5 }), 400);
  });

  test('le président crée un projet (Idée)', async () => {
    project = ok(await admin('POST', '/projects', { title, category: 'COURT', priority: 1, estimatedAmount: 20000 }), 'création');
    assert.equal(project.status, 'IDEA');
    assert.equal(project.budget, 20000);
    const list = ok(await admin('GET', '/projects'));
    assert.ok(list.projects.some((p) => p.id === project.id));
  });

  test('R13 : modification avec une version périmée refusée', async () => {
    refused(await admin('PATCH', `/projects/${project.id}`, { title, category: 'COURT', priority: 2, version: project.version + 4 }), 409, /R13/);
  });

  test('valider sans devis est impossible (passage manuel à « Validé » refusé)', async () => {
    refused(await admin('POST', `/projects/${project.id}/status`, { status: 'APPROVED', version: project.version }), 400);
  });

  test('premier devis (avec PDF) : le projet passe en « Devis en cours »', async () => {
    quoteA = ok(await admin('POST', `/projects/${project.id}/quotes`, quoteForm({ supplier: 'Entreprise Exemple A', amount: 18000, delayDays: 30 }, true)), 'devis A').id;
    quoteB = ok(await admin('POST', `/projects/${project.id}/quotes`, quoteForm({ supplier: 'Entreprise Exemple B', amount: 15900, delayDays: 45, validUntil: '2020-01-01' })), 'devis B').id;
    const d = ok(await admin('GET', `/projects/${project.id}`));
    assert.equal(d.status, 'QUOTES');
    const a = d.quotes.find((q) => q.id === quoteA);
    const b = d.quotes.find((q) => q.id === quoteB);
    assert.equal(b.cheapest, true, 'le devis B est le moins cher');
    assert.equal(a.fastest, true, 'le devis A est le plus rapide');
    assert.equal(a.gap, 2100);
    assert.equal(b.expired, true);
    assert.equal(a.fileName, 'devis.pdf');
    const file = await admin('GET', `/projects/${project.id}/quotes/${quoteA}/file`);
    assert.equal(file.status, 200);
    project = d;
  });

  test('un devis avec un fichier texte est refusé', async () => {
    const f = quoteForm({ supplier: 'Fournisseur texte', amount: 100 });
    f.append('file', new Blob(['x'], { type: 'text/plain' }), 'devis.txt');
    refused(await admin('POST', `/projects/${project.id}/quotes`, f), 400);
  });

  test('choisir un devis sans motif est refusé', async () => {
    refused(await admin('POST', `/projects/${project.id}/choose`, { quoteId: quoteB, reason: '', version: project.version }), 400);
  });

  test('le bureau choisit le devis B avec motif : projet validé', async () => {
    project = ok(await admin('POST', `/projects/${project.id}/choose`, { quoteId: quoteB, reason: 'Moins cher, délai acceptable', version: project.version }));
    assert.equal(project.status, 'APPROVED');
    assert.equal(project.chosenQuote.id, quoteB);
    assert.equal(project.budget, 15900);
    assert.equal(project.decisionReason, 'Moins cher, délai acceptable');
  });

  test('le devis choisi ne peut pas être écarté ; l’autre si, avec motif (gardé, R8)', async () => {
    refused(await admin('POST', `/projects/${project.id}/quotes/${quoteB}/archive`, { reason: 'Test' }), 400);
    refused(await admin('POST', `/projects/${project.id}/quotes/${quoteA}/archive`, { reason: '' }), 400);
    ok(await admin('POST', `/projects/${project.id}/quotes/${quoteA}/archive`, { reason: 'Trop cher' }));
    const d = ok(await admin('GET', `/projects/${project.id}`));
    assert.equal(d.quotes.find((q) => q.id === quoteA).archived, true, 'le devis écarté reste visible');
    project = d;
  });

  test('une dépense rattachée compte dans le payé du projet', async () => {
    expense = ok(await agent('POST', '/expenses', { category: 'MAINTENANCE', label: `Acompte résine ${uid()}`, amount: 5000, date: today, paidAt: today, method: 'TRANSFER' }));
    ok(await admin('POST', `/projects/${project.id}/expenses`, { expenseId: expense.id }));
    let d = ok(await admin('GET', `/projects/${project.id}`));
    assert.equal(d.spent, 5000);
    assert.ok(d.expenses.some((e) => e.id === expense.id));
    const listed = ok(await agent('GET', `/expenses?q=${encodeURIComponent(expense.label)}`)).rows[0];
    assert.equal(listed.project.id, project.id, 'la dépense affiche son projet');
    ok(await admin('POST', `/projects/${project.id}/expenses/${expense.id}/unlink`));
    d = ok(await admin('GET', `/projects/${project.id}`));
    assert.equal(d.spent, 0);
    ok(await admin('POST', `/projects/${project.id}/expenses`, { expenseId: expense.id }));
    project = d;
  });

  test('une dépense déjà rattachée à un autre projet est refusée', async () => {
    const other = ok(await admin('POST', '/projects', { title: `Autre projet ${uid()}`, category: 'OTHER', priority: 3 }));
    refused(await admin('POST', `/projects/${other.id}/expenses`, { expenseId: expense.id }), 400);
    ok(await admin('POST', `/projects/${other.id}/archive`, { reason: 'Projet de test' }));
  });

  test('états : en cours → terminé ; réouverture sans motif refusée', async () => {
    project = ok(await admin('POST', `/projects/${project.id}/status`, { status: 'IN_PROGRESS', version: project.version }));
    project = ok(await admin('POST', `/projects/${project.id}/status`, { status: 'DONE', version: project.version }));
    assert.equal(project.status, 'DONE');
    refused(await admin('POST', `/projects/${project.id}/status`, { status: 'IN_PROGRESS', version: project.version }), 400);
    refused(await admin('POST', `/projects/${project.id}/quotes`, quoteForm({ supplier: 'Trop tard', amount: 10 })), 400);
    project = ok(await admin('POST', `/projects/${project.id}/status`, { status: 'IN_PROGRESS', reason: 'Reprise des finitions', version: project.version }));
  });

  test('abandon sans motif refusé, avec motif accepté ; retour à l’idée libère le devis', async () => {
    refused(await admin('POST', `/projects/${project.id}/status`, { status: 'CANCELLED', version: project.version }), 400);
    project = ok(await admin('POST', `/projects/${project.id}/status`, { status: 'CANCELLED', reason: 'Budget insuffisant', version: project.version }));
    project = ok(await admin('POST', `/projects/${project.id}/status`, { status: 'IDEA', reason: 'Nouvelle étude', version: project.version }));
    assert.equal(project.chosenQuote, null);
    assert.equal(project.status, 'IDEA');
  });

  test('la décision et les changements d’état sont dans l’audit', async () => {
    const rows = ok(await admin('GET', '/audit')).filter((a) => a.entityId === project.id);
    const decision = rows.find((a) => a.action === 'Projet validé (devis choisi)');
    assert.ok(decision, 'décision du bureau tracée');
    assert.equal(decision.reason, 'Moins cher, délai acceptable');
    assert.match(decision.after, /Entreprise Exemple B/);
    assert.ok(rows.some((a) => a.action === 'Projet : changement d’état' && a.reason === 'Budget insuffisant'));
  });

  test('archivage R8 : motif obligatoire, projet archivé non modifiable puis restauré', async () => {
    refused(await admin('POST', `/projects/${project.id}/archive`, { reason: '' }), 400);
    ok(await admin('POST', `/projects/${project.id}/archive`, { reason: 'Test terminé' }));
    const archived = ok(await admin('GET', '/projects?state=archived'));
    assert.ok(archived.projects.some((p) => p.id === project.id));
    const d = ok(await admin('GET', `/projects/${project.id}`));
    refused(await admin('PATCH', `/projects/${project.id}`, { title, category: 'COURT', priority: 1, version: d.version }), 400, /R8/);
    ok(await admin('POST', `/projects/${project.id}/restore`));
    ok(await admin('POST', `/projects/${project.id}/archive`, { reason: 'Nettoyage du test' }));
    ok(await agent('POST', `/expenses/${expense.id}/archive`, { reason: 'Nettoyage du test' }));
  });

  test('lecture seule pour le superviseur (stats.view), refus pour le parent', async () => {
    ok(await superviseur('GET', '/projects'));
    refused(await superviseur('POST', '/projects', { title: 'Interdit', category: 'OTHER', priority: 2 }), 403);
    refused(await parent('GET', '/projects'), 403);
  });
});

describe('Budget de la saison et trésorerie', () => {
  let admin, superviseur, parent, seasons, draft, closed, savedLines, savedBalance;

  before(async () => {
    admin = await as('admin');
    superviseur = await as('superviseur');
    parent = await as('parent');
    seasons = ok(await admin('GET', '/seasons'));
    draft = seasons.find((s) => s.status === 'DRAFT') ?? seasons.find((s) => s.status === 'ACTIVE');
    closed = seasons.find((s) => s.status === 'CLOSED' || s.status === 'HISTORICAL');
    const b = ok(await admin('GET', `/budget/${draft.id}`));
    savedLines = [...b.income.map((r) => ({ ...r, kind: 'INCOME' })), ...b.expenses.map((r) => ({ ...r, kind: 'EXPENSE' }))]
      .filter((r) => r.planned !== null)
      .map((r) => ({ kind: r.kind, category: r.category, amount: r.planned, ...(r.note ? { note: r.note } : {}) }));
    savedBalance = ok(await admin('GET', '/budget/treasury/forecast')).balance;
  });

  after(async () => {
    // Remettre le budget prévu et le solde comme avant le test.
    if (draft) await admin('PUT', `/budget/${draft.id}`, { lines: savedLines });
    if (savedBalance) await admin('PUT', '/budget/treasury/balance', { amount: savedBalance.amount, date: savedBalance.date, ...(savedBalance.note ? { note: savedBalance.note } : {}) });
  });

  test('budget prévu enregistré, totaux recalculés', async () => {
    const b = ok(
      await admin('PUT', `/budget/${draft.id}`, {
        lines: [
          { kind: 'INCOME', category: 'FEES', amount: 40000, note: 'Test e2e' },
          { kind: 'INCOME', category: 'GRANT', amount: 5000 },
          { kind: 'EXPENSE', category: 'SALARY', amount: 30000 },
          { kind: 'EXPENSE', category: 'UTILITIES', amount: 4000 },
        ],
      }),
    );
    assert.equal(b.locked, false);
    assert.equal(b.income.find((r) => r.category === 'FEES').planned, 40000);
    assert.equal(b.totals.plannedIncome, 45000);
    assert.ok(b.totals.plannedExpenses >= 34000, 'dépenses prévues + projets validés de la saison');
    assert.equal(typeof b.totals.actualIncome, 'number');
  });

  test('un poste inconnu est refusé', async () => {
    refused(await admin('PUT', `/budget/${draft.id}`, { lines: [{ kind: 'INCOME', category: 'LOTO', amount: 1 }] }), 400);
  });

  test('R1 : le budget d’une saison clôturée ou historique ne se modifie pas', async () => {
    const b = ok(await admin('GET', `/budget/${closed.id}`));
    assert.equal(b.locked, true);
    refused(await admin('PUT', `/budget/${closed.id}`, { lines: [] }), 400, /R1/);
  });

  test('le budget de la saison active donne le réel et la saison précédente', async () => {
    const active = seasons.find((s) => s.status === 'ACTIVE');
    const b = ok(await superviseur('GET', `/budget/${active.id}`));
    assert.ok(b.previous, 'la saison précédente est proposée');
    assert.ok(b.income.every((r) => typeof r.actual === 'number'));
  });

  test('trésorerie : solde dans le futur refusé', async () => {
    refused(await admin('PUT', '/budget/treasury/balance', { amount: 1000, date: '2999-01-01' }), 400);
  });

  test('trésorerie : solde saisi puis prévision sur 12 mois', async () => {
    ok(await admin('PUT', '/budget/treasury/balance', { amount: 12500, date: today, note: 'Test e2e' }));
    const f = ok(await admin('GET', '/budget/treasury/forecast'));
    assert.equal(f.balance.amount, 12500);
    assert.equal(f.months.length, 12);
    assert.equal(f.late, 'half');
    const run = f.months.reduce((t, m) => Math.round((t + m.in - m.out) * 1000) / 1000, f.estimated);
    assert.equal(f.months[11].balance, run, 'le solde de fin est la somme des mouvements');
    const all = ok(await admin('GET', '/budget/treasury/forecast?late=include'));
    const none = ok(await admin('GET', '/budget/treasury/forecast?late=exclude'));
    assert.ok(all.months[0].in >= none.months[0].in, 'les retards comptés en entier augmentent le premier mois');
    refused(await admin('GET', '/budget/treasury/forecast?late=tout'), 400);
  });

  test('superviseur : lecture seule ; parent : refus', async () => {
    ok(await superviseur('GET', '/budget/treasury/forecast'));
    refused(await superviseur('PUT', '/budget/treasury/balance', { amount: 1, date: today }), 403);
    refused(await parent('GET', `/budget/${draft.id}`), 403);
  });
});
