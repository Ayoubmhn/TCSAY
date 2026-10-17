/** Types des réponses de l'API (miroir des contrôleurs NestJS). */

/** Rôle d'action de l'espace courant (ADMIN = espace administration). */
export type Role = 'ADMIN' | 'COACH' | 'PARENT' | 'PLAYER' | 'STAFF';
/** Acteurs cumulables d'un compte. */
export type Actor = 'PRESIDENT' | 'ADMIN_AGENT' | 'SUPERVISOR' | 'TECH_DIRECTOR' | 'COACH' | 'PARENT' | 'PLAYER';
export type Space = 'admin' | 'coach' | 'parent' | 'player';

export type PayMode = 'HOURLY' | 'MONTHLY';
export type StaffFunction = 'ADMIN_AGENT' | 'SUPERVISOR' | 'TECH_DIRECTOR';
export type PaymentPlan = 'FULL' | 'SEMESTER' | 'MONTHLY';
export type DiscountKind = 'SIBLING' | 'SPECIAL' | 'EXEMPT';

/** Cotisation d'un joueur (fiche « Modifier ») : montants, réduction, frères et sœurs inscrits. */
export type MembershipInfo = {
  siblings: { id: string; name: string }[];
  membership: {
    paymentPlan: PaymentPlan;
    base: number;
    total: number;
    paid: number;
    discountKind: DiscountKind | null;
    discountPercent: number | null;
    discountAmount: number | null;
    discountReason: string | null;
  } | null;
};
export type EmployeeType = 'COACH' | 'ADMIN_AGENT' | 'SUPERVISOR' | 'TECH_DIRECTOR';

export type PersonRef = { id: string; firstName: string; lastName: string; photoUrl?: string | null };

export type Me = {
  id: string;
  email: string | null;
  phone: string | null;
  cin: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  role: Role;
  roles: Actor[];
  space: Space;
  spaces: Space[];
  permissions: string[];
  firstName: string;
  lastName: string;
  mustChangePassword: boolean;
  /** Mot de passe temporaire gardé (« Modifier plus tard ») : rappel dans Paramètres. */
  temporaryPassword?: boolean;
  playerId: string | null;
  coachId: string | null;
  players: PersonRef[];
  /** Photo de profil (adresse signée de l'API, relative à /api/v1). */
  photoUrl?: string | null;
};

export type Category = {
  id: string;
  code: string;
  name: string;
  family: 'YOUTH' | 'ADULT' | 'VETERAN' | 'CORPORATE' | 'PADEL' | 'LEISURE';
  gender: 'M' | 'F' | 'MIXED';
  pairCode: string;
  note: string | null;
  playersCount: number;
};

export type Suggestion =
  | { error: string; age: number }
  | {
      category: { id: string; name: string; code: string };
      age: number;
      minor: boolean;
      alternative: { id: string; name: string } | null;
      referenceYear: number;
    };

export type Player = {
  photoUrl?: string | null;
  id: string;
  /** Identifiant du club « 26TCSAY052 » (provisoire tant que l'historique n'est pas importé). */
  memberCode: string | null;
  memberCodeProvisional: boolean;
  firstName: string;
  lastName: string;
  nameAr: string | null;
  /** Inconnue pour certains joueurs importés du cahier. */
  birthDate: string | null;
  /** Seule l'année de naissance est connue (date enregistrée au 1er janvier). */
  birthYearOnly: boolean;
  city: string | null;
  notes: string | null;
  origin: 'MANUAL' | 'IMPORT';
  /** Origine d'un joueur importé : « fichier · ligne 12 (n° 10) ». */
  importRef: string | null;
  /** Inscrit dans la saison active. */
  enrolled: boolean;
  /** Cotisation de la saison active (null : pas encore créée). */
  membership: { paymentPlan: PaymentPlan; total: number; paid: number } | null;
  gender: 'M' | 'F';
  email: string | null;
  phone: string | null;
  cin: string | null;
  hasAccount: boolean;
  archivedAt: string | null;
  version: number;
  age: number | null;
  minor: boolean;
  category: { id: string; code: string; name: string } | null;
  derogationReason: string | null;
  group: { id: string; name: string } | null;
  parents: (PersonRef & { email: string })[];
};

