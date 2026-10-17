import type { TEntry, TMatch, TournamentDetail } from './types';

/** Ordre des têtes de série dans un tableau (même calcul que le tirage de l'API). */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((x) => [x, n + 1 - x]);
  }
  return order.slice(0, size);
}

const TBD = 'À déterminer';
export const known = (name: string | null | undefined) => Boolean(name && !name.startsWith(TBD));

const DAYS = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
const DAYS_LOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function tunisParts(iso: string) {
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Tunis', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Africa/Tunis' })).getDay();
  return { wd, day: get('day'), month: get('month'), hour: String(Number(get('hour'))), minute: get('minute') };
}

/** « SAM 9H », « DIM 10H30 » (tableau). */
export function shortSlot(iso: string) {
  const p = tunisParts(iso);
  return `${DAYS[p.wd]} ${p.hour}H${p.minute === '00' ? '' : p.minute}`;
}

/** « Dim 23/08 à 17h30 » (poule). */
export function longSlot(iso: string) {
  const p = tunisParts(iso);
  return `${DAYS_LOW[p.wd]} ${p.day}/${p.month} à ${p.hour}h${p.minute === '00' ? '' : p.minute}`;
}

/** « Du 18 au 26 juillet 2026 ». */
export function dateRange(from: string, to: string) {
  const f = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...o }).format(new Date(`${iso}T00:00:00Z`));
  if (from === to) return f(from, { day: 'numeric', month: 'long', year: 'numeric' });
  return `Du ${f(from, { day: 'numeric' })} au ${f(to, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

type SetScore = { a: number; b: number; superTB: boolean };

/** Sets d'un score « 6-3 7-6(4) 10-7 » (du point de vue du joueur A) ; le super tie-break compte pour un jeu. */
export function parseScore(score: string | null, t: Pick<TournamentDetail, 'superTB' | 'setsToWin'>): SetScore[] | null {
  if (!score || /forfait/i.test(score)) return null;
  const sets = score
    .replace(/\//g, ' ')
    .split(/\s+/)
    .map((s) => s.replace(/\(.*\)/, '').match(/^(\d+)-(\d+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ a: Number(m[1]), b: Number(m[2]), superTB: false }));
  const last = t.setsToWin * 2 - 2;
  sets.forEach((s, i) => {
    if (t.superTB && i === last && Math.max(s.a, s.b) >= 10) s.superTB = true;
  });
  return sets;
}

/** Score affiché du point de vue du vainqueur : « 6-1/6-0 », « 4-6/7-5/10-7 », « WO », « … ab ». */
export function winnerScore(m: TMatch, t: Pick<TournamentDetail, 'superTB' | 'setsToWin'>) {
  if (m.score && /forfait/i.test(m.score)) return 'WO';
  const sets = parseScore(m.score, t);
  if (!sets?.length) return m.status === 'ABANDONED' ? 'ab' : '';
  const flip = m.winner === 1;
  const text = sets.map((s) => (flip ? `${s.b}-${s.a}` : `${s.a}-${s.b}`)).join('/');
  return m.status === 'ABANDONED' ? `${text} ab` : text;
}

const done = (m: TMatch) => (m.status === 'FINISHED' || m.status === 'ABANDONED') && (m.winner === 0 || m.winner === 1);

export type Standing = { name: string; pts: number; g: number; p: number; sg: number; sp: number; jg: number; jp: number };

/**
 * Classement d'une poule (barème des feuilles du club) : victoire 2 points, défaite 1 point (0 sur forfait) ;
 * sets gagnés / perdus (super tie-break non compté comme set), jeux (super tie-break = 1 jeu) ;
 * égalité : confrontation directe entre deux joueurs, puis % de sets, puis % de jeux.
 */
export function standings(t: TournamentDetail, names: string[]): Standing[] {
  const rows = new Map(names.map((n) => [n, { name: n, pts: 0, g: 0, p: 0, sg: 0, sp: 0, jg: 0, jp: 0 }]));
  const duel = new Map<string, string>(); // « A|B » → vainqueur
  for (const m of t.matches.filter(done)) {
    const side = [rows.get(m.playerA.name), rows.get(m.playerB.name)];
    const wo = Boolean(m.score && /forfait/i.test(m.score));
    const sets = parseScore(m.score, t) ?? [];
    side.forEach((r, i) => {
      if (!r) return;
      const won = m.winner === i;
      if (won) r.g++;
      else r.p++;
      r.pts += won ? 2 : wo ? 0 : 1;
      for (const s of sets) {
        const mine = i === 0 ? s.a : s.b;
        const other = i === 0 ? s.b : s.a;
        if (s.superTB) {
          if (mine > other) r.jg++;
          else r.jp++;
        } else {
          r.jg += mine;
          r.jp += other;
          if (mine > other) r.sg++;
          else if (other > mine) r.sp++;
        }
      }
    });
    const winner = m.winner === 0 ? m.playerA.name : m.playerB.name;
    duel.set([m.playerA.name, m.playerB.name].sort().join('|'), winner);
  }
  const pct = (a: number, b: number) => (a + b ? a / (a + b) : 0);
  return [...rows.values()].sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    const tied = [...rows.values()].filter((r) => r.pts === x.pts);
    if (tied.length === 2) {
      const w = duel.get([x.name, y.name].sort().join('|'));
      if (w) return w === x.name ? -1 : 1;
    }
    return pct(y.sg, y.sp) - pct(x.sg, x.sp) || pct(y.jg, y.jp) - pct(x.jg, x.jp) || x.name.localeCompare(y.name, 'fr');
  });
}

export const percent = (a: number, b: number) => `${a + b ? Math.round((100 * a) / (a + b)) : 0}%`;

/** Lignes du tableau (1 à taille) : joueur ou exempt (« BYE »), d'après les matchs du 1er tour et les têtes de série. */
export function bracketLines(t: TournamentDetail): (TEntry | { bye: true } | null)[] {
  const size = 2 ** t.rounds;
  const byName = new Map(t.entries.map((e) => [e.name, e]));
  const entry = (name: string | null | undefined) => (name && known(name) ? (byName.get(name) ?? ({ name } as TEntry)) : null);
  const order = seedOrder(size);
  const lines: (TEntry | { bye: true } | null)[] = Array(size).fill(null);
  for (let p = 0; p < size / 2; p++) {
    const m = t.matches.find((x) => x.round === 1 && x.position === p);
    if (m) {
      lines[2 * p] = entry(m.playerA.name);
      lines[2 * p + 1] = entry(m.playerB.name);
      continue;
    }
    // Exempt : le joueur seul est déjà placé au 2e tour.
    const next = t.matches.find((x) => x.round === 2 && x.position === Math.floor(p / 2));
    const player = entry(p % 2 ? next?.playerB.name : next?.playerA.name);
    // Le joueur occupe la place de la meilleure tête de série de la paire, l'exempt l'autre.
    const playerFirst = order[2 * p] < order[2 * p + 1];
    lines[2 * p] = playerFirst ? player : { bye: true };
    lines[2 * p + 1] = playerFirst ? { bye: true } : player;
  }
  return lines;
}

/**
 * NOM, Prénom et Club d'un inscrit : joueur du club (fiche), sinon nom saisi « Prénom NOM (CLUB) » :
 * mots en majuscules = nom, club entre parenthèses.
 */
export function nameParts(e: Pick<TEntry, 'name' | 'firstName' | 'lastName'>): { last: string; first: string; club: string | null } {
  if (e.lastName) return { last: e.lastName.toUpperCase(), first: e.firstName ?? '', club: null };
  const m = e.name.trim().match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const text = (m ? m[1] : e.name).trim();
  const club = m ? m[2].trim().toUpperCase() : null;
  const words = text.split(/\s+/);
  const upper = words.filter((w) => w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w));
  if (upper.length && upper.length < words.length) {
    return { last: upper.join(' '), first: words.filter((w) => !upper.includes(w)).join(' '), club };
  }
  return { last: text.toUpperCase(), first: '', club };
}
