// Test de bout en bout : salaires des entraîneurs (R6, R13), vus par l'entraîneur ; jamais les cotisations.
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
// Chaque passage saisit le salaire d'un mois lointain tiré au hasard (un seul salaire par employé et par mois).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused } from './helpers.mjs';

const month = `${2100 + Math.floor(Math.random() * 800)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}`;

describe('Salaires (R6, R13)', () => {
  let admin, agent, superviseur, coach, parent, iheb, salary;

  before(async () => {
    [admin, agent, superviseur, coach, parent] = await Promise.all([as('admin'), as('agent'), as('superviseur'), as('coach'), as('parent')]);
    iheb = ok(await coach('GET', '/auth/me'));
  });

  test('l’entraîneur figure parmi les salariés « entraîneur »', async () => {
    const r = ok(await admin('GET', '/salaries/employees?type=COACH'));
    const e = r.find((x) => x.id === iheb.id);
    assert.ok(e);
    assert.equal(e.type, 'COACH');
  });

  test('proposition de salaire calculée pour le mois en cours', async () => {
    const now = new Date(Date.now() + 3_600_000).toISOString().slice(0, 7);
    const r = ok(await admin('GET', `/salaries/estimate?employeeId=${iheb.id}&month=${now}`));
    assert.equal(r.payMode, 'HOURLY');
    assert.equal(r.amount, Math.round(r.hours * r.payRate * 1000) / 1000);
    refused(await admin('GET', `/salaries/estimate?employeeId=${iheb.id}&month=2026-13`), 400);
  });

  test('l’agent administratif (salaires) saisit le salaire du mois', async () => {
    salary = ok(await agent('POST', '/salaries', { employeeId: iheb.id, month, amount: 640, hours: 32, note: 'Test E2E' }));
    assert.equal(salary.amount, 640);
    assert.equal(salary.paid, false);
    assert.equal(salary.season.status, 'ACTIVE');
  });

  test('un 2e salaire pour le même mois est refusé', async () => {
    refused(await admin('POST', '/salaries', { employeeId: iheb.id, month, amount: 1 }), 400);
  });

  test('un montant négatif ou un parent comme employé est refusé', async () => {
    refused(await admin('POST', '/salaries', { employeeId: iheb.id, month: '2099-01', amount: -5 }), 400);
    const parentId = ok(await parent('GET', '/auth/me')).id;
    refused(await admin('POST', '/salaries', { employeeId: parentId, month, amount: 10 }), 404);
  });

  test('sans l’autorisation « salaires », le superviseur ne voit rien', async () => {
    refused(await superviseur('GET', '/salaries'), 403);
    refused(await superviseur('POST', '/salaries', { employeeId: iheb.id, month: '2099-02', amount: 1 }), 403);
  });

  test('R13 : une version périmée est refusée', async () => {
    refused(await admin('PATCH', `/salaries/${salary.id}`, { version: salary.version + 3, amount: 700 }), 409, /R13/);
  });

  test('R6 : saison en cours, montant modifiable sans motif (ancienne valeur tracée)', async () => {
    salary = ok(await admin('PATCH', `/salaries/${salary.id}`, { version: salary.version, amount: 660 }));
    assert.equal(salary.amount, 660);
    const audit = ok(await admin('GET', '/audit')).find((a) => a.action === 'Salaire modifié' && a.entityId === salary.id);
    assert.ok(audit, 'modification tracée');
    assert.match(audit.before, /640/);
    assert.match(audit.after, /660/);
  });

  test('l’entraîneur voit son salaire « à verser »', async () => {
    const r = ok(await coach('GET', '/salaries/mine'));
    assert.ok(r.pending.some((s) => s.id === salary.id));
    assert.ok(!r.paid.some((s) => s.id === salary.id));
  });

  test('salaire marqué versé : l’entraîneur le voit dans ses salaires versés', async () => {
    const r = ok(await admin('POST', `/salaries/${salary.id}/pay`));
    assert.equal(r.paid, true);
    const mine = ok(await coach('GET', '/salaries/mine'));
    const s = mine.paid.find((x) => x.id === salary.id);
    assert.ok(s);
    assert.equal(s.amount, 660);
  });

  test('R6 : un salaire versé ne se modifie plus et ne se verse pas deux fois', async () => {
    refused(await admin('PATCH', `/salaries/${salary.id}`, { version: salary.version + 1, amount: 1 } /* version après versement */), 409, /R6/);
    refused(await admin('POST', `/salaries/${salary.id}/pay`), 409, /R6/);
  });

  test('l’entraîneur ne voit ni les salaires des autres ni les cotisations', async () => {
    refused(await coach('GET', '/salaries'), 403);
    refused(await coach('GET', `/salaries/estimate?employeeId=${iheb.id}&month=${month}`), 403);
    const mine = ok(await coach('GET', '/salaries/mine'));
    assert.ok([...mine.paid, ...mine.pending].every((s) => s.employee.id === iheb.id));
    refused(await coach('GET', '/installments'), 403);
    refused(await coach('GET', '/payments'), 403);
    refused(await coach('GET', '/memberships/missing'), 403);
  });

  test('un parent n’a pas accès aux salaires', async () => {
    refused(await parent('GET', '/salaries/mine'), 403);
  });
});
