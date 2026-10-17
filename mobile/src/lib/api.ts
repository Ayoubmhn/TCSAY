import { Platform } from 'react-native';
import { getItem, setItem } from './storage';

/** Erreur renvoyée par l'API, avec le message métier (« R2 · … ») à afficher en toast. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Space = 'admin' | 'coach' | 'parent' | 'player';

/**
 * Adresse du serveur : réglable sur l'écran de connexion.
 * Par défaut : EXPO_PUBLIC_API_URL, sinon l'ordinateur hôte vu depuis l'émulateur Android (10.0.2.2).
 */
export const DEFAULT_SERVER =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

const K = { token: 'tcsay.token', space: 'tcsay.space', server: 'tcsay.server', kid: 'tcsay.kid' };

let token: string | null = null;
let space: Space | null = null;
let server = DEFAULT_SERVER;
let kid: string | null = null;

/** Lit la session enregistrée (au démarrage de l'application). */
export async function loadSession() {
  [token, server, kid] = await Promise.all([getItem(K.token), getItem(K.server).then((s) => s ?? DEFAULT_SERVER), getItem(K.kid)]);
  space = (await getItem(K.space)) as Space | null;
  return { token, space, server, kid };
}

export const getToken = () => token;
export const getServer = () => server;
export const getStoredKid = () => kid;

export function setToken(value: string | null) {
  token = value;
  void setItem(K.token, value);
}
export function setStoredSpace(value: Space | null) {
  space = value;
  void setItem(K.space, value);
}
export function setStoredKid(value: string | null) {
  kid = value;
  void setItem(K.kid, value);
}
/** « 192.168.1.20:3000 » → « http://192.168.1.20:3000 » ; sans « /api/v1 » final. */
export function normalizeServer(value: string): string {
  let v = value.trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  return v;
}
export function setServer(value: string) {
  server = normalizeServer(value);
  void setItem(K.server, server);
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

type Query = Record<string, string | number | boolean | undefined | null>;

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const params = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = `${server}/api/v1${path}${params ? `?${params}` : ''}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (space) headers['X-Espace'] = space;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
  } catch {
    throw new ApiError(0, `Serveur injoignable (${server}). Vérifiez le réseau et l’adresse du serveur.`);
  } finally {
    clearTimeout(timer);
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
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.';
}

/** Règles du mot de passe (vérifiées aussi par l'API). */
export function passwordHint(password: string): string | null {
  if (password.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  return null;
}