export type Parent = {
  photoUrl?: string | null;
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  cin: string | null;
  isActive: boolean;
  version: number;
  players: (PersonRef & { memberCode?: string | null })[];
  lastLoginAt?: string | null;
  /** Dernière invitation (lien WhatsApp / SMS) : envoyée, coordonnées reçues. */
  invitation?: { sentAt: string; expiresAt: string; completed: boolean; replaced: boolean } | null;
};

export type CoachRef = { id: string; firstName: string; lastName: string; color: string };

export type Coach = {
  photoUrl?: string | null;
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  cin: string | null;
  isActive: boolean;
  color: string;
  payMode: PayMode | null;
  payRate: number;
  version: number;
  groups: { id: string; name: string }[];
  sessionsPerWeek: number;
  /** Autres rôles du même compte (ex. directeur technique, joueur). */
  otherRoles?: Actor[];
};

export type Staff = {
  photoUrl?: string | null;
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  cin: string | null;
  roles: Actor[];
  /** Fonctions du personnel (cumulables). */
  functions: StaffFunction[];
  functionsLabel: string;
  payMode: PayMode | null;
  payRate: number;
  isActive: boolean;
  version: number;
};

/** Identifiants renvoyés à la création d'un compte (mot de passe affiché si pas d'email). */
export type Credentials = { sentTo: string | null; login: string; temporaryPassword: string | null };

export type Slot = {
  id: string;
  day: number;
  startTime: string;
  endTime: string;
  court: { id: string; name: string } | null;
  coaches: CoachRef[];
};

export type CourtSurface = 'CLAY' | 'HARD' | 'GRASS';
export const SURFACE_LABEL: Record<CourtSurface, string> = { CLAY: 'Terre battue', HARD: 'Dur', GRASS: 'Gazon' };

export type Court = {
  id: string;
  name: string;
  surface: CourtSurface;
  lit: boolean;
  active: boolean;
  maintenance: boolean;
  version: number;
  futureReservations: number;
};

export type GroupKind = 'LEISURE' | 'COMPETITIVE';

export type Group = {
  id: string;
  seasonId: string;
  name: string;
  kind: GroupKind;
  capacity: number;
  version: number;
  category: { id: string; name: string; code: string } | null;
  slots: Slot[];
  coaches: CoachRef[];
  members: { playerId: string; firstName: string; lastName: string; category: string; derogationReason: string | null }[];
};

export type Fee = {
  id: string;
  amount: number;
  depositAmount: number;
  physicalIncluded: boolean;
  version: number;
  category: { id: string; name: string };
  group: { id: string; name: string } | null;
  season: { id: string; label: string; status: string };
};

export type CourtRate = { id: string; type: 'LEISURE' | 'PRIVATE'; period: 'DAY' | 'NIGHT'; pricePerHour: number; version: number };

export type InstallmentStatus = 'PAID' | 'PARTIAL' | 'DUE' | 'LATE';

export type Installment = {
  id: string;
  number: number;
  count: number;
  dueDate: string;
  amount: number;
  paid: number;
  remaining: number;
  status: InstallmentStatus;
  player: PersonRef;
  season: { id: string; label: string; status: string };
  parents?: PersonRef[];
  groups?: { id: string; name: string }[];
  payments?: InstallmentPayment[];
};

export type PaymentMethod = 'CASH' | 'CHEQUE' | 'ONLINE';

export type InstallmentPayment = {
  id: string;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  chequeNumber: string | null;
  kind: 'PAYMENT' | 'REFUND' | 'CORRECTION';
  /** Reçu valide (n° du carnet sur 7 chiffres). */
  receipt: { id: string; number: string } | null;
};

