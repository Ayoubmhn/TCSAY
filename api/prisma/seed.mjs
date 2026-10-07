// ⚠ Données de DÉMONSTRATION (prototype v4). Ce seed VIDE la base puis la recharge.
// Montants = valeurs de démonstration, jamais des tarifs réels du club.
// Mots de passe démo : admin@tcsay.tn / admin1234 ; tous les autres comptes / temporaire (changement obligatoire).
import { randomBytes, scryptSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Même format que src/auth/password.ts : scrypt$sel$empreinte */
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

const day = (d) => new Date(`${d}T00:00:00.000Z`);
/** Date + heure locales (Africa/Tunis), décalées de n jours à partir d'aujourd'hui. */
function inDays(n, hour) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function wipe() {
  // Ordre inverse des dépendances.
  await prisma.extractedRecord.deleteMany();
  await prisma.scannedPage.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.installment.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.feeSchedule.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.trainingGroup.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.coachFee.deleteMany();
  await prisma.parentLink.deleteMany();
  await prisma.player.deleteMany();
  await prisma.coach.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.courtRate.deleteMany();
  await prisma.court.deleteMany();
  await prisma.category.deleteMany();
  await prisma.season.deleteMany();
  await prisma.event.deleteMany();
  await prisma.setting.deleteMany();
}

// ───── 29 catégories ─────
function categories() {
  const list = [];
  const youth = [
    ['6', 'Lutins', 'Lutines', 'J6'],
    ['7', 'Lutins', 'Lutines', 'J7'],
    ['8', 'Lutins', 'Lutines', 'J8'],
    ['9', 'Poussins', 'Poussines', 'J9'],
    ['10', 'Poussins', 'Poussines', 'J10'],
    ['11', 'Benjamins', 'Benjamines', 'J11'],
    ['12', 'Benjamins', 'Benjamines', 'J12'],
    ['14', 'Minimes G.', 'Minimes F.', 'J14'],
    ['16', 'Cadets', 'Cadettes', 'J16'],
    ['18', 'Juniors G.', 'Juniors F.', 'J18'],
  ];
  for (const [age, m, f, pair] of youth) {
    list.push({ code: `${pair}M`, name: `${m} (-${age})`, family: 'YOUTH', gender: 'M', pairCode: pair, maxAge: +age });
    list.push({ code: `${pair}F`, name: `${f} (-${age})`, family: 'YOUTH', gender: 'F', pairCode: pair, maxAge: +age });
  }
  list.push(
    { code: 'A1M', name: 'Seniors', family: 'ADULT', gender: 'M', pairCode: 'A1', note: 'Messieurs ? à confirmer' },
    { code: 'A1F', name: 'Dames', family: 'ADULT', gender: 'F', pairCode: 'A1' },
    { code: 'V35M', name: 'Vétérans +35 (M)', family: 'VETERAN', gender: 'M', pairCode: 'V35', minAge: 35 },
    { code: 'V35F', name: 'Vétérans +35 (D)', family: 'VETERAN', gender: 'F', pairCode: 'V35', minAge: 35 },
    { code: 'V45M', name: 'Vétérans +45 (M)', family: 'VETERAN', gender: 'M', pairCode: 'V45', minAge: 45 },
    { code: 'V45F', name: 'Vétérans +45 (D)', family: 'VETERAN', gender: 'F', pairCode: 'V45', minAge: 45 },
    { code: 'E1M', name: 'Entreprise Messieurs', family: 'CORPORATE', gender: 'M', pairCode: 'E1' },
    { code: 'E1F', name: 'Entreprise Dames', family: 'CORPORATE', gender: 'F', pairCode: 'E1' },
    { code: 'P1X', name: 'Padel', family: 'PADEL', gender: 'MIXED', pairCode: 'P1', note: 'Mixte ? à confirmer' },
  );
  return list.map((c, i) => ({ ...c, sortOrder: i + 1 }));
}

async function main() {
  await wipe();

  await prisma.setting.createMany({
    data: [
      { key: 'nightStartHour', value: '18' },
      { key: 'cancelDelayHours', value: '24' },
      { key: 'openingHour', value: '8' },
      { key: 'closingHour', value: '22' },
    ],
  });

  // Catégories
  await prisma.category.createMany({ data: categories() });
  const cat = Object.fromEntries((await prisma.category.findMany()).map((c) => [c.code, c.id]));

  // Saisons
  const S = {};
  for (const s of [
    { label: '2010-2011', startDate: '2010-09-01', endDate: '2011-06-30', status: 'HISTORICAL' },
    { label: '2025-2026', startDate: '2025-09-01', endDate: '2026-06-30', status: 'CLOSED' },
    { label: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30', status: 'ACTIVE' },
    { label: '2027-2028', startDate: '2027-09-01', endDate: '2028-06-30', status: 'DRAFT' },
  ]) {
    S[s.label] = (
      await prisma.season.create({ data: { ...s, startDate: day(s.startDate), endDate: day(s.endDate) } })
    ).id;
  }
  const CUR = S['2026-2027'];
  const PREV = S['2025-2026'];

  // Terrains
  const T = {};
  for (const [i, c] of [
    ['T1', { name: 'Court 1', lit: true, surface: 'Terre battue' }],
    ['T2', { name: 'Court 2', lit: true, surface: 'Terre battue' }],
    ['T3', { name: 'Court 3', lit: false, surface: 'Dur' }],
    ['T4', { name: 'Court 4', lit: true, surface: 'Dur', maintenance: true }],
    ['P1', { name: 'Padel', lit: true, surface: 'Gazon synthétique' }],
  ].entries()) {
    T[c[0]] = (await prisma.court.create({ data: { ...c[1], sortOrder: i + 1 } })).id;
  }

  // Tarifs terrains (DÉMO)
  await prisma.courtRate.createMany({
    data: [
      { type: 'LEISURE', period: 'DAY', pricePerHour: 10 },
      { type: 'LEISURE', period: 'NIGHT', pricePerHour: 15 },
      { type: 'PRIVATE', period: 'DAY', pricePerHour: 20 },
      { type: 'PRIVATE', period: 'NIGHT', pricePerHour: 25 },
    ],
  });

  // Comptes
  const temp = hashPassword('temporaire');
  const user = (email, role, firstName, lastName, phone, extra = {}) =>
    prisma.user.create({ data: { email, role, firstName, lastName, phone, passwordHash: temp, ...extra } });

  const admin = await user('admin@tcsay.tn', 'ADMIN', 'Admin', 'Bureau', null, {
    passwordHash: hashPassword('admin1234'),
    mustChangePassword: false,
  });

  const C = {};
  for (const [id, first, last, phone, email] of [
    ['C1', 'Mehdi', 'Gharbi', '+216 22 000 101', 'mehdi.gharbi@exemple.tn'],
    ['C2', 'Amira', 'Ben Salah', '+216 22 000 102', 'amira.bensalah@exemple.tn'],
  ]) {
    const u = await user(email, 'COACH', first, last, phone);
    C[id] = (await prisma.coach.create({ data: { userId: u.id, payMode: 'Mensuel ? à confirmer' } })).id;
  }

  const U = {};
  for (const [id, first, last, email, phone] of [
    ['U1', 'Sana', 'Ben Ali', 'sana.benali@exemple.tn', '+216 55 000 201'],
    ['U2', 'Hela', 'Kefi', 'hela.kefi@exemple.tn', '+216 55 000 202'],
    ['U3', 'Mourad', 'Hammami', 'mourad.hammami@exemple.tn', '+216 55 000 203'],
    ['U4', 'Fethi', 'Sassi', 'fethi.sassi@exemple.tn', '+216 55 000 204'],
    ['U5', 'Rim', 'Chaabane', 'rim.chaabane@exemple.tn', '+216 55 000 205'],
  ]) {
    U[id] = (await user(email, 'PARENT', first, last, phone)).id;
  }

  // Joueurs
  const J = {};
  const players = [
    ['J1', 'Yassine', 'Ben Ali', 'M', '2015-03-12', 'J12M'],
    ['J2', 'Lina', 'Ben Ali', 'F', '2017-07-02', 'J10F'],
    ['J3', 'Omar', 'Trabelsi', 'M', '1990-05-20', 'A1M', 'omar.trabelsi@exemple.tn', '+216 98 000 303'],
    ['J4', 'Nour', 'Hammami', 'F', '2012-01-18', 'J16F'],
    ['J5', 'Adam', 'Sassi', 'M', '2014-09-04', 'J14M', null, null, 'Niveau adapté au groupe Benjamins A'],
    ['J6', 'Rayen', 'Kefi', 'M', '2019-11-23', 'J8M'],
    ['J7', 'Ahmed', 'Bouzid', 'M', '1985-02-11', 'V35M', 'ahmed.bouzid@exemple.tn', '+216 98 000 307'],
    ['J8', 'Ines', 'Chaabane', 'F', '2011-06-30', 'J16F'],
  ];
  const E = {}; // inscriptions saison en cours
  for (const [id, first, last, gender, birth, code, email, phone] of players) {
    let userId = null;
    if (email) userId = (await user(email, 'PLAYER', first, last, phone)).id;
    const p = await prisma.player.create({
      data: { firstName: first, lastName: last, gender, birthDate: day(birth), email, phone, userId },
    });
    J[id] = p.id;
    E[id] = (await prisma.enrollment.create({ data: { playerId: p.id, seasonId: CUR, categoryId: cat[code] } })).id;
  }
  // Inscriptions de la saison précédente (historique des paiements)
  const E_PREV = {
    J1: (await prisma.enrollment.create({ data: { playerId: J.J1, seasonId: PREV, categoryId: cat.J11M } })).id,
    J3: (await prisma.enrollment.create({ data: { playerId: J.J3, seasonId: PREV, categoryId: cat.A1M } })).id,
  };

  // Liens parents ↔ joueurs
  for (const [u, kids] of [
    ['U1', ['J1', 'J2']],
    ['U2', ['J6']],
    ['U3', ['J4']],
    ['U4', ['J5']],
    ['U5', ['J8']],
  ]) {
    for (const k of kids) await prisma.parentLink.create({ data: { parentId: U[u], playerId: J[k] } });
  }

  // Groupes 2026-2027
  const G = {};
  for (const [id, name, code, coach, court, days, start, end, cap, members] of [
    ['G1', 'Benjamins A', 'J12M', 'C1', 'T1', [1, 3], '17:00', '18:30', 8, ['J1', 'J5']],
    ['G2', 'Poussines B', 'J10F', 'C2', 'T2', [2, 4], '16:00', '17:00', 6, ['J2']],
    ['G3', 'Adultes soir', 'A1M', 'C1', 'T1', [1, 4], '19:00', '20:30', 6, ['J3', 'J7']],
    ['G4', 'Cadettes', 'J16F', 'C2', 'T2', [3, 6], '10:00', '11:30', 2, ['J4', 'J8']],
  ]) {
    const g = await prisma.trainingGroup.create({
      data: {
        seasonId: CUR,
        name,
        categoryId: cat[code],
        coachId: C[coach],
        courtId: T[court],
        days,
        startTime: start,
        endTime: end,
        capacity: cap,
      },
    });
    G[id] = g.id;
    for (const m of members) {
      await prisma.groupMember.create({
        data: {
          groupId: g.id,
          enrollmentId: E[m],
          derogationReason: m === 'J5' ? 'Niveau adapté au groupe Benjamins A' : null,
        },
      });
    }
  }

  // Tarifs d'entraînement (DÉMO)
  const F = {};
  for (const [key, season, code, group, amount, n] of [
    ['G1', CUR, 'J12M', 'G1', 600, 2],
    ['G2', CUR, 'J10F', 'G2', 500, 2],
    ['G3', CUR, 'A1M', 'G3', 700, 2],
    ['G4', CUR, 'J16F', 'G4', 600, 3],
    ['P11', PREV, 'J11M', null, 560, 2],
    ['PA1', PREV, 'A1M', null, 650, 1],
  ]) {
    F[key] = (
      await prisma.feeSchedule.create({
        data: { seasonId: season, categoryId: cat[code], groupId: group ? G[group] : null, amount, installmentsCount: n },
      })
    ).id;
  }

  // Cotisations, tranches et paiements (DÉMO)
  const memberships = [
    // [inscription, tarif, total, tranches [échéance, montant, payé, date paiement]]
    [E.J1, F.G1, 600, [['2026-10-15', 300, 300, '2026-09-18'], ['2027-01-15', 300, 0]]],
    [E.J2, F.G2, 500, [['2026-10-15', 250, 150, '2026-09-20'], ['2027-01-15', 250, 0]]],
    [E.J3, F.G3, 700, [['2026-10-15', 350, 350, '2026-09-12'], ['2027-01-15', 350, 350, '2026-09-12']]],
    [E.J4, F.G4, 600, [['2026-09-30', 200, 0], ['2026-12-31', 200, 0], ['2027-03-31', 200, 0]]],
    [E_PREV.J1, F.P11, 560, [['2025-10-15', 280, 280, '2025-10-10'], ['2026-01-15', 280, 280, '2026-01-12']]],
    [E_PREV.J3, F.PA1, 650, [['2025-10-15', 650, 650, '2025-10-01']]],
  ];
  for (const [enrollmentId, feeScheduleId, total, insts] of memberships) {
    const m = await prisma.membership.create({ data: { enrollmentId, feeScheduleId, totalAmount: total } });
    for (const [i, [due, amount, paid, paidAt]] of insts.entries()) {
      const inst = await prisma.installment.create({
        data: { membershipId: m.id, number: i + 1, count: insts.length, dueDate: day(due), amount },
      });
      if (paid) {
        await prisma.payment.create({
          data: { installmentId: inst.id, amount: paid, paidAt: day(paidAt), recordedById: admin.id },
        });
      }
    }
  }

  // Réservations (relatives à aujourd'hui pour garder la démo utilisable)
  const rates = { LEISURE: [10, 15], PRIVATE: [20, 25] };
  for (const [pid, n, hour, court, type, by, coach] of [
    ['J3', 1, 18, 'T1', 'LEISURE', 'J3'],
    ['J3', 4, 9, 'T2', 'LEISURE', 'J3'],
    ['J1', 5, 10, 'T3', 'LEISURE', 'U1'],
    ['J4', 3, 15, 'T2', 'PRIVATE', 'C1', 'C1'],
  ]) {
    const start = inDays(n, hour);
    const end = inDays(n, hour + 1);
    const bookedBy =
      by === 'U1'
        ? U.U1
        : by === 'C1'
          ? (await prisma.coach.findUnique({ where: { id: C.C1 } })).userId
          : (await prisma.player.findUnique({ where: { id: J[by] } })).userId;
    await prisma.reservation.create({
      data: {
        courtId: T[court],
        playerId: J[pid],
        coachId: coach ? C[coach] : null,
        type,
        startTime: start,
        endTime: end,
        price: rates[type][hour >= 18 ? 1 : 0],
        bookedById: bookedBy,
        activeKey: `${T[court]}|${start.toISOString()}`,
      },
    });
  }

  // Salaires (DÉMO)
  for (const [coach, season, period, amount, paidAt] of [
    ['C1', CUR, 'Octobre 2026', 900, null],
    ['C1', CUR, 'Septembre 2026', 900, '2026-10-02'],
    ['C1', PREV, 'Août 2026', 600, '2026-09-03'],
    ['C2', CUR, 'Octobre 2026', 750, null],
    ['C2', CUR, 'Septembre 2026', 750, '2026-10-02'],
  ]) {
    await prisma.coachFee.create({
      data: { coachId: C[coach], seasonId: season, period, amount, paidAt: paidAt ? day(paidAt) : null },
    });
  }

  // Présences
  const coachUser = (await prisma.coach.findUnique({ where: { id: C.C1 } })).userId;
  for (const [g, date, pid, present, reason] of [
    ['G1', '2026-09-28', 'J1', false, 'Malade (justifié par le parent)'],
    ['G1', '2026-09-30', 'J1', true],
    ['G1', '2026-10-05', 'J1', true],
    ['G2', '2026-10-01', 'J2', false, 'Non justifiée'],
    ['G2', '2026-09-29', 'J2', true],
    ['G3', '2026-10-01', 'J3', false, 'Déplacement professionnel'],
    ['G3', '2026-10-05', 'J3', true],
    ['G1', '2026-10-05', 'J5', true],
  ]) {
    await prisma.attendance.create({
      data: { groupId: G[g], playerId: J[pid], date: day(date), present, reason, recordedById: coachUser },
    });
  }

  // Événements
  await prisma.event.create({
    data: { title: 'Tournoi interne d’automne', date: day('2026-10-25'), place: 'Club, courts 1 à 3', tag: 'Tournoi' },
  });

  // Emails envoyés (historique de démo)
  await prisma.emailLog.createMany({
    data: [
      { to: 'omar.trabelsi@exemple.tn', subject: 'Vos identifiants TCSAY', kind: 'CREDENTIALS', status: 'SENT', body: '(démo)', createdAt: new Date('2026-09-10T10:12:00') },
      { to: 'sana.benali@exemple.tn', subject: 'Vos identifiants TCSAY', kind: 'CREDENTIALS', status: 'SENT', body: '(démo)', createdAt: new Date('2026-09-10T10:14:00') },
      { to: 'mourad.hammami@exemple.tn', subject: 'Rappel : tranche 1/3 de Nour en retard', kind: 'REMINDER', status: 'SENT', body: '(démo)', createdAt: new Date('2026-10-01T09:00:00') },
      { to: 'mehdi.gharbi@exemple.tn', subject: 'Votre salaire de septembre est versé', kind: 'SALARY', status: 'SENT', body: '(démo)', createdAt: new Date('2026-10-02T17:40:00') },
    ],
  });

  // Journal d'audit (historique de démo)
  await prisma.auditLog.createMany({
    data: [
      { userId: admin.id, action: 'Saison activée', entity: 'Season', target: '2026-2027', before: 'Brouillon', after: 'Active', createdAt: new Date('2026-09-01T08:00:00') },
      { userId: admin.id, action: 'Dérogation de catégorie', entity: 'GroupMember', target: 'Adam Sassi → groupe Benjamins A', before: 'Minimes G. (-14)', after: 'Groupe Benjamins A', reason: 'Niveau adapté au groupe Benjamins A', createdAt: new Date('2026-09-15T09:30:00') },
      { userId: admin.id, action: 'Paiement encaissé (espèces)', entity: 'Payment', target: 'Lina Ben Ali · Tranche 1/2', before: '0 DT', after: '150 DT', createdAt: new Date('2026-09-20T11:05:00') },
      { userId: admin.id, action: 'Salaire marqué versé', entity: 'CoachFee', target: 'Mehdi Gharbi · Septembre 2026', before: 'À verser', after: 'Versé', createdAt: new Date('2026-10-02T17:38:00') },
    ],
  });

  console.log('Seed de démonstration chargé.');
  console.log('  Admin  : admin@tcsay.tn / admin1234');
  console.log('  Autres : sana.benali@exemple.tn, omar.trabelsi@exemple.tn, mehdi.gharbi@exemple.tn… / temporaire');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
