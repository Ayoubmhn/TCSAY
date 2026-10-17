import { clearCache, isCachable, readCache, setNetwork, writeCache } from './offline-cache';

const BASE_URL = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;
const TOKEN_KEY = 'tcsay-token';

/** Erreur renvoyée par l'API, avec le message métier (« R2 · … ») à afficher en toast. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ───── Jeton de session (localStorage : confort par appareil, jamais indispensable) ─────

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return memoryToken;
  }
}

let memoryToken: string | null = null;

export function setToken(token: string | null): void {
  memoryToken = token;
  // Déconnexion : les copies gardées pour le hors connexion sont effacées.
  if (!token) clearCache();
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* stockage indisponible : jeton gardé en mémoire */
  }
}

// ───── Espace de travail (un compte peut cumuler plusieurs rôles : administration, entraîneur, parent, joueur) ─────

export type Space = 'admin' | 'coach' | 'parent' | 'player';
const SPACE_KEY = 'tcsay-espace';
let memorySpace: Space | null = null;

export function getSpace(): Space | null {
  try {
    return (localStorage.getItem(SPACE_KEY) as Space | null) ?? memorySpace;
  } catch {
    return memorySpace;
  }
}

export function setStoredSpace(space: Space | null): void {
  memorySpace = space;
  try {
    if (space) localStorage.setItem(SPACE_KEY, space);
    else localStorage.removeItem(SPACE_KEY);
  } catch {
    /* espace gardé en mémoire */
  }
}

/** Appelé quand l'API répond 401 (session expirée) : l'application revient à la connexion. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

/** Code du module Autorisations, gardé en mémoire seulement (jamais stocké) le temps de la visite. */
let permissionsCode: string | null = null;
export function setPermissionsCode(code: string | null): void {
  permissionsCode = code;
}

type Query = Record<string, string | number | boolean | undefined | null>;

/** Identifiant aléatoire de cet appareil (sécurité des réservations : plusieurs comptes sur un même téléphone). */
function deviceId(): string | null {
  try {
    let id = localStorage.getItem('tcsay.device');
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9-]/g, '');
      localStorage.setItem('tcsay.device', id);
    }
    return id;
  } catch {
    return null;
  }
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = {};
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const space = getSpace();
  if (space) headers['X-Espace'] = space;
  if (permissionsCode && path.startsWith('/permissions')) headers['X-Code-Autorisations'] = permissionsCode;
  const device = deviceId();
  if (device) headers['X-Device'] = device;

  const cachable = method === 'GET' && isCachable(path);
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  } catch {
    setNetwork(false);
    // Hors connexion : dernière copie gardée sur l'appareil, si elle existe.
    const copy = cachable ? readCache<T>(space, path, query) : undefined;
    if (copy !== undefined) return copy;
    throw new ApiError(0, 'Pas de connexion : vérifiez le réseau (Wi-Fi ou données mobiles).');
  }
  setNetwork(true);

  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    const raw = (data as { message?: string | string[] } | undefined)?.message;
    const message = Array.isArray(raw) ? raw[0] : (raw ?? `Erreur ${res.status}`);
    if (res.status === 401 && path !== '/auth/login') onUnauthorized?.();
    throw new ApiError(res.status, message);
  }
  if (cachable) writeCache(space, path, query, data);
  return data as T;
}

/** Fichier protégé (justificatif…) : téléchargé avec le jeton, puis ouvert dans un nouvel onglet. */
export async function openFile(path: string): Promise<void> {
  const tab = window.open('', '_blank');
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const space = getSpace();
  if (space) headers['X-Espace'] = space;
  const res = await fetch(new URL(`${BASE_URL}${path}`, window.location.origin), { headers });
  if (!res.ok) {
    tab?.close();
    const data = (await res.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new ApiError(res.status, data?.message ?? `Erreur ${res.status}`);
  }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string, query?: Query) => request<T>('DELETE', path, undefined, query),
  /** Envoi d'un fichier (multipart, champ « file »). */
  upload: <T>(path: string, file: File | Blob, fields: Record<string, string> = {}, method: 'POST' | 'PUT' = 'POST') => {
    const form = new FormData();
    form.append('file', file, file instanceof File ? file.name : 'photo.jpg');
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return request<T>(method, path, form);
  },
};

/** Image protégée (photo jointe d'une réclamation…) : téléchargée avec le jeton, rendue en adresse locale. */
export async function blobUrl(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const space = getSpace();
  if (space) headers['X-Espace'] = space;
  const res = await fetch(new URL(`${BASE_URL}${path}`, window.location.origin), { headers });
  if (!res.ok) throw new ApiError(res.status, `Erreur ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/** Adresse complète d'une ressource de l'API (ex. photo signée « /photos/… »). */
export const apiUrl = (path: string | null | undefined): string | undefined => (path ? `${BASE_URL}${path}` : undefined);

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.';
}

/** Changement de mot de passe : l'API renvoie un nouveau jeton (les anciennes sessions sont déconnectées). */
export async function changePassword(currentPassword: string | undefined, newPassword: string): Promise<void> {
  const r = await api.post<{ accessToken?: string }>('/auth/change-password', { currentPassword: currentPassword || undefined, newPassword });
  if (r?.accessToken) setToken(r.accessToken);
}

/** Règles du mot de passe (vérifiées aussi par l'API) : message à afficher, ou null. */
export function passwordHint(password: string): string | null {
  if (password.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  return null;
}
