export type Side = 0 | 1;
export type MatchStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'ABANDONED';
export type PointKind = 'NONE' | 'ACE' | 'DF' | 'WINNER' | 'UNFORCED' | 'FORCED';
export type MatchFormat = { setsToWin: number; games: number; tiebreak: boolean; superTB: boolean; noAd: boolean };

export type MatchSummary = {
  id: string;
  kind: 'INTERNAL' | 'FRIENDLY' | 'TOURNAMENT';
  kindLabel: string;
  title: string | null;
  date: string;
  court: string | null;
  playerA: { id: string | null; name: string };
  playerB: { id: string | null; name: string };
  format: MatchFormat;
  status: MatchStatus;
  winner: Side | null;
  score: string | null;
  live: { point: [string, string]; server: Side; tiebreak: 'TB' | 'SUPER' | null } | null;
  endReason: string | null;
  /** Tournoi : résultat réservé aux concernés (private) ou affiché à la fin du match (after). */
  hidden?: 'private' | 'after' | null;
  referee?: { userId: string | null; name: string | null } | null;
};

type Ratio = [number, number];
export type PlayerStats = {
  aces: number;
  doubleFaults: number;
  firstServeIn: Ratio;
  firstServeWon: Ratio;
  secondServeWon: Ratio;
  breakPointsSaved: Ratio;
  returnFirstWon: Ratio;
  returnSecondWon: Ratio;
  breakPointsWon: Ratio;
  pointsWon: number;
  winners: number;
  unforcedErrors: number;
  forcedErrors?: number;
  longestStreak: number;
};

export type AnnotatedPoint = {
  seq: number;
  winner: Side;
  firstIn: boolean;
  kind: PointKind;
  shot: string | null;
  server: Side;
  set: number;
  game: string;
  bp: boolean;
};

export type MatchDetail = MatchSummary & {
  scorer: string;
  canScore: boolean;
  state: {
    sets: { games: [number, number]; tiebreak: [number, number] | null }[];
    setsWon: [number, number];
    point: [string, string];
    server: Side;
    tiebreak: 'TB' | 'SUPER' | null;
    breakPoint: boolean;
    decisivePoint: boolean;
  } | null;
  stats: { all: [PlayerStats, PlayerStats]; sets: { set: number; stats: [PlayerStats, PlayerStats] }[] } | null;
  points: AnnotatedPoint[];
  /** Durées en secondes (d'après l'heure de saisie des points). */
  timing?: {
    match: number;
    sets: { set: number; seconds: number }[];
    averagePoint: number | null;
    longestPoint: { seconds: number; seq: number; set: number; game: string } | null;
  } | null;
};

/** 3 725 s → « 1 h 02 », 95 s → « 1 min 35 s », 42 s → « 42 s ». */
export function duration(sec: number): string {
  if (sec >= 3600) return `${Math.floor(sec / 3600)} h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`;
  if (sec >= 60) return `${Math.floor(sec / 60)} min${sec % 60 && sec < 600 ? ` ${sec % 60} s` : ''}`;
  return `${sec} s`;
}

export const first = (name: string) => name.split(' ')[0];
