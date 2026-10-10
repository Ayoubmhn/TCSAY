// Données de référence du club, communes au seed de démonstration et à la base de production vierge.
// - 29 catégories (+ Loisirs) ;
// - programme réel des entraînements « à partir du 05/10 » (groupes, créneaux, terrains, entraîneurs).

// ───── 29 catégories ─────
export function categories() {
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
export const L = 1, MA = 2, ME = 3, J = 4, V = 5, S = 6, D = 0;
export const PROGRAMME = {
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


/** Terrains du programme (éclairage et surface de l'Annexe : à confirmer). */
export const COURTS = [
  ['C1', { name: 'Court 1', lit: true, surface: 'CLAY' }],
  ['C2', { name: 'Court 2', lit: true, surface: 'CLAY' }],
  ['C3', { name: 'Court 3', lit: true, surface: 'HARD' }],
  ['AN', { name: 'Annexe', lit: false, surface: 'CLAY' }],
];

/** Entraîneurs du programme : prénom et couleur de la légende (noms, CIN, emails et rémunérations à compléter). */
export const COACHES = [
  ['Iheb', '#00b050'],
  ['Aziz', '#ed7d31'],
  ['Abdesattar', '#00b0f0'],
  ['Sarah', '#ff00ff'],
  ['Louay', '#ffd966'],
];

/** Tarifs d'entraînement donnés par le club pour 2026-2027 : Lutins / Lutines 800 DT, autres catégories 1000 DT. */
export const LUTINS = ['J6M', 'J6F', 'J7M', 'J7F', 'J8M', 'J8F'];
export const feeFor = (code) => (LUTINS.includes(code) ? 800 : 1000);

/** Paramètres par défaut (valeurs proposées, à confirmer avec le bureau). */
export const DEFAULT_SETTINGS = [
  { key: 'nightStartHour', value: '18' },
  { key: 'cancelDelayHours', value: '24' },
  { key: 'openingHour', value: '8' },
  { key: 'closingHour', value: '22' },
];
