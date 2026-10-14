export type TournamentStatus = 'DRAFT' | 'REGISTRATION' | 'RUNNING' | 'FINISHED' | 'CANCELLED';
export type TournamentFormat = 'KNOCKOUT' | 'ROUND_ROBIN';
export type Eligibility = { mode: 'cats' | 'age' | 'open'; categoryIds?: string[]; fromYear?: number | null; toYear?: number | null; gender?: 'M' | 'F' | null };

export type TournamentBase = {
  id: string;
  name: string;
  kind: 'INTERNAL' | 'OPEN' | 'CHAMPIONSHIP' | 'INTERCLUB';
  kindLabel: string;
  startDate: string;
  endDate: string;
  eligibility: Eligibility;
  eligibilityLabel: string;
  format: TournamentFormat;
  maxPlayers: number;
  fee: number | null;
  familyRequest: boolean;
  setsToWin: number;
  games: number;
  tiebreak: boolean;
  superTB: boolean;
  noAd: boolean;
  courtIds: string[];
  dayStart: string;
  dayEnd: string;
  matchMinutes: number;
  restMinutes: number;
  status: TournamentStatus;
  winnerName: string | null;
  notes: string | null;
  version: number;
};

export type TournamentSummary = TournamentBase & { entries: number };

export type TMatch = {
  id: string;
  round: number;
  position: number;
  roundLabel: string;
  playerA: { id: string | null; name: string };
  playerB: { id: string | null; name: string };
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'ABANDONED';
  winner: 0 | 1 | null;
  score: string | null;
  court: string | null;
  scheduledAt: string | null;
  ready: boolean;
};

export type TEntry = {
  id: string;
  playerId: string | null;
  name: string;
  seed: number | null;
  status: 'CONFIRMED' | 'PENDING' | 'WITHDRAWN';
  derogationReason: string | null;
  code: string | null;
  level: string | null;
  category: string | null;
  mine: boolean;
};

export type TournamentDetail = TournamentBase & {
  canManage: boolean;
  courts: { id: string; name: string }[];
  entries: TEntry[];
  rounds: number;
  matches: TMatch[];
  standings: { name: string; playerId: string | null; played: number; wins: number; losses: number; setsFor: number; setsAgainst: number }[];
  myPlayers: string[];
};

export type Conflict = {
  slotId: string;
  date: string;
  dayLabel: string;
  group: string;
  startTime: string;
  endTime: string;
  court: string;
  coaches: string[];
  change: { kind: 'MOVED' | 'POSTPONED'; court: string | null; reason: string } | null;
  freeCourt: { id: string; name: string } | null;
};

export type History = {
  tournaments: {
    tournamentId: string;
    name: string;
    date: string;
    status: TournamentStatus;
    result: string;
    wins: number;
    losses: number;
    matches: { id: string; round: string; opponent: string; score: string | null; status: string; won: boolean | null }[];
  }[];
  totals: { played: number; titles: number; finals: number; wins: number; losses: number };
};

export const STATUS: Record<TournamentStatus, { label: string; tone: 'b' | 'g' | 'r' | 's' }> = {
  DRAFT: { label: 'Brouillon', tone: 's' },
  REGISTRATION: { label: 'Inscriptions ouvertes', tone: 'b' },
  RUNNING: { label: 'En cours', tone: 'r' },
  FINISHED: { label: 'Terminé', tone: 'g' },
  CANCELLED: { label: 'Annulé', tone: 's' },
};
