// Test de bout en bout : fiche joueur (création, R3 dérogation, R9 parent et droits, R8 archivage, R13 version, code TCSAY).
// Base de DÉMONSTRATION uniquement (voir paiement.e2e.mjs).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { as, ok, refused, uid } from './helpers.mjs';

const fakeCin = () => ('T' + uid()).slice(0, 12); // CIN fictive unique
const fakeEmail = (prefix = 'e2e') => `${prefix}.${uid()}@exemple.tn`;

/** Parent créé dans le formulaire joueur (données fictives uniques). */
const newParent = () => ({ firstName: 'Parent', lastName: `E2E${uid()}`, phone: '20000000', email: fakeEmail('parent'), cin: fakeCin() });

describe('Joueurs : création et règles', () => {
  let admin, agent, superviseur, coach, parent, year, cats, enfant, adulte;

  before(async () => {
    admin = await as('admin');
    agent = await as('agent');
    superviseur = await as('superviseur');
    coach = await as('coach');
    parent = await as('parent');
    year = new Date(ok(await admin('GET', '/seasons/active')).startDate).getUTCFullYear();
    cats = ok(await admin('GET', '/categories'));
  });
  const cat = (code) => cats.find((c) => c.code === code);

  test('mineur sans parent : refusé (R9)', async () => {
    refused(await admin('POST', '/players', { firstName: 'Sans', lastName: `Parent${uid()}`, birthDate: `${year - 9}-03-01`, gender: 'M' }), 400, /R9/);
  });

  test('genre obligatoire', async () => {
    refused(await admin('POST', '/players', { firstName: 'Sans', lastName: 'Genre', birthDate: `${year - 9}-03-01`, newParent: newParent() }), 400);
  });

  test('âge minimum (4 ans) : refusé', async () => {
    refused(await admin('POST', '/players', { firstName: 'Bebe', lastName: `E2E${uid()}`, birthDate: `${year - 2}-03-01`, gender: 'F', newParent: newParent() }), 400);
  });

  test('majeur : email, téléphone et CIN obligatoires', async () => {
    const base = { firstName: 'Adulte', lastName: `E2E${uid()}`, birthDate: `${year - 30}-03-01`, gender: 'M' };
    refused(await admin('POST', '/players', base), 400);
    refused(await admin('POST', '/players', { ...base, email: fakeEmail() }), 400);
    refused(await admin('POST', '/players', { ...base, email: fakeEmail(), phone: '20000001' }), 400);
  });

  test('R3 : catégorie hors norme sans motif refusée', async () => {
    const r = await admin('POST', '/players', {
      firstName: 'Hors', lastName: `Norme${uid()}`, birthDate: `${year - 9}-03-01`, gender: 'M', newParent: newParent(), categoryId: cat('J16M').id,
    });
    refused(r, 400, /R3/);
  });

  test('mineur avec parent créé dans le formulaire : catégorie proposée, code TCSAY, cotisation', async () => {
    enfant = ok(await admin('POST', '/players', { firstName: 'Enfant', lastName: `E2E${uid()}`, birthDate: `${year - 9}-03-01`, gender: 'M', newParent: newParent() }), 'création');
    assert.equal(enfant.category.code, 'J10M');
    assert.equal(enfant.minor, true);
    assert.equal(enfant.origin, 'MANUAL');
    assert.match(enfant.memberCode, new RegExp(`^${year % 100}TCSAY\\d{3}$`));
    assert.equal(enfant.parents.length, 1);
    assert.equal(enfant.hasAccount, false, 'un mineur sans email n’a pas de compte');
    assert.ok(enfant.membership, 'cotisation créée à l’inscription');
  });

  test('R3 : dérogation avec motif acceptée et conservée', async () => {
    const p = ok(await admin('POST', '/players', {
      firstName: 'Surclasse', lastName: `E2E${uid()}`, birthDate: `${year - 9}-03-01`, gender: 'F', newParent: newParent(),
      categoryId: cat('J12F').id, derogationReason: 'Surclassement E2E',
    }));
    assert.equal(p.category.code, 'J12F');
    assert.equal(p.derogationReason, 'Surclassement E2E');
  });

  test('Loisirs : ouvert à tous les âges sans dérogation', async () => {
    const p = ok(await admin('POST', '/players', {
      firstName: 'Loisir', lastName: `E2E${uid()}`, birthDate: `${year - 11}-03-01`, gender: 'F', newParent: newParent(), categoryId: cat('LSR').id,
    }));
    assert.equal(p.category.code, 'LSR');
  });

  test('majeur complet : compte joueur créé (identifiants envoyés)', async () => {
    const email = fakeEmail('joueur');
    adulte = ok(await admin('POST', '/players', {
      firstName: 'Majeur', lastName: `E2E${uid()}`, birthDate: `${year - 25}-06-01`, gender: 'F', email, phone: '20000002', cin: fakeCin(),
    }));
    assert.equal(adulte.minor, false);
    assert.equal(adulte.hasAccount, true);
    assert.equal(adulte.category.code, 'A1F');
    assert.equal(adulte.email, email);
  });

  test('email ou CIN déjà utilisés : refusés', async () => {
    const r = await admin('POST', '/players', {
      firstName: 'Double', lastName: `E2E${uid()}`, birthDate: `${year - 25}-06-01`, gender: 'F', email: adulte.email, phone: '20000003', cin: fakeCin(),
    });
    assert.ok(r.status === 409 || r.status === 400, `doublon accepté (statut ${r.status})`);
  });

  test('la liste et la recherche retrouvent le joueur', async () => {
    const list = ok(await admin('GET', `/players?q=${encodeURIComponent(enfant.lastName)}`));
    assert.equal(list.length, 1);
    assert.equal(list[0].id, enfant.id);
    const byCode = ok(await admin('GET', `/players?q=${enfant.memberCode}`));
    assert.ok(byCode.some((p) => p.id === enfant.id));
    const byPair = ok(await admin('GET', '/players?pairCode=J10'));
    assert.ok(byPair.some((p) => p.id === enfant.id));
  });

  test('fiche profil : parents, cotisation', async () => {
    const prof = ok(await admin('GET', `/players/${enfant.id}/profile`));
    assert.ok(JSON.stringify(prof).includes(enfant.parents[0].id), 'le parent figure sur la fiche');
  });

  test('R13 : modification avec une version périmée refusée', async () => {
    refused(await admin('PATCH', `/players/${enfant.id}`, { version: enfant.version + 5, firstName: 'Autre' }), 409, /R13/);
  });

  test('modification du nom par l’admin (version à jour)', async () => {
    const p = ok(await admin('PATCH', `/players/${enfant.id}`, { version: enfant.version, firstName: 'Enfanto' }));
    assert.equal(p.firstName, 'Enfanto');
    assert.equal(p.version, enfant.version + 1);
    enfant = p;
  });

  test('email d’un autre compte (le parent) refusé pour le joueur', async () => {
    refused(await admin('PATCH', `/players/${enfant.id}`, { version: enfant.version, email: enfant.parents[0].email }), 409);
  });

  test('R3 : changement de catégorie hors norme sans motif refusé, avec motif accepté', async () => {
    refused(await admin('POST', `/players/${enfant.id}/category`, { categoryId: cat('J14M').id }), 400, /R3/);
    const p = ok(await admin('POST', `/players/${enfant.id}/category`, { categoryId: cat('J14M').id, derogationReason: 'Niveau E2E' }));
    assert.equal(p.category.code, 'J14M');
    const back = ok(await admin('POST', `/players/${enfant.id}/category`, { categoryId: cat('J10M').id }));
    assert.equal(back.category.code, 'J10M');
    enfant = back;
  });

  test('R8 : un joueur archivé ne se modifie plus, puis restauré', async () => {
    const arch = ok(await admin('POST', `/players/${enfant.id}/archive`));
    assert.ok(arch.archivedAt);
    refused(await admin('PATCH', `/players/${enfant.id}`, { version: arch.version, firstName: 'Archive' }), 409, /R8/);
    const archived = ok(await admin('GET', '/players?archived=true'));
    assert.ok(archived.some((p) => p.id === enfant.id));
    const back = ok(await admin('POST', `/players/${enfant.id}/restore`));
    assert.equal(back.archivedAt, null);
    enfant = back;
  });

  test('droits : l’agent crée, le superviseur et le parent non, le coach lit la liste', async () => {
    const p = await agent('POST', '/players', { firstName: 'Agent', lastName: `E2E${uid()}`, birthDate: `${year - 10}-01-01`, gender: 'F', newParent: newParent() });
    ok(p, 'création par l’agent');
    refused(await superviseur('POST', '/players', { firstName: 'X', lastName: 'Y', birthDate: `${year - 10}-01-01`, gender: 'F', newParent: newParent() }), 403);
    refused(await parent('GET', '/players'), 403);
    assert.equal((await coach('GET', '/players')).status, 200);
    refused(await coach('PATCH', `/players/${enfant.id}`, { version: enfant.version, firstName: 'Coach' }), 403);
  });

  test('code TCSAY : aperçu du recalcul réservé au président', async () => {
    assert.equal((await admin('GET', '/players/member-codes/plan')).status, 200);
    refused(await agent('GET', '/players/member-codes/plan'), 403);
  });
});

