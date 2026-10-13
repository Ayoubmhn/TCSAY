/**
 * Moteur de score de tennis : tout est recalculé depuis la liste des points (annuler = retirer le dernier).
 * Gère 2 ou 3 sets gagnants, sets de 6 ou 4 jeux, tie-break à égalité, super tie-break à 10 au dernier set,
 * point décisif à 40-40, alternance du service (y compris en tie-break) et balles de break.
 */

export type Side = 0 | 1;
export type PointKind = 'NONE' | 'ACE' | 'DF' | 'WINNER' | 'UNFORCED' | 'FORCED';

export type MatchFormat = { setsToWin: number; games: number; tiebreak: boolean; superTB: boolean; noAd: boolean };

/** Point saisi : qui le gagne, 1re balle bonne ou non, comment (facultatif), coup (facultatif). */
export type PointInput = { winner: Side; firstIn: boolean; kind: PointKind; shot?: string | null };

/** Point annoté par le moteur : serveur, set, jeu, balle de break, score avant le point. */
export type AnnotatedPoint = PointInput & { seq: number; server: Side; set: number; game: string; bp: boolean; before: [string, string] };

export type SetScore = { games: [number, number]; tiebreak: [number, number] | null };

export type MatchState = {
  sets: SetScore[];
  setsWon: [number, number];
  /** Points du jeu en cours (« 15 », « AV »…) ou du tie-break. */
  point: [string, string];
  server: Side;
  tiebreak: null | 'TB' | 'SUPER';
  winner: Side | null;
  breakPoint: boolean;
  decisivePoint: boolean;
  points: AnnotatedPoint[];
};

const LABELS = ['0', '15', '30', '40'];

export function computeMatch(format: MatchFormat, firstServer: Side, input: PointInput[]): MatchState {
  const sets: SetScore[] = [{ games: [0, 0], tiebreak: null }];
  const setsWon: [number, number] = [0, 0];
  let pts: [number, number] = [0, 0];
  let server: Side = firstServer;
  let tb: { p: [number, number]; start: Side; target: number; superTB: boolean } | null = null;
  let winner: Side | null = null;
  const points: AnnotatedPoint[] = [];

  const other = (s: Side): Side => (s === 0 ? 1 : 0);
  const label = (): [string, string] => {
    if (tb) return [String(tb.p[0]), String(tb.p[1])];
    const [a, b] = pts;
    if (a >= 3 && b >= 3) {
      if (a === b) return ['40', '40'];
      return a > b ? ['AV', ''] : ['', 'AV'];
    }
    return [LABELS[Math.min(a, 3)], LABELS[Math.min(b, 3)]];
  };
  const isBreakPoint = () => {
    if (tb) return false;
    const r = other(server);
    return pts[r] >= 3 && (pts[r] > pts[server] || (format.noAd && pts[r] === 3 && pts[server] === 3));
  };
  const startSuperIfNeeded = () => {
    if (format.superTB && setsWon[0] === format.setsToWin - 1 && setsWon[1] === format.setsToWin - 1) {
      tb = { p: [0, 0], start: server, target: 10, superTB: true };
    }
  };

  input.forEach((p, seq) => {
    if (winner !== null) return;
    const set = sets.length - 1;
    const game = tb ? (tb.superTB ? 'Super tie-break' : 'Tie-break') : `Jeu ${sets[set].games[0] + sets[set].games[1] + 1}`;
    points.push({ ...p, seq, server, set, game, bp: isBreakPoint(), before: label() });
    const w = p.winner;
    const o = other(w);

    if (tb) {
      tb.p[w]++;
      const n = tb.p[0] + tb.p[1];
      if (tb.p[w] >= tb.target && tb.p[w] - tb.p[o] >= 2) {
        sets[set].tiebreak = [tb.p[0], tb.p[1]];
        if (tb.superTB) sets[set].games = w === 0 ? [1, 0] : [0, 1];
        else sets[set].games[w]++;
        setsWon[w]++;
        server = other(tb.start);
        tb = null;
        if (setsWon[w] === format.setsToWin) {
          winner = w;
          return;
        }
        sets.push({ games: [0, 0], tiebreak: null });
        startSuperIfNeeded();
      } else {
        // 1er point servi par le serveur désigné, ensuite alternance tous les 2 points.
        server = Math.floor((n + 1) / 2) % 2 === 0 ? tb.start : other(tb.start);
      }
      return;
    }

    pts[w]++;
    const gameWon = pts[w] >= 4 && (pts[w] - pts[o] >= 2 || (format.noAd && pts[o] <= 3));
    if (!gameWon) return;
    pts = [0, 0];
    const g = sets[set].games;
    g[w]++;
    server = other(server);
    if (g[w] >= format.games && g[w] - g[o] >= 2) {
      setsWon[w]++;
      if (setsWon[w] === format.setsToWin) {
        winner = w;
        return;
      }
      sets.push({ games: [0, 0], tiebreak: null });
      startSuperIfNeeded();
    } else if (format.tiebreak && g[0] === format.games && g[1] === format.games) {
      tb = { p: [0, 0], start: server, target: 7, superTB: false };
    }
  });

  const tbNow = tb as { superTB: boolean } | null;
  return {
    sets,
    setsWon,
    point: label(),
    server,
    tiebreak: tbNow ? (tbNow.superTB ? 'SUPER' : 'TB') : null,
    winner,
    breakPoint: winner === null && isBreakPoint(),
    decisivePoint: winner === null && !tb && format.noAd && pts[0] === 3 && pts[1] === 3,
    points,
  };
}