/** Reçu d'un paiement (carnet pré-numéroté ou PDF). */
export type Receipt = {
  id: string;
  number: number;
  numberText: string;
  paymentId: string;
  payerName: string;
  amount: number;
  amountWords: string;
  label: string;
  method: PaymentMethod;
  chequeNumber: string | null;
  seasonLabel: string;
  issuedOn: string;
  printCount: number;
  lastPrintedAt: string | null;
  createdAt: string;
  issuedBy: string;
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
  player: PersonRef;
  installment: { number: number; count: number };
};

export type PaymentReceipts = {
  payment: {
    id: string;
    amount: number;
    method: PaymentMethod;
    chequeNumber: string | null;
    paidAt: string;
    player: PersonRef;
    installment: { number: number; count: number };
    season: string;
  };
  active: Receipt | null;
  history: Receipt[];
  draft: { payerName: string; amountWords: string; label: string; chequeNumber: string; issuedOn: string; seasonLabel: string };
  next: number | null;
  last: number | null;
};

export type ReceiptField = 'label' | 'payerName' | 'amountWords' | 'amountDigits' | 'barCheque' | 'barCash' | 'chequeNumber' | 'season' | 'date';
export type ReceiptBox = { x: number; y: number; w: number };
export type ReceiptLayout = {
  pageWidth: number;
  pageHeight: number;
  offsetX: number;
  offsetY: number;
  fontSize: number;
  fields: Record<ReceiptField, ReceiptBox>;
  footer: string[];
};

export type SlotState = 'free' | 'short' | 'mine' | 'taken' | 'group' | 'maintenance' | 'unlit' | 'past';

/** Grille de réservation : départs toutes les 30 min (« 17:30 »), une heure de jeu. */
export type Grid = {
  date: string;
  times: string[];
  /** Durée minimale (60) et maximale (240) d'une réservation, en minutes. */
  durationMinutes: number;
  maxDurationMinutes: number;
  nightStartHour: number;
  courts: { id: string; name: string; lit: boolean; maintenance: boolean; active: boolean }[];
  slots: { courtId: string; times: { time: string; state: SlotState }[] }[];
};

export type Reservation = {
  id: string;
  date: string;
  hour: number;
  /** Départ « HH:MM » et fin « HH:MM ». */
  time: string;
  endTimeLabel: string;
  startTime: string;
  type: 'LEISURE' | 'PRIVATE' | 'TOURNAMENT' | 'MATCH';
  price: number;
  court: { id: string; name: string };
  player: PersonRef | null;
  coach: { id: string; firstName: string; lastName: string } | null;
  bookedBy: string | null;
};

export type Salary = {
  id: string;
  month: string;
  hours: number | null;
  absences: number;
  amount: number;
  paidAt: string | null;
  paid: boolean;
  note: string | null;
  version: number;
  employee: { id: string; firstName: string; lastName: string; type: EmployeeType | null; color: string | null };
  season: { id: string; label: string; status: string } | null;
};

export type Estimate = {
  employeeId: string;
  month: string;
  payMode: PayMode | null;
  payRate: number;
  plannedSessions: number;
  plannedHours: number;
  absentSessions: number;
  absentHours: number;
  hours: number | null;
  amount: number;
  rule: string;
};

export type Employee = {
  id: string;
  firstName: string;
  lastName: string;
  type: EmployeeType | null;
  payMode: PayMode | null;
  payRate: number;
  isActive: boolean;
  coach: { id: string; color: string } | null;
};

export type CoachAbsence = {
  id: string;
  date: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  notifyGroups: boolean;
  decisionNote: string | null;
  decidedBy: string | null;
  createdAt: string;
  coach: CoachRef;
  resolution: AbsenceResolution | null;
  replacementCoach: CoachRef | null;
  slot: { id: string; day: number; startTime: string; endTime: string; group: { id: string; name: string } } | null;
};

