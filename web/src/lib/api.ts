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

type Query = Record<string, string | number | boolean | undefined | null>;

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

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Serveur injoignable : vérifiez que l’API est démarrée.');
  }

  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    const raw = (data as { message?: string | string[] } | undefined)?.message;
    const message = Array.isArray(raw) ? raw[0] : (raw ?? `Erreur ${res.status}`);
    if (res.status === 401 && path !== '/auth/login') onUnauthorized?.();
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string, query?: Query) => request<T>('DELETE', path, undefined, query),
  /** Envoi d'un fichier (multipart, champ « file »). */
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>('POST', path, form);
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.';
}
