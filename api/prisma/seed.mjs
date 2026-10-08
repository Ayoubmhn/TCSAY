// ⚠ Ce seed VIDE la base puis la recharge.
// - Planning des entraînements : RÉEL (programme du Tennis Club Sayada « à partir du 05/10 »).
// - Joueurs, parents, montants, salaires, réservations : valeurs de DÉMONSTRATION, jamais des tarifs réels.
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
const pad = (n) => String(n).padStart(2, '0');
/** Date + heure locales (Africa/Tunis), décalées de n jours à partir d'aujourd'hui. */
function inDays(n, hour) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d;
}
/** Prochain jour de la semaine (0 = dimanche) à partir d'aujourd'hui, décalé de `weeks` semaines. */
function nextWeekday(wd, weeks = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7) + weeks * 7);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function wipe() {
  // Le journal d'audit refuse DELETE (déclencheur) : on le vide par TRUNCATE.
  await prisma.$executeRawUnsafe('TRUNCATE "AuditLog"');
  for (const model of [
    'extractedRecord', 'scannedPage', 'importBatch', 'payment', 'installment', 'membership', 'feeSchedule',
    'attendance', 'coachAbsence', 'reservation', 'groupMember', 'slotCoach', 'groupSlot', 'trainingGroup',
    'enrollment', 'salary', 'parentLink', 'player', 'coach', 'emailLog', 'user', 'courtRate', 'court',
    'category', 'season', 'event', 'setting', 'rolePermission',
  ]) {
    await prisma[model].deleteMany();
  }
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
    { code: 'LSR', name: 'Loisirs', family: 'LEISURE', gender: 'MIXED', pairCode: 'L1', note: 'Tous âges · octobre → juin' },
  );
  return list.map((c, i) => ({ ...c, sortOrder: i + 1 }));
}