describe('Joueurs : R9, ce que le parent peut modifier', () => {
  let admin, parent, lina, autre;

  before(async () => {
    admin = await as('admin');
    parent = await as('parent');
    lina = ok(await admin('GET', '/players?q=Lina')).find((p) => p.lastName === 'Ben Ali');
    assert.ok(lina, 'Lina Ben Ali attendue dans la démo');
    autre = ok(await admin('GET', '/players')).find((p) => !p.parents?.some((x) => x.email === 'sana.benali@exemple.tn') && p.id !== lina.id);
  });

  test('le parent change le téléphone de son enfant (puis on le remet)', async () => {
    const before = ok(await admin('GET', `/players/${lina.id}`));
    const r = ok(await parent('PATCH', `/players/${lina.id}/contact`, { phone: '+216 20 999 999' }));
    assert.equal(r.phone, '+216 20 999 999');
    ok(await parent('PATCH', `/players/${lina.id}/contact`, { phone: before.phone ?? '' }));
    assert.equal(ok(await admin('GET', `/players/${lina.id}`)).phone, before.phone);
  });

  test('le parent ne modifie pas le contact d’un joueur qui n’est pas le sien', async () => {
    assert.ok(autre, 'un autre joueur est attendu');
    refused(await parent('PATCH', `/players/${autre.id}/contact`, { phone: '20000009' }), 403);
  });

  test('le parent ne modifie jamais nom, naissance ou genre (route admin)', async () => {
    refused(await parent('PATCH', `/players/${lina.id}`, { version: 1, firstName: 'Lina2' }), 403);
    refused(await parent('POST', `/players/${lina.id}/category`, { categoryId: lina.category?.id ?? lina.id }), 403);
  });
});
