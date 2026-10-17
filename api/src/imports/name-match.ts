/**
 * Reconnaissance approximative des noms (fautes d'orthographe, ordre prénom / nom inversé, majuscules, accents,
 * « Ben Regaya » / « Benregaya ») en français et en arabe, sans bibliothèque.
 */

const AR = /[؀-ۿ]/;

/** Français : minuscules, sans accents ; arabe : sans voyelles ni tatouil, alif / ya / ta marbouta unifiés. */
export function normalizeName(s: string): string {
  if (AR.test(s)) {
    return s
      .replace(/[ً-ْٰـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/[^؀-ۿ\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const isArabic = (s: string) => AR.test(s);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Similarité 0 → 1 de deux chaînes. */
export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** Mots d'un nom, plus les paires de mots voisins collées (« ben regaya » ↔ « benregaya »). */
function variants(tokens: string[]): string[][] {
  const out = [tokens];
  for (let i = 0; i < tokens.length - 1; i++) out.push([...tokens.slice(0, i), tokens[i] + tokens[i + 1], ...tokens.slice(i + 2)]);
  return out;
}

/**
 * Ressemblance de deux noms complets (0 → 1) : chaque mot du nom cherché doit ressembler à un mot de l'autre nom
 * (ordre libre, mots collés ou séparés). Le score est la moyenne ; `weakest` est le mot le moins ressemblant :
 * un prénom différent (« Zeineb » / « Yazid ») suffit à écarter la correspondance.
 */
export function nameMatch(query: string, target: string): { score: number; weakest: number } {
  const ta = normalizeName(query).split(' ').filter(Boolean);
  const tb = normalizeName(target).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return { score: 0, weakest: 0 };
  let best = { score: 0, weakest: 0 };
  // Collage de deux mots voisins d'un seul côté, et seulement s'il aligne le nombre de mots
  // (« Ben Regaya » ↔ « Benregaya ») : jamais tout le nom en un seul mot (« Zeineb Jaballah » ≠ « Yazid Jaballah »).
  const pairs: [string[], string[]][] = [[ta, tb]];
  for (const qa of variants(ta).slice(1)) if (qa.length === tb.length) pairs.push([qa, tb]);
  for (const qb of variants(tb).slice(1)) if (qb.length === ta.length) pairs.push([ta, qb]);
  // Collage des deux côtés (« HAJ AMOR » ↔ « ElHaj Omar ») seulement s'il reste au moins deux mots.
  for (const qa of variants(ta).slice(1)) for (const qb of variants(tb).slice(1)) if (qa.length === qb.length && qa.length >= 2) pairs.push([qa, qb]);
  for (const [qa, qb] of pairs) {
    {
      const sims = qa.map((w) => Math.max(...qb.map((v) => similarity(w, v))));
      const score = sims.reduce((t, x) => t + x, 0) / sims.length;
      const weakest = Math.min(...sims);
      if (weakest > best.weakest || (weakest === best.weakest && score > best.score)) best = { score, weakest };
    }
  }
  return best;
}

/** Score unique pour comparer des candidats : le mot le moins ressemblant compte double. */
export const nameScore = (a: string, b: string) => {
  const m = nameMatch(a, b);
  return (m.score + 2 * m.weakest) / 3;
};

export type Candidate<T> = { item: T; names: string[] };

/** Meilleure correspondance : score, et second score (pour repérer les homonymes possibles). */
export function bestMatch<T>(query: string, candidates: Candidate<T>[]) {
  let best: { item: T; score: number } | null = null;
  let second = 0;
  for (const c of candidates) {
    const score = Math.max(0, ...c.names.filter(Boolean).map((n) => nameScore(query, n)));
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { item: c.item, score };
    } else if (score > second) second = score;
  }
  return best ? { ...best, second } : null;
}

/**
 * « LAOUANI Bayrem » / « Ferdaous MADHI » : le mot en MAJUSCULES est le nom de famille. Sans majuscules
 * (« Malek Heni ») : prénom puis nom.
 */
export function splitListName(raw: string): { firstName: string; lastName: string } {
  const words = raw.trim().split(/\s+/);
  const isUpper = (w: string) => w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const last = words.filter(isUpper);
  if (last.length && last.length < words.length) {
    return { firstName: words.filter((w) => !isUpper(w)).join(' '), lastName: last.map(cap).join(' ') };
  }
  return { firstName: cap(words[0] ?? ''), lastName: words.slice(1).map((w) => (isUpper(w) ? cap(w) : w)).join(' ') };
}
