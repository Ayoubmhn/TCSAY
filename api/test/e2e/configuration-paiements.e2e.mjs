// Test de bout en bout : configuration des paiements, encaissement (modes, n° de reçu obligatoire, plusieurs tranches)
// et modèles d'échéancier du club. La configuration d'origine est remise à la fin.
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';
import { freeReceiptNumber, installmentsOf, newPlayer } from './helpers-paiements.mjs';

const sum = (rows, key) => Math.round(rows.reduce((t, r) => t + r[key], 0) * 1000) / 1000;

describe('Configuration des paiements et encaissement', () => {
  let admin, agent, coach, original;
  const save = (patch) => admin('PUT', '/payments/config', { config: { ...original, ...patch } });

  before(async () => {
    admin = await as('admin');
    agent = await as('agent');
    coach = await as('coach');
    original = ok(await admin('GET', '/payments/config'));
  });

  after(async () => {
    ok(await admin('PUT', '/payments/config', { config: original }), 'configuration d’origine remise');
  });

  test('lecture de la configuration (modes, acompte, encaissement)', async () => {
    assert.ok(original.plans && original.collect && original.reminders);
    assert.ok(original.collect.methods.includes('CASH'));
  });

  test('seul le président modifie la configuration (403 pour l’agent et l’entraîneur)', async () => {
    refused(await agent('PUT', '/payments/config', { config: original }), 403);
    refused(await coach('GET', '/payments/config'), 403);
  });

  test('aperçu des échéanciers : chaque mode fait le montant exact', async () => {
    const r = ok(await admin('POST', '/payments/config/preview', { amount: 1000, deposit: 0 }));
    assert.ok(r.length >= 1);
    for (const p of r) assert.equal(sum(p.schedule, 'amount'), 1000, `mode ${p.plan}`);
  });

  test('aperçu d’une configuration en cours de saisie (trimestre activé) sans l’enregistrer', async () => {
    const r = ok(await admin('POST', '/payments/config/preview', { amount: 900, config: { ...original, plans: { ...original.plans, QUARTER: true } } }));
    const q = r.find((p) => p.plan === 'QUARTER');
    assert.ok(q, 'le trimestre apparaît dans l’aperçu');
    assert.equal(sum(q.schedule, 'amount'), 900);
    assert.equal(ok(await admin('GET', '/payments/config')).plans.QUARTER, original.plans.QUARTER, 'rien n’est enregistré');
  });

  test('refaire les échéanciers non payés : motif obligatoire', async () => {
    refused(await admin('POST', '/payments/config/reschedule', {}), 400);
    refused(await admin('POST', '/payments/config/reschedule', { reason: '' }), 400);
    refused(await agent('POST', '/payments/config/reschedule', { reason: 'Test E2E' }), 403);
  });

  test('trimestre activé : un joueur passe en 3 tranches', async () => {
    ok(await save({ plans: { ...original.plans, QUARTER: true } }));
    const { player } = await newPlayer(admin, { plan: 'QUARTER' });
    const rows = await installmentsOf(admin, player.id);
    assert.equal(rows.length, 3);
    assert.equal(sum(rows, 'amount'), 1000);
  });

  test('mode désactivé : refusé à l’inscription', async () => {
    ok(await save({ plans: { ...original.plans, QUARTER: false } }));
    const { player } = await newPlayer(admin, { plan: 'FULL' });
    refused(await admin('PUT', '/memberships/plan', { playerId: player.id, paymentPlan: 'QUARTER' }), 400);
  });

  test('virement non accepté par le club : refusé ; accepté une fois activé', async () => {
    ok(await save({ collect: { ...original.collect, methods: ['CASH', 'CHEQUE'] } }));
    const { player } = await newPlayer(admin, { plan: 'FULL' });
    const [t] = await installmentsOf(admin, player.id);
    refused(await admin('POST', `/installments/${t.id}/payments`, { amount: 10, method: 'TRANSFER' }), 400);
    ok(await save({ collect: { ...original.collect, methods: ['CASH', 'CHEQUE', 'TRANSFER'] } }));
    ok(await admin('POST', `/installments/${t.id}/payments`, { amount: 10, method: 'TRANSFER', note: 'Test E2E' }));
    ok(await admin('POST', `/installments/${t.id}/payments`, { amount: 10, method: 'CHEQUE', chequeNumber: '123456', note: 'Test E2E' }));
    const [after2] = await installmentsOf(admin, player.id);
    assert.equal(after2.paid, 20);
    assert.deepEqual(after2.payments.map((p) => p.method).sort(), ['CHEQUE', 'TRANSFER']);
    assert.equal(after2.payments.find((p) => p.method === 'CHEQUE').chequeNumber, '123456');
  });

  test('mode inconnu ou montant nul : refusés', async () => {
    const { player } = await newPlayer(admin, { plan: 'FULL' });
    const [t] = await installmentsOf(admin, player.id);
    refused(await admin('POST', `/installments/${t.id}/payments`, { amount: 10, method: 'BITCOIN' }), 400);
    refused(await admin('POST', `/installments/${t.id}/payments`, { amount: 0, method: 'CASH' }), 400);
    refused(await admin('POST', `/installments/${t.id}/payments`, { amount: -5, method: 'CASH' }), 400);
  });

  test('n° de reçu obligatoire : refus sans numéro, reçu émis avec', async () => {
    ok(await save({ collect: { ...original.collect, receiptRequired: true } }));
    const { player } = await newPlayer(admin, { plan: 'FULL' });
    const [t] = await installmentsOf(admin, player.id);
    refused(await admin('POST', `/installments/${t.id}/payments`, { amount: 50, method: 'CASH' }), 400);
    assert.equal((await installmentsOf(admin, player.id))[0].paid, 0, 'rien n’est encaissé après le refus');
    const number = freeReceiptNumber();
    const r = ok(await admin('POST', `/installments/${t.id}/payments`, { amount: 50, method: 'CASH', receiptNumber: number }));
    assert.ok(r.receiptId, 'le reçu est émis avec le paiement');
    const receipt = ok(await admin('GET', `/receipts/${r.receiptId}`));
    assert.equal(receipt.number, number);
    assert.equal(receipt.amount, 50);
  });

  test('n° de reçu déjà utilisé : l’encaissement est refusé (R7) et rien n’est encaissé', async () => {
    ok(await save({ collect: { ...original.collect, receiptRequired: false } }));
    const { player } = await newPlayer(admin, { plan: 'FULL' });
    const [t] = await installmentsOf(admin, player.id);
    const number = freeReceiptNumber();
    ok(await admin('POST', `/installments/${t.id}/payments`, { amount: 20, method: 'CASH', receiptNumber: number }));
    refused(await admin('POST', `/installments/${t.id}/payments`, { amount: 20, method: 'CASH', receiptNumber: number }), 409, /R7/);
    assert.equal((await installmentsOf(admin, player.id))[0].paid, 20);
  });

  test('plusieurs tranches en une fois : le surplus passe à la tranche suivante (un seul lot)', async () => {
    ok(await save({ collect: { ...original.collect, multi: true } }));
    const { player } = await newPlayer(admin, { plan: 'SEMESTER' });
    const [t1] = await installmentsOf(admin, player.id);
    refused(await admin('POST', `/installments/${t1.id}/payments`, { amount: t1.remaining + 100, method: 'CASH' }), 400, /restant/);
    const r = ok(await admin('POST', `/installments/${t1.id}/payments`, { amount: t1.remaining + 100, method: 'CASH', spread: true, note: 'Test E2E' }));
    assert.equal(r.paymentIds.length, 2);
    const [a, b] = await installmentsOf(admin, player.id);
    assert.equal(a.remaining, 0);
    assert.equal(a.status, 'PAID');
    assert.equal(b.paid, 100);
    refused(await admin('POST', `/installments/${t1.id}/payments`, { amount: 10_000, method: 'CASH', spread: true }), 400, /restant/);
  });

  test('plusieurs tranches désactivé : refusé', async () => {
    ok(await save({ collect: { ...original.collect, multi: false } }));
    const { player } = await newPlayer(admin, { plan: 'SEMESTER' });
    const [t1] = await installmentsOf(admin, player.id);
    refused(await admin('POST', `/installments/${t1.id}/payments`, { amount: t1.remaining + 10, method: 'CASH', spread: true }), 400);
  });

  test('l’agent administratif encaisse ; l’entraîneur jamais (403)', async () => {
    ok(await save({}));
    const { player } = await newPlayer(admin, { plan: 'FULL' });
    const [t] = await installmentsOf(admin, player.id);
    ok(await agent('POST', `/installments/${t.id}/payments`, { amount: 5, method: 'CASH', note: 'Test E2E' }));
    refused(await coach('POST', `/installments/${t.id}/payments`, { amount: 5, method: 'CASH' }), 403);
  });
});