// ───── Programme réel des entraînements (à partir du 05/10) ─────
// Jours : 0 = dimanche … 6 = samedi. Entraîneur null = case sans couleur de la légende (à affecter).
const L = 1, MA = 2, ME = 3, J = 4, V = 5, S = 6, D = 0;
const PROGRAMME = {
  'Poussins': [[L, '17:30', '19:00', 'C1', null], [V, '17:30', '19:00', 'C1', null]],
  'Benjamins G/F': [[L, '19:00', '20:30', 'C1', null]],
  'Benjamines': [[L, '17:30', '19:00', 'C2', 'Aziz'], [S, '15:30', '17:00', 'C3', 'Aziz']],
  'Poussins G': [[L, '19:00', '20:30', 'C2', 'Aziz'], [MA, '19:00', '20:30', 'C2', 'Aziz'], [V, '19:00', '20:30', 'C2', 'Aziz']],
  'Lutins 1': [[L, '17:30', '19:00', 'C3', 'Iheb'], [MA, '17:30', '19:00', 'C3', 'Iheb'], [V, '17:30', '19:00', 'C3', 'Iheb'], [S, '09:30', '11:00', 'C1', 'Iheb']],
  'Poussines F': [[L, '19:00', '20:30', 'C3', 'Iheb'], [MA, '19:00', '20:30', 'C3', 'Iheb'], [V, '19:00', '20:30', 'C3', 'Iheb']],
  'Lutins 2': [
    [MA, '17:30', '19:00', 'C1', 'Abdesattar'], [ME, '17:30', '19:00', 'C1', 'Abdesattar'], [J, '17:30', '19:00', 'C1', 'Abdesattar'],
    [J, '19:00', '20:30', 'C3', null], [S, '09:30', '11:00', 'C2', 'Abdesattar'], [S, '11:00', '12:30', 'C1', null],
  ],
  'Minimes': [[MA, '19:00', '20:30', 'C1', 'Abdesattar'], [ME, '19:00', '20:30', 'C1', 'Abdesattar'], [J, '19:00', '20:30', 'C1', 'Abdesattar']],
  'Benjamins G': [
    [MA, '17:30', '19:00', 'C2', 'Aziz'], [ME, '17:30', '19:00', 'C2', 'Aziz'], [ME, '19:00', '20:30', 'C3', null],
    [J, '19:00', '20:30', 'C2', 'Aziz'], [S, '14:00', '15:30', 'C3', 'Aziz'],
  ],
  'Benjamines 2': [[ME, '16:00', '17:30', 'C2', 'Aziz'], [J, '16:00', '17:30', 'C2', 'Aziz']],
  'Benjamines 1': [[ME, '19:00', '20:30', 'C2', 'Aziz'], [V, '17:30', '19:00', 'C2', 'Aziz']],
  'Minimes/BJE': [[ME, '17:30', '19:00', 'C3', null]],
  'Poussins G/F': [[J, '17:30', '19:00', 'C2', 'Aziz']],
  'Poussines G/F': [[J, '17:30', '19:00', 'C3', null]],
  'CJ (U16/U18)': [[V, '19:00', '20:30', 'C1', null], [S, '17:00', '18:30', 'C3', null], [D, '14:00', '15:30', 'C3', null]],
  '19/20': [[S, '14:00', '15:00', 'C1', 'Sarah'], [D, '09:00', '10:00', 'C2', 'Sarah']],
  '21/22': [[S, '15:00', '16:00', 'C1', 'Sarah'], [D, '10:00', '11:00', 'C2', 'Sarah']],
  'Collégiens': [[S, '16:00', '17:00', 'C1', 'Sarah'], [D, '11:00', '12:00', 'C2', 'Sarah']],
  'Lycéens': [[S, '17:00', '18:00', 'C1', 'Sarah'], [D, '12:00', '13:00', 'C2', 'Sarah']],
  '15/16': [[S, '14:00', '15:00', 'C2', 'Louay'], [D, '09:00', '10:00', 'C3', 'Louay']],
  '17/18': [[S, '15:00', '16:00', 'C2', 'Louay'], [D, '10:00', '11:00', 'C3', 'Louay']],
  'JF (12+)': [[S, '16:00', '17:00', 'C2', 'Louay'], [D, '11:00', '12:00', 'C3', 'Louay']],
  'JG (+12)': [[S, '17:00', '18:00', 'C2', 'Louay'], [D, '12:00', '13:00', 'C3', 'Louay']],
};

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

  await prisma.category.createMany({ data: categories() });
  const cat = Object.fromEntries((await prisma.category.findMany()).map((c) => [c.code, c.id]));

  // Saisons
  const S_ = {};
  for (const s of [
    // Compétitif : septembre → août (stage d'été inclus) ; loisirs : octobre → juin.
    { label: '2010-2011', startDate: '2010-09-01', endDate: '2011-08-31', status: 'HISTORICAL' },
    { label: '2025-2026', startDate: '2025-09-01', endDate: '2026-08-31', status: 'CLOSED' },
    { label: '2026-2027', startDate: '2026-09-01', endDate: '2027-08-31', status: 'ACTIVE' },
    { label: '2027-2028', startDate: '2027-09-01', endDate: '2028-08-31', status: 'DRAFT' },
  ]) {
    const y = Number(s.startDate.slice(0, 4));
    S_[s.label] = (
      await prisma.season.create({
        data: {
          ...s,
          startDate: day(s.startDate),
          endDate: day(s.endDate),
          leisureStartDate: day(`${y}-10-01`),
          leisureEndDate: day(`${y + 1}-06-30`),
        },
      })
    ).id;
  }
  const CUR = S_['2026-2027'];
  const PREV = S_['2025-2026'];

  // Terrains du programme (éclairage de l'Annexe : à confirmer)
  const T = {};
  for (const [i, [key, data]] of [
    ['C1', { name: 'Court 1', lit: true, surface: 'CLAY' }],
    ['C2', { name: 'Court 2', lit: true, surface: 'CLAY' }],
    ['C3', { name: 'Court 3', lit: true, surface: 'HARD' }],
    ['AN', { name: 'Annexe', lit: false, surface: 'CLAY' }], // surface à confirmer
  ].entries()) {
    T[key] = (await prisma.court.create({ data: { ...data, sortOrder: i + 1 } })).id;
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

  // ───── Comptes ─────
  const temp = hashPassword('temporaire');
  // Un compte peut cumuler plusieurs rôles (ex. directeur technique et entraîneur).
  const user = ({ role, roles, ...data }) => prisma.user.create({ data: { passwordHash: temp, roles: roles ?? [role], ...data } });

  const admin = await user({
    email: 'admin@tcsay.tn',
    role: 'PRESIDENT',
    firstName: 'Président',
    lastName: 'Bureau',
    passwordHash: hashPassword('admin1234'),
    mustChangePassword: false,
  });

  // Personnel du club (DÉMO)
  await user({ email: 'agent@tcsay.tn', role: 'ADMIN_AGENT', firstName: 'Agent', lastName: 'Administratif', cin: '09000001', payMode: 'MONTHLY', payRate: 700 });
  await user({ email: 'superviseur@tcsay.tn', role: 'SUPERVISOR', firstName: 'Agent', lastName: 'Superviseur', cin: '09000003', payMode: 'MONTHLY', payRate: 600 });
  // Directeur technique qui entraîne aussi (deux rôles, deux espaces)
  const dt = await user({ email: 'dt@tcsay.tn', roles: ['TECH_DIRECTOR', 'COACH'], firstName: 'Directeur', lastName: 'Technique', cin: '09000002', payMode: 'MONTHLY', payRate: 1200 });
  await prisma.coach.create({ data: { userId: dt.id, color: '#7030a0' } });

  // Entraîneurs du programme, couleurs de la légende (noms de famille et CIN à compléter, rémunérations DÉMO)
  const C = {};
  const coachUser = {};
  for (const [first, color, payMode, payRate, cin] of [
    ['Iheb', '#00b050', 'HOURLY', 20, '09100001'],
    ['Aziz', '#ed7d31', 'MONTHLY', 900, '09100002'],
    ['Abdesattar', '#00b0f0', 'HOURLY', 20, '09100003'],
    ['Sarah', '#ff00ff', 'HOURLY', 18, '09100004'],
    ['Louay', '#ffd966', 'MONTHLY', 600, '09100005'],
  ]) {
    const u = await user({
      email: `${first.toLowerCase()}@exemple.tn`,
      role: 'COACH',
      firstName: first,
      lastName: '',
      cin,
      phone: '+216 22 000 1' + String(Object.keys(C).length).padStart(2, '0'),
      payMode,
      payRate,
    });
    coachUser[first] = u.id;
    C[first] = (await prisma.coach.create({ data: { userId: u.id, color } })).id;
  }

  // Parents (DÉMO)
  const U = {};
  for (const [id, first, last, email, phone, cin] of [
    ['U1', 'Sana', 'Ben Ali', 'sana.benali@exemple.tn', '+216 55 000 201', '08000201'],
    ['U2', 'Hela', 'Kefi', 'hela.kefi@exemple.tn', '+216 55 000 202', '08000202'],
    ['U3', 'Mourad', 'Hammami', 'mourad.hammami@exemple.tn', '+216 55 000 203', '08000203'],
    ['U4', 'Fethi', 'Sassi', 'fethi.sassi@exemple.tn', '+216 55 000 204', '08000204'],
    ['U5', 'Rim', 'Chaabane', 'rim.chaabane@exemple.tn', '+216 55 000 205', '08000205'],
  ]) {
    U[id] = (await user({ email, role: 'PARENT', firstName: first, lastName: last, phone, cin })).id;
  }

  // Joueurs (DÉMO) : [id, prénom, nom, genre, naissance, catégorie, groupe réel, email, téléphone, CIN]
  const J_ = {};
  const E = {};
  const players = [
    ['J1', 'Yassine', 'Ben Ali', 'M', '2015-03-12', 'J12M', 'Benjamins G'],
    ['J2', 'Lina', 'Ben Ali', 'F', '2017-07-02', 'J10F', 'Poussines F'],
    ['J3', 'Omar', 'Trabelsi', 'M', '1990-05-20', 'A1M', null, 'omar.trabelsi@exemple.tn', '+216 98 000 303', '07000303'],
    ['J4', 'Nour', 'Hammami', 'F', '2012-01-18', 'J16F', 'JF (12+)'],
    ['J5', 'Adam', 'Sassi', 'M', '2014-09-04', 'J14M', 'Minimes'],
    ['J6', 'Rayen', 'Kefi', 'M', '2019-11-23', 'J8M', 'Lutins 1'],
    ['J7', 'Ahmed', 'Bouzid', 'M', '1985-02-11', 'V35M', null, 'ahmed.bouzid@exemple.tn', '+216 98 000 307', '07000307'],
    ['J8', 'Ines', 'Chaabane', 'F', '2011-06-30', 'J16F', 'JF (12+)'],
  ];
  for (const [id, first, last, gender, birth, code, , email, phone, cin] of players) {
    let userId = null;
    if (email) userId = (await user({ email, role: 'PLAYER', firstName: first, lastName: last, phone, cin })).id;
    const p = await prisma.player.create({
      data: { firstName: first, lastName: last, gender, birthDate: day(birth), email, phone, cin, userId },
    });
    J_[id] = p.id;
    E[id] = (await prisma.enrollment.create({ data: { playerId: p.id, seasonId: CUR, categoryId: cat[code] } })).id;
  }
  const E_PREV = {
    J1: (await prisma.enrollment.create({ data: { playerId: J_.J1, seasonId: PREV, categoryId: cat.J11M } })).id,
    J3: (await prisma.enrollment.create({ data: { playerId: J_.J3, seasonId: PREV, categoryId: cat.A1M } })).id,
  };
  for (const [u, kids] of [['U1', ['J1', 'J2']], ['U2', ['J6']], ['U3', ['J4']], ['U4', ['J5']], ['U5', ['J8']]]) {
    for (const k of kids) await prisma.parentLink.create({ data: { parentId: U[u], playerId: J_[k] } });
  }

  // Groupes et créneaux du programme réel (catégories à affecter par le club)
  const G = {};
  const SLOT = {}; // `${groupe}|${jour}|${début}` → id du créneau
  for (const [name, slots] of Object.entries(PROGRAMME)) {
    const g = await prisma.trainingGroup.create({ data: { seasonId: CUR, name, capacity: 12 } });
    G[name] = g.id;
    for (const [d, start, end, court, coach] of slots) {
      const slot = await prisma.groupSlot.create({
        data: {
          groupId: g.id,
          day: d,
          startTime: start,
          endTime: end,
          courtId: T[court],
          coaches: coach ? { create: [{ coachId: C[coach] }] } : undefined,
        },
      });
      SLOT[`${name}|${d}|${start}`] = slot.id;
    }
  }
  // Séance animée par deux entraîneurs (exemple) : Iheb rejoint Abdesattar sur Lutins 2 le samedi matin.
  await prisma.slotCoach.create({ data: { slotId: SLOT[`Lutins 2|${S}|09:30`], coachId: C.Iheb } });

  for (const [pid, , , , , , groupName] of players) {
    if (groupName) await prisma.groupMember.create({ data: { groupId: G[groupName], enrollmentId: E[pid] } });
  }

  // Tarifs d'entraînement 2026-2027 (tarifs du club) : Lutins / Lutines 800 DT, autres catégories 1000 DT.
  // Acompte : à définir par le club (0 par défaut). Saison 2025-2026 : montants de démonstration.
  const F = {};
  const LUTINS = ['J6M', 'J6F', 'J7M', 'J7F', 'J8M', 'J8F'];
  for (const [code, id] of Object.entries(cat)) {
    F[code] = (await prisma.feeSchedule.create({
      data: { seasonId: CUR, categoryId: id, amount: LUTINS.includes(code) ? 800 : 1000, depositAmount: 0 },
    })).id;
  }
  for (const [key, code, amount] of [['P11', 'J11M', 560], ['PA1', 'A1M', 650]]) {
    F[key] = (await prisma.feeSchedule.create({ data: { seasonId: PREV, categoryId: cat[code], amount, depositAmount: 0 } })).id;
  }

  // Cotisations, tranches et paiements (montants payés : DÉMO)
  const memberships = [
    [E.J1, F.J12M, 'SEMESTER', 1000, [['2026-10-15', 500, 500, '2026-09-18'], ['2027-01-15', 500, 0]]],
    [E.J2, F.J10F, 'SEMESTER', 1000, [['2026-10-15', 500, 150, '2026-09-20'], ['2027-01-15', 500, 0]]],
    [E.J3, F.A1M, 'FULL', 1000, [['2026-09-12', 1000, 1000, '2026-09-12']]],
    [E.J4, F.J16F, 'MONTHLY', 1000, [['2026-09-30', 334, 0], ['2026-12-31', 333, 0], ['2027-03-31', 333, 0]]],
    [E_PREV.J1, F.P11, 'SEMESTER', 560, [['2025-10-15', 280, 280, '2025-10-10'], ['2026-01-15', 280, 280, '2026-01-12']]],
    [E_PREV.J3, F.PA1, 'FULL', 650, [['2025-10-15', 650, 650, '2025-10-01']]],
  ];
  for (const [enrollmentId, feeScheduleId, paymentPlan, total, insts] of memberships) {
    const m = await prisma.membership.create({ data: { enrollmentId, feeScheduleId, paymentPlan, totalAmount: total } });
    for (const [i, [due, amount, paid, paidAt]] of insts.entries()) {
      const inst = await prisma.installment.create({
        data: { membershipId: m.id, number: i + 1, count: insts.length, dueDate: day(due), amount },
      });
      if (paid) await prisma.payment.create({ data: { installmentId: inst.id, amount: paid, paidAt: day(paidAt), recordedById: admin.id } });
    }
  }

  // Réservations (DÉMO, relatives à aujourd'hui) — hors créneaux d'entraînement
  const omar = (await prisma.player.findUnique({ where: { id: J_.J3 } })).userId;
  for (const [pid, n, hour, court, type, bookedBy, coach] of [
    ['J3', 1, 10, 'C1', 'LEISURE', omar],
    ['J3', 4, 9, 'C2', 'LEISURE', omar],
    ['J1', 5, 13, 'C3', 'LEISURE', U.U1],
    ['J4', 3, 15, 'C1', 'PRIVATE', coachUser.Aziz, 'Aziz'],
  ]) {
    const start = inDays(n, hour);
    await prisma.reservation.create({
      data: {
        courtId: T[court],
        playerId: J_[pid],
        coachId: coach ? C[coach] : null,
        type,
        startTime: start,
        endTime: inDays(n, hour + 1),
        price: type === 'PRIVATE' ? 20 : 10,
        bookedById: bookedBy,
        activeKey: `${T[court]}|${start.toISOString()}`,
      },
    });
  }

  // Salaires (DÉMO) : septembre versé, octobre à verser
  for (const [first, month, hours, amount, paidAt] of [
    ['Iheb', '2026-09', 40, 800, '2026-10-02'],
    ['Aziz', '2026-09', null, 900, '2026-10-02'],
    ['Abdesattar', '2026-09', 36, 720, '2026-10-02'],
    ['Aziz', '2026-10', null, 900, null],
  ]) {
    await prisma.salary.create({
      data: { employeeId: coachUser[first], seasonId: CUR, month, hours, amount, paidAt: paidAt ? day(paidAt) : null },
    });
  }

  // Absences d'entraîneurs (DÉMO) : une à valider, une validée
  await prisma.coachAbsence.create({
    data: { coachId: C.Aziz, date: day(nextWeekday(ME, 1)), reason: 'Formation fédérale', notifyGroups: true },
  });
  await prisma.coachAbsence.create({
    data: {
      coachId: C.Iheb,
      date: day(nextWeekday(V, 1)),
      slotId: SLOT[`Lutins 1|${V}|17:30`],
      reason: 'Rendez-vous médical',
      status: 'APPROVED',
      resolution: 'REPLACED',
      replacementCoachId: C.Abdesattar,
      decidedById: admin.id,
      decidedAt: new Date(),
    },
  });

  // Présences (DÉMO) : séances passées des Lutins 1 et Benjamins G
  for (const [g, d, start, pid, status, reason] of [
    ['Lutins 1', '2026-10-05', '17:30', 'J6', 'PRESENT'],
    ['Benjamins G', '2026-10-06', '17:30', 'J1', 'ABSENT', 'Malade (justifié par le parent)'],
    ['Poussines F', '2026-10-05', '19:00', 'J2', 'LATE', 'Arrivée à 19:20'],
  ]) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    await prisma.attendance.create({
      data: {
        groupId: G[g],
        slotId: SLOT[`${g}|${wd}|${start}`],
        playerId: J_[pid],
        date: day(d),
        status,
        reason,
        recordedById: coachUser.Iheb,
      },
    });
  }

  await prisma.event.create({
    data: { title: 'Tournoi interne d’automne', date: day('2026-10-25'), place: 'Club, courts 1 à 3', tag: 'Tournoi' },
  });

  await prisma.emailLog.createMany({
    data: [
      { to: 'omar.trabelsi@exemple.tn', subject: 'Vos identifiants TCSAY', kind: 'CREDENTIALS', status: 'SENT', body: '(démo)', createdAt: new Date('2026-09-10T10:12:00') },
      { to: 'sana.benali@exemple.tn', subject: 'Vos identifiants TCSAY', kind: 'CREDENTIALS', status: 'SENT', body: '(démo)', createdAt: new Date('2026-09-10T10:14:00') },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      { userId: admin.id, action: 'Saison activée', entity: 'Season', target: '2026-2027', before: 'Brouillon', after: 'Active', createdAt: new Date('2026-09-01T08:00:00') },
      { userId: admin.id, action: 'Programme des entraînements importé', entity: 'TrainingGroup', target: 'Programme à partir du 05/10', after: `${Object.keys(PROGRAMME).length} groupes`, createdAt: new Date('2026-10-04T18:00:00') },
      { userId: admin.id, action: 'Salaire marqué versé', entity: 'Salary', target: 'Aziz · 2026-09', before: 'À verser', after: 'Versé', createdAt: new Date('2026-10-02T17:38:00') },
    ],
  });

  console.log('Seed chargé : programme réel du 05/10 + données de démonstration.');
  console.log('  Admin  : admin@tcsay.tn / admin1234');
  console.log('  Autres : sana.benali@, omar.trabelsi@, iheb@exemple.tn, agent@, superviseur@, dt@tcsay.tn… / temporaire');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