export type Planning = {
  date: string;
  weekday: number;
  openingHour: number;
  closingHour: number;
  nightStartHour: number;
  courts: { id: string; name: string; lit: boolean; maintenance: boolean; active: boolean }[];
  sessions: (Slot & { group: { id: string; name: string }; absentCoachIds: string[]; resolution: AbsenceResolution | null; replacement: CoachRef | null })[];
  reservations: {
    id: string;
    courtId: string;
    startTime: string;
    endTime: string;
    type: 'LEISURE' | 'PRIVATE' | 'TOURNAMENT' | 'MATCH';
    player: string | null;
    coach: { name: string; color: string } | null;
    /** Créneau bloqué pour un match (tournoi, amical, interne). */
    match?: { id: string; title: string | null; kind: string; players: string; status: string } | null;
  }[];
  legend: { id: string; name: string; color: string }[];
};

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE';
/** Changement ponctuel (terrain pris par un tournoi) : séance déplacée sur un autre terrain ou reportée. */
export type SessionChange = { kind: 'MOVED' | 'POSTPONED'; reason: string; court: { id: string; name: string } | null };
export type AbsenceResolution = 'REPLACED' | 'PHYSICAL' | 'CANCELLED';

export type CoachSession = {
  slotId: string;
  coaches: CoachRef[];
  coachAbsent: boolean;
  /** Décision de la direction si l'entraîneur est absent. */
  resolution: AbsenceResolution | null;
  replacement: CoachRef | null;
  /** Ce coach remplace un collègue absent sur cette séance. */
  replacing: boolean;
  /** Pointage ouvert (séance en cours). */
  open: boolean;
  groupId: string;
  groupName: string;
  date: string;
  startTime: string;
  endTime: string;
  court: { id: string; name: string } | null;
  category: string | null;
  membersCount: number;
  capacity: number;
  started: boolean;
  recorded: boolean;
  change?: SessionChange;
};

export type PlayerSession = {
  slotId: string;
  coaches: CoachRef[];
  groupId: string;
  groupName: string;
  date: string;
  startTime: string;
  endTime: string;
  court: { id: string; name: string } | null;
  past: boolean;
  attendance: AttendanceStatus | null;
  resolution: AbsenceResolution | null;
  replacement: CoachRef | null;
  change?: SessionChange;
};

export type AttendanceSheet = {
  slotId: string;
  group: { id: string; name: string; startTime: string; endTime: string };
  date: string;
  open: boolean;
  opensAt: string;
  closesAt: string;
  editable: boolean;
  entries: { playerId: string; firstName: string; lastName: string; photoUrl?: string | null; status: AttendanceStatus | null; reason: string | null }[];
};

export type Mood = 'GOOD' | 'TIRED' | 'PAIN';

export type SessionRatingNotes = { effort: number; focus: number; behavior: number; objective: number; play: number };

/** Objectif et évaluations d'une séance (fenêtre d'évaluation de l'entraîneur). */
export type SessionReview = {
  group: { id: string; name: string };
  slotId: string;
  date: string;
  startTime: string;
  endTime: string;
  plan: { objective: string; content: string | null } | null;
  attendanceRecorded: boolean;
  editable: boolean;
  closesAt: string;
  players: {
    playerId: string;
    firstName: string;
    lastName: string;
    attendance: AttendanceStatus | null;
    rating: (SessionRatingNotes & { mood: Mood; comment: string | null; average: number }) | null;
  }[];
};

export type EvaluationCriterion = { key: string; label: string; family: string };

export type Evaluation = {
  id: string;
  period: string;
  periodLabel: string;
  scores: Record<string, number>;
  average: number | null;
  strengths: string | null;
  toWork: string | null;
  goals: string | null;
  proposedLevel: string | null;
  levelValidated: boolean;
  levelValidatedBy: string | null;
  shared: boolean;
  author: string;
  updatedAt: string;
};

export type ExerciseKind = 'WARMUP' | 'TECHNIQUE' | 'PHYSICAL' | 'RECOVERY';

export type Exercise = {
  id: string;
  title: string;
  kind: ExerciseKind;
  durationMin: number | null;
  instructions: string;
  videoUrl: string | null;
  author: string;
  mine: boolean;
  assignments: number;
};