describe('Modèles d’échéancier du club', () => {
  let admin, agent, template, original;
  const fixed = (name) => ({
    name,
    kind: 'FIXED',
    lines: [
      { date: 'ENROLL', mode: 'PERCENT', value: 40 },
      { date: '03-01', mode: 'REST', value: 0 },
    ],
    monthlyDay: 5,
    months: [],
    deposit: false,
    scope: 'ALL',
    visible: true,
    lateMode: 'MERGE',
  });

  before(async () => {
    admin = await as('admin');
    agent = await as('agent');
    original = ok(await admin('GET', '/payments/config'));
    if (!original.plans.CUSTOM) ok(await admin('PUT', '/payments/config', { config: { ...original, plans: { ...original.plans, CUSTOM: true } } }));
  });

  after(async () => {
    ok(await admin('PUT', '/payments/config', { config: original }));
  });

  test('aperçu d’un modèle : 40 % à l’inscription, le reste au 1er mars', async () => {
    const r = ok(await admin('POST', '/payments/templates/preview', { template: fixed('Aperçu'), amount: 1000 }));
    assert.equal(r.error, null);
    assert.equal(r.schedule.length, 2);
    assert.equal(r.schedule[0].amount, 400);
    assert.equal(sum(r.schedule, 'amount'), 1000);
  });

  test('un modèle incohérent est refusé (plus de 100 %)', async () => {
    const bad = { ...fixed(`Faux ${uid()}`), lines: [{ date: 'ENROLL', mode: 'PERCENT', value: 80 }, { date: '03-01', mode: 'PERCENT', value: 50 }] };
    refused(await admin('POST', '/payments/templates', bad), 400);
  });

  test('création réservée au président (403 pour l’agent)', async () => {
    refused(await agent('POST', '/payments/templates', fixed(`Agent ${uid()}`)), 403);
  });

  test('création du modèle', async () => {
    template = ok(await admin('POST', '/payments/templates', fixed(`Modèle E2E ${uid()}`)));
    assert.equal(template.kind, 'FIXED');
    const list = ok(await admin('GET', '/payments/templates'));
    assert.ok(list.some((t) => t.id === template.id));
  });

  test('un joueur passe sur le modèle du club (CUSTOM)', async () => {
    const { player } = await newPlayer(admin, { plan: 'FULL' });
    refused(await admin('PUT', '/memberships/plan', { playerId: player.id, paymentPlan: 'CUSTOM' }), 400); // modèle non choisi
    ok(await admin('PUT', '/memberships/plan', { playerId: player.id, paymentPlan: 'CUSTOM', templateId: template.id }));
    const rows = await installmentsOf(admin, player.id);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].amount, 400);
    assert.equal(sum(rows, 'amount'), 1000);
    const info = ok(await admin('GET', `/memberships/player/${player.id}`));
    assert.equal(info.membership.templateId, template.id);
  });

  test('R13 : modification avec une version périmée refusée', async () => {
    refused(await admin('PATCH', `/payments/templates/${template.id}`, { ...fixed(template.name), version: template.version + 3 }), 409, /R13/);
    const u = ok(await admin('PATCH', `/payments/templates/${template.id}`, { ...fixed(template.name), months: [], version: template.version }));
    assert.equal(u.version, template.version + 1);
  });

  test('R8 : archivé, le modèle n’est plus proposé (il reste dans la liste)', async () => {
    const r = ok(await admin('POST', `/payments/templates/${template.id}/archive`));
    assert.equal(r.archived, true);
    const { player } = await newPlayer(admin, { plan: 'FULL' });
    refused(await admin('PUT', '/memberships/plan', { playerId: player.id, paymentPlan: 'CUSTOM', templateId: template.id }), 400);
    const list = ok(await admin('GET', '/payments/templates'));
    assert.ok(list.find((t) => t.id === template.id).archivedAt, 'toujours listé, archivé');
  });
});