/** Score lisible : « 6-3 7-6(4) ». */
export function scoreLine(state: MatchState): string {
  return state.sets
    .filter((s) => s.games[0] + s.games[1] > 0 || s.tiebreak)
    .map((s) => `${s.games[0]}-${s.games[1]}${s.tiebreak ? `(${Math.min(...s.tiebreak)})` : ''}`)
    .join(' ');
}

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
  longestStreak: number;
};

/** Statistiques des deux joueurs, sur tout le match ou sur un set. */
export function matchStats(points: AnnotatedPoint[], set?: number): [PlayerStats, PlayerStats] {
  const P = set === undefined ? points : points.filter((p) => p.set === set);
  const one = (i: Side): PlayerStats => {
    const served = P.filter((p) => p.server === i);
    const ret = P.filter((p) => p.server !== i);
    const won = (arr: AnnotatedPoint[]) => arr.filter((p) => p.winner === i).length;
    const ratio = (arr: AnnotatedPoint[]): Ratio => [won(arr), arr.length];
    const firstIn = served.filter((p) => p.firstIn);
    let streak = 0;
    let best = 0;
    for (const p of P) {
      streak = p.winner === i ? streak + 1 : 0;
      best = Math.max(best, streak);
    }
    return {
      aces: served.filter((p) => p.kind === 'ACE').length,
      doubleFaults: served.filter((p) => p.kind === 'DF').length,
      firstServeIn: [firstIn.length, served.length],
      firstServeWon: ratio(firstIn),
      secondServeWon: ratio(served.filter((p) => !p.firstIn)),
      breakPointsSaved: ratio(served.filter((p) => p.bp)),
      returnFirstWon: ratio(ret.filter((p) => p.firstIn)),
      returnSecondWon: ratio(ret.filter((p) => !p.firstIn)),
      breakPointsWon: ratio(ret.filter((p) => p.bp)),
      pointsWon: won(P),
      winners: P.filter((p) => p.winner === i && (p.kind === 'WINNER' || p.kind === 'ACE')).length,
      unforcedErrors: P.filter((p) => p.winner !== i && p.kind === 'UNFORCED').length,
      longestStreak: best,
    };
  };
  return [one(0), one(1)];
}
