/** Types du module Projets et budget (API `projects`, `budget`). */
export type ProjectStatus = 'IDEA' | 'QUOTES' | 'APPROVED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export type Project = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  categoryLabel: string;
  status: ProjectStatus;
  statusLabel: string;
  priority: number;
  estimatedAmount: number | null;
  targetDate: string | null;
  seasonId: string | null;
  seasonLabel: string | null;
  responsibleId: string | null;
  responsible: string | null;
  quotes: number;
  minQuote: number | null;
  maxQuote: number | null;
  chosenQuote: { id: string; supplier: string; amount: number } | null;
  decisionReason: string | null;
  decidedAt: string | null;
  budget: number | null;
  spent: number;
  committed: number;
  archivedAt: string | null;
  archiveReason: string | null;
  version: number;
};

export type ProjectList = {
  projects: Project[];
  totals: { approved: number; spent: number; ideas: number };
  categories: { key: string; label: string }[];
  people: { id: string; name: string }[];
  seasons: { id: string; label: string }[];
};

export type Quote = {
  id: string;
  supplier: string;
  amount: number;
  delayDays: number | null;
  validUntil: string | null;
  expired: boolean;
  note: string | null;
  fileName: string | null;
  archived: boolean;
  cheapest: boolean;
  fastest: boolean;
  gap: number | null;
  chosen: boolean;
};

export type LinkedExpense = { id: string; label: string; supplier: string | null; amount: number; date: string; paidAt: string | null };

export type ProjectDetail = Project & { quotes: Quote[]; expenses: LinkedExpense[]; candidates: LinkedExpense[] };

export type BudgetRow = { category: string; planned: number | null; note: string | null; actual: number; previous: number | null };

export type Budget = {
  season: { id: string; label: string; status: string; startDate: string; endDate: string };
  previous: { id: string; label: string } | null;
  locked: boolean;
  income: BudgetRow[];
  expenses: BudgetRow[];
  projects: { id: string; title: string; status: ProjectStatus; planned: number; actual: number }[];
  totals: { plannedIncome: number; plannedExpenses: number; plannedResult: number; actualIncome: number; actualExpenses: number; actualResult: number };
  updatedAt: string | null;
};

export type Forecast = {
  balance: { amount: number; date: string; note: string | null; updatedAt: string | null } | null;
  estimated: number | null;
  since: { received: number; paid: number } | null;
  late: 'include' | 'half' | 'exclude';
  lateTotal: number;
  months: { month: string; in: number; out: number; balance: number; items: { label: string; amount: number; kind: 'in' | 'out'; late?: boolean }[] }[];
  firstNegative: string | null;
  lowest: { month: string; balance: number } | null;
};

export const STATUS_TONE: Record<ProjectStatus, 'b' | 'g' | 'r' | 's'> = {
  IDEA: 's',
  QUOTES: 'b',
  APPROVED: 'g',
  IN_PROGRESS: 'g',
  DONE: 'g',
  CANCELLED: 'r',
};

export const PRIORITY: Record<number, string> = { 1: 'Priorité haute', 2: 'Priorité normale', 3: 'Priorité basse' };

export const POST_LABEL: Record<string, string> = {
  FEES: 'Cotisations des joueurs',
  COURTS: 'Réservations de terrains',
  TOURNAMENTS: 'Inscriptions aux tournois',
  DONATION: 'Dons',
  GRANT: 'Subventions',
  RENTAL: 'Locations',
  OTHER: 'Autres',
  SALARY: 'Salaires des entraîneurs',
  UTILITIES: 'Factures (STEG, SONEDE, internet)',
  EQUIPMENT: 'Matériel',
  MAINTENANCE: 'Entretien',
  TAX: 'Déclarations fiscales',
  SOCIAL: 'CNSS',
  INSURANCE: 'Assurances',
  FEDERATION: 'Fédération',
  TRAVEL: 'Déplacements',
  SERVICES: 'Prestataires',
};

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
