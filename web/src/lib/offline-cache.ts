/**
 * Hors connexion : dernières réponses de quelques lectures utiles sur le terrain (profil, séances, feuilles de présence,
 * accueil, notifications), gardées sur l'appareil et resservies quand le réseau manque. Tout est effacé à la déconnexion.
 * Aucune donnée de paiement n'est gardée.
 */
const PREFIX = 'tcsay-hc:';
const MAX_AGE_MS = 3 * 86_400_000;

/** Lectures gardées (chemin de l'API, sans /api/v1). */
const CACHED = [/^\/auth\/me$/, /^\/sessions$/, /^\/sessions\/player$/, /^\/sessions\/review$/, /^\/attendance$/, /^\/absences$/, /^\/notifications(\/count)?$/];

export const isCachable = (path: string) => CACHED.some((r) => r.test(path));

const keyOf = (space: string | null, path: string, query: Record<string, unknown> = {}) => {
  const q = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return `${PREFIX}${space ?? '-'}:${path}?${q}`;
};

export function writeCache(space: string | null, path: string, query: Record<string, unknown> | undefined, data: unknown) {
  try {
    localStorage.setItem(keyOf(space, path, query), JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Stockage plein : on retire les plus anciennes copies puis on abandonne cette écriture.
    prune(true);
  }
}

/** Copie gardée (moins de 3 jours), marquée de sa date (`cachedAt`). */
export function readCache<T>(space: string | null, path: string, query?: Record<string, unknown>): T | undefined {
  try {
    const raw = localStorage.getItem(keyOf(space, path, query));
    if (!raw) return undefined;
    const { at, data } = JSON.parse(raw) as { at: number; data: T };
    if (Date.now() - at > MAX_AGE_MS) return undefined;
    if (data && typeof data === 'object') Object.defineProperty(data, '__cachedAt', { value: at, enumerable: false });
    return data;
  } catch {
    return undefined;
  }
}

/** Mise à jour d'une copie gardée (ex. feuille de présence pointée hors connexion). */
export function patchCache<T>(space: string | null, path: string, query: Record<string, unknown>, fn: (data: T) => T) {
  const data = readCache<T>(space, path, query);
  if (data !== undefined) writeCache(space, path, query, fn(data));
}

/** Date de la copie si la donnée vient de l'appareil (réseau absent), sinon undefined. */
export const cachedAt = (data: unknown): number | undefined => (data && typeof data === 'object' ? (data as { __cachedAt?: number }).__cachedAt : undefined);

export function clearCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    /* stockage indisponible */
  }
}

function prune(all = false) {
  try {
    const items = Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => ({ k, at: (JSON.parse(localStorage.getItem(k) ?? '{}') as { at?: number }).at ?? 0 }))
      .sort((a, b) => a.at - b.at);
    const old = items.filter((i) => Date.now() - i.at > MAX_AGE_MS);
    for (const i of all ? items.slice(0, Math.ceil(items.length / 2)) : old) localStorage.removeItem(i.k);
  } catch {
    /* stockage indisponible */
  }
}
prune();

// ───── État du réseau (dernier appel à l'API) ─────

let offline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setNetwork(reachable: boolean) {
  if (offline === !reachable) return;
  offline = !reachable;
  emit();
}
export const isOffline = () => offline;
export function onNetwork(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setNetwork(true));
  window.addEventListener('offline', () => setNetwork(false));
}

/** Heure « HH:MM » d'un jour « AAAA-MM-JJ » à Sayada (Africa/Tunis), en instant absolu. */
export function tunisInstant(day: string, hhmm: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Tunis', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  return new Date(guess - (shown - guess));
}

/** Pointage ouvert (15 min avant le début → 30 min après la fin), calculé sur l'appareil quand l'API ne répond pas. */
export function sessionOpenLocally(day: string, start: string, end: string, now = new Date()) {
  return tunisInstant(day, start).getTime() - 15 * 60_000 <= now.getTime() && now.getTime() <= tunisInstant(day, end).getTime() + 30 * 60_000;
}
