import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';

/** JWT HS256 minimal (module crypto de Node, sans dépendance). */

/** `pw` : empreinte courte du mot de passe actuel : changer le mot de passe déconnecte les autres sessions. */
type Payload = { sub: string; role: string; pw: string; iat: number; exp: number };

/** Empreinte du hachage stocké (jamais du mot de passe) : change à chaque nouveau mot de passe. */
export const passwordStamp = (passwordHash: string) => createHash('sha256').update(passwordHash).digest('base64url').slice(0, 16);

const DEV_SECRET = 'tcsay-dev-secret-a-changer';
let warned = false;

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (value && value.length < 32 && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET trop court (32 caractères minimum).');
  if (value) return value;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET manquant.');
  if (!warned) {
    Logger.warn('JWT_SECRET absent : secret de développement utilisé.', 'Auth');
    warned = true;
  }
  return DEV_SECRET;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

export function signToken(sub: string, role: string, passwordHash: string, ttlSeconds = 12 * 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub, role, pw: passwordStamp(passwordHash), iat: now, exp: now + ttlSeconds } satisfies Payload));
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

/** Renvoie la charge utile si le jeton est valide et non expiré, sinon null. */
export function verifyToken(token: string): Payload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  // Seul l'algorithme HS256 est accepté (pas de jeton « alg: none » ni d'autre algorithme).
  try {
    if ((JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: string }).alg !== 'HS256') return null;
  } catch {
    return null;
  }
  const expected = Buffer.from(sign(`${header}.${payload}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Payload;
    if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000 || typeof data.pw !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}