export type Absence = {
  id: string;
  date: string;
  status: 'ABSENT' | 'LATE';
  group: { id: string; name: string; startTime: string; endTime: string };
  reason: string;
};

export type EventItem = { id: string; title: string; date: string; place: string; tag: string };

export type Overview = {
  season: { id: string; label: string };
  player: PersonRef;
  category: string | null;
  nextSession: {
    groupName: string;
    date: string;
    startTime: string;
    endTime: string;
    court: string | null;
    coaches: CoachRef[];
  } | null;
  hasGroup: boolean;
  /** Accès après paiement : planning fermé tant que la tranche en retard n'est pas payée. */
  sessionsLocked?: boolean;
  dueCount: number;
  dueAmount: number;
  upcomingReservations: number;
  absences: number;
};

export type Dashboard = {
  season: { id: string; label: string };
  activePlayers: number;
  groupsCount: number;
  coachesCount: number;
  cashed: number;
  paymentsCount: number;
  late: { id: string; number: number; count: number; dueDate: string; remaining: number; player: PersonRef }[];
  lateAmount: number;
  reservationsTomorrow: number;
  tomorrow: string;
  groups: { id: string; name: string; members: number; capacity: number }[];
};

export type EmailLog = {
  id: string;
  to: string;
  subject: string;
  kind: 'CREDENTIALS' | 'REMINDER' | 'SALARY' | 'RESERVATION' | 'OTHER';
  status: EmailStatus;
  error: string | null;
  attempts: number;
  sentAt: string | null;
  createdAt: string;
};

export type EmailStatus = 'PENDING' | 'SENT' | 'FAILED';

/** Serveur SMTP en vigueur (sans mot de passe) et état de la file d'envoi. */
export type MailConfig = {
  /** smtp, ou API HTTPS quand l'hébergeur bloque les ports SMTP. */
  transport: 'smtp' | 'gmail-api' | 'brevo';
  /** Réglages manquants pour l'API choisie. */
  missing: string[];
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
  auth: boolean;
  user: string | null;
  passwordSet: boolean;
  from: string;
  fromName: string;
  replyTo: string | null;
  appUrl: string;
  devCapture: boolean;
  pending: number;
  sent: number;
  failed: number;
};

export type AuditEntry = {
  id: string;
  action: string;
  target: string;
  before: string | null;
  after: string | null;
  reason: string | null;
  createdAt: string;
  who: string;
  /** Acteur principal de l'auteur (président, agent, entraîneur…). */
  role: Actor | null;
  roles: Actor[];
};

export type SeasonLite = { id: string; label: string; status: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'HISTORICAL' };

export type Settings = { nightStartHour: number; cancelDelayHours: number; openingHour: number; closingHour: number };

export type PlayerProfile = Player & {
  season: { id: string; label: string };
  groups: { id: string; name: string; slots: Slot[] }[];
  paymentPlan: PaymentPlan | null;
  installments: { id: string; number: number; count: number; dueDate: string; amount: number; paid: number; remaining: number; status: InstallmentStatus }[];
  absences: { id: string; date: string; group: string; startTime: string; reason: string }[];
  attendanceCount: number;
};

export type CoachProfile = Omit<Coach, 'groups' | 'sessionsPerWeek'> & {
  slots: (Slot & { group: { id: string; name: string } })[];
  salaries: Salary[];
  estimate: Estimate;
  absences: { id: string; date: string; reason: string; status: CoachAbsence['status']; slot: { startTime: string; group: string } | null }[];
};

export type ParentProfile = Omit<Parent, 'players'> & {
  children: { id: string; photoUrl?: string | null; firstName: string; lastName: string; birthDate: string; archivedAt: string | null; category: string | null; groups: { id: string; name: string; slots: Slot[] }[] }[];
};

export type StaffProfile = Staff & { salaries: Salary[] };


// ───── Import des joueurs (Excel) ─────

export type ImportStatus = 'ok' | 'warning' | 'error';

