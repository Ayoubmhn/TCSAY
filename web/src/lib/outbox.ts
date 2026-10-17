import { api, ApiError, getSpace } from './api';
import { isOffline, onNetwork } from './offline-cache';

/**
 * Envois en attente (pointages faits sans réseau) : gardés sur l'appareil avec l'heure réelle du pointage,
 * renvoyés tout seuls dès que le réseau revient (retour du réseau, ouverture de l'application, toutes les minutes).
 * Un envoi refusé par l'API (règle métier) est retiré de la file et signalé à l'entraîneur.
 */
export type OutboxItem = { id: string; path: string; body: Record<string, unknown>; label: string; space: string | null; userId: string | null; createdAt: string };
export type OutboxFailure = { id: string; label: string; message: string };

const KEY = 'tcsay-outbox';
/** Compte connecté : seuls ses envois partent (un autre compte sur le même appareil n'envoie jamais ceux d'un collègue). */
let currentUser: string | null = null;
export function setOutboxUser(id: string | null) {
  currentUser = id;
  if (id && mine().length) void flush();
}
const FAILED_KEY = 'tcsay-outbox-refus';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}
function write(key: string, list: unknown[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* stockage plein ou indisponible */
  }
  emit();
}

export const pending = () => read<OutboxItem>(KEY);
export const mine = () => pending().filter((x) => x.userId === currentUser);
export const failures = () => read<OutboxFailure>(FAILED_KEY);
export const dismissFailure = (id: string) => write(FAILED_KEY, failures().filter((f) => f.id !== id));

/**
 * Ajoute un envoi ; `dedupe` remplace un envoi en attente de même clé (ex. même séance pointée deux fois :
 * seule la dernière feuille compte, avec sa propre heure de pointage).
 */
export function enqueue(item: Omit<OutboxItem, 'id' | 'createdAt' | 'space' | 'userId'>, dedupe?: string) {
  const id = dedupe ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const list = pending().filter((x) => x.id !== id);
  list.push({ ...item, id, space: getSpace(), userId: currentUser, createdAt: new Date().toISOString() });
  write(KEY, list);
}

let running = false;
let lastSent = 0;

/** Envoie la file dans l'ordre ; s'arrête au premier échec réseau (on réessaiera). */
export async function flush(): Promise<number> {
  if (running) return 0;
  running = true;
  let sent = 0;
  try {
    for (const item of mine()) {
      try {
        await api.put(item.path, { ...item.body, clientNow: new Date().toISOString() });
        sent++;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 401)) break;
        write(FAILED_KEY, [...failures(), { id: item.id, label: item.label, message: e instanceof Error ? e.message : 'Envoi refusé.' }]);
      }
      write(KEY, pending().filter((x) => x.id !== item.id));
    }
  } finally {
    running = false;
  }
  if (sent) lastSent = Date.now();
  return sent;
}

export const lastFlush = () => lastSent;

export function onOutbox(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

// Envoi automatique : retour du réseau, retour dans l'application, toutes les minutes.
if (typeof window !== 'undefined') {
  const tryFlush = () => {
    if (mine().length) void flush();
  };
  window.addEventListener('online', tryFlush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tryFlush());
  onNetwork(() => !isOffline() && tryFlush());
  setInterval(tryFlush, 60_000);
  setTimeout(tryFlush, 3_000);
}
