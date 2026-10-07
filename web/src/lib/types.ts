/** Types des réponses de l'API (miroir des contrôleurs NestJS). */

export type Role = 'ADMIN' | 'COACH' | 'PARENT' | 'PLAYER';

export type PersonRef = { id: string; firstName: string; lastName: string };

export type Me = {
  id: string;
  email: string;
  role: Role;
  firstName: string;
  lastName: string;
  mustChangePassword: boolean;
  playerId: string | null;
  coachId: string | null;
  players: PersonRef[];
};

export type Category = {
  id: string;
  code: string;
  name: string;
  family: 'YOUTH' | 'ADULT' | 'VETERAN' | 'CORPORATE' | 'PADEL';
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
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: 'M' | 'F';
  email: string | null;
  phone: string | null;
  hasAccount: boolean;
  archivedAt: string | null;
  version: number;
  age: number;
  minor: boolean;
  category: { id: string; code: string; name: string } | null;
  derogationReason: string | null;
  group: { id: string; name: string } | null;
  parents: (PersonRef & { email: string })[];
};

export type Parent = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  version: number;
  players: PersonRef[];
};

export type Coach = {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  payMode: string | null;
  version: number;
  groups: { id: string; name: string }[];
};

export type Court = {
  id: string;
  name: string;
  surface: string;
  lit: boolean;
  active: boolean;
  maintenance: boolean;
  version: number;
  futureReservations: number;
};

export type Group = {
  id: string;
  seasonId: string;
  name: string;
  days: number[];
  startTime: string;
  endTime: string;
  capacity: number;
  version: number;
  category: { id: string; name: string; code: string };
  coach: { id: string; firstName: string; lastName: string } | null;
  court: { id: string; name: string } | null;
  members: { playerId: string; firstName: string; lastName: string; category: string; derogationReason: string | null }[];
};

export type Fee = {
  id: string;
  amount: number;
  installmentsCount: number;
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
};

export type SlotState = 'free' | 'mine' | 'taken' | 'group' | 'maintenance' | 'unlit' | 'past';

export type Grid = {
  date: string;
  hours: number[];
  nightStartHour: number;
  courts: { id: string; name: string; lit: boolean; maintenance: boolean; active: boolean }[];
  slots: { courtId: string; hours: { hour: number; state: SlotState }[] }[];
};

export type Reservation = {
  id: string;
  date: string;
  hour: number;
  startTime: string;
  type: 'LEISURE' | 'PRIVATE';
  price: number;
  court: { id: string; name: string };
  player: PersonRef | null;
  coach: { id: string; firstName: string; lastName: string } | null;
  bookedBy: string | null;
};

export type Salary = {
  id: string;
  period: string;
  amount: number;
  paidAt: string | null;
  paid: boolean;
  version: number;
  coach: { id: string; firstName: string; lastName: string };
  season: { id: string; label: string; status: string };
};

export type CoachSession = {
  groupId: string;
  groupName: string;
  date: string;
  startTime: string;
  endTime: string;
  court: { id: string; name: string } | null;
  category: { id: string; name: string };
  membersCount: number;
  capacity: number;
  started: boolean;
  recorded: boolean;
};

export type PlayerSession = {
  groupId: string;
  groupName: string;
  date: string;
  startTime: string;
  endTime: string;
  court: { id: string; name: string } | null;
  coach: { firstName: string; lastName: string } | null;
  past: boolean;
  attendance: 'PRESENT' | 'ABSENT' | null;
};

export type AttendanceSheet = {
  group: { id: string; name: string; startTime: string; endTime: string };
  date: string;
  entries: { playerId: string; firstName: string; lastName: string; present: boolean | null; reason: string | null }[];
};

export type Absence = { id: string; date: string; group: { id: string; name: string; startTime: string; endTime: string }; reason: string };

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
    coach: { firstName: string; lastName: string } | null;
  } | null;
  hasGroup: boolean;
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
  status: 'SENT' | 'FAILED';
  error: string | null;
  createdAt: string;
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
};

export type SeasonLite = { id: string; label: string; status: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'HISTORICAL' };

export type Settings = { nightStartHour: number; cancelDelayHours: number; openingHour: number; closingHour: number };