export type ImportRow = {
  line: number;
  n: number | null;
  name: string;
  nameAr: string | null;
  gender: 'M' | 'F' | null;
  birthDate: string | null;
  birthYearOnly: boolean;
  age: number | null;
  phone: string | null;
  notes: string | null;
  city: string | null;
  parents: { key: string; name: string; phone: string | null; existingId: string | null }[];
  groupLabel: string | null;
  group: { id: string; name: string } | null;
  category: { id: string; code: string; name: string } | null;
  derogation: boolean;
  status: ImportStatus;
  messages: string[];
};

export type ImportPreview = {
  fileName: string;
  season: string;
  codeYear: number;
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  newParents: number;
  withGroup: number;
  groups: string[];
  rows: ImportRow[];
};

export type ImportReport = {
  imported: { line: number; n: number | null; name: string; memberCode: string; group: string | null; category: string | null; parents: string[]; messages: string[]; membership: boolean }[];
  parentsCreated: number;
  /** Joueurs inscrits sans tarif pour leur catégorie : cotisation à créer plus tard. */
  withoutFee: number;
  skipped: { line: number; n: number | null; name: string; messages: string[] }[];
};

type CodeChange = { id: string; name: string; before: string | null; year: number; seq: number; after: string };
export type MemberCodePlan = { provisional: number; definitive: number; changes: CodeChange[]; plan: CodeChange[] };

// ───── Fiche d'un groupe ─────

type GroupDetailMember = Group['members'][number] & {
  photoUrl?: string | null;
  memberCode: string | null;
  age: number | null;
  gender: 'M' | 'F' | null;
  phone: string | null;
  parents: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null }[];
  attendance: { sessions: number; present: number; absent: number; rate: number | null };
};

export type GroupDetail = Omit<Group, 'members'> & {
  season: { id: string; label: string; status: string };
  places: number;
  attendanceRate: number | null;
  members: GroupDetailMember[];
  recentSessions: { date: string; present: number; late: number; absent: number }[];
  candidates: {
    playerId: string;
    memberCode: string | null;
    firstName: string;
    lastName: string;
    age: number | null;
    category: { id: string; name: string };
    sameCategory: boolean;
  }[];
};

// ───── Notifications et compte fédération ─────

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  /** Message envoyé par le club (administration). */
  broadcastId: string | null;
};

export type BroadcastTarget = 'PARENTS' | 'PLAYERS' | 'COACHES' | 'ALL' | 'GROUP' | 'USERS';

export type Broadcast = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  audience: string;
  recipients: number;
  read: number;
  byEmail: boolean;
  createdAt: string;
  sender: string;
};

export type Recipient = { id: string; name: string; roles: ('PARENT' | 'PLAYER' | 'COACH')[]; players: string[] };

export type FederationAccount = { login: string | null; hasPassword: boolean };

// ───── Mises à jour par fichier (groupes, paiements du cahier) ─────

type UpdateStatus = 'ok' | 'warning' | 'error';
type UpdatePlayer = { id: string; name: string; memberCode: string | null } | null;

export type GroupUpdatePreview = {
  fileName: string;
  season: string;
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  corrections: number;
  moves: number;
  groups: string[];
  rows: {
    line: number;
    groupLabel: string | null;
    name: string;
    group: { id: string; name: string } | null;
    player: UpdatePlayer;
    correction: { from: string; to: string } | null;
    action: 'add' | 'move' | 'none';
    from: string | null;
    status: UpdateStatus;
    messages: string[];
  }[];
};

export type PaymentUpdatePreview = {
  fileName: string;
  season: string;
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  amount: number;
  rows: {
    line: number;
    name: string;
    nameAr: string | null;
    player: UpdatePlayer;
    base: number | null;
    due: number | null;
    alreadyPaid: number;
    paid: number | null;
    method: 'CASH' | 'CHEQUE';
    receipt: number | null;
    date: string;
    status: UpdateStatus;
    messages: string[];
  }[];
};
