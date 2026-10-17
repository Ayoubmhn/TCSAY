import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

/** Empreinte au format « scrypt$sel$empreinte » (module crypto de Node, sans dépendance). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hex] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Mot de passe temporaire lisible (sans caractères ambigus). */
export function temporaryPassword(length = 10): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
}

/** Mots de passe trop courants, refusés quelle que soit leur longueur. */
const COMMON = [
  'password', 'motdepasse', 'azerty', 'qwerty', 'tennis', 'tcsay', 'sayada', 'tunisie', 'bienvenue', 'welcome',
  '123456', '1234567890', 'admin', 'soleil', 'football',
];

/**
 * Règles d'un nouveau mot de passe : 10 caractères au moins, au moins une lettre et un chiffre, pas un mot courant,
 * ni le prénom, le nom ou l'identifiant de la personne. Renvoie le message à afficher, ou null si le mot de passe convient.
 */
export function passwordProblem(password: string, person: { email?: string | null; cin?: string | null; firstName?: string; lastName?: string }): string | null {
  if (password.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  const plain = password.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const personal = [person.email?.split('@')[0], person.cin, person.firstName, person.lastName]
    .map((x) => (x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim())
    .filter((x) => x.length >= 3);
  if (personal.some((x) => plain.includes(x))) return 'Le mot de passe ne doit pas contenir votre nom, prénom, email ou CIN.';
  const letters = plain.replace(/[^a-z]/g, '');
  if (COMMON.some((w) => letters === w || plain.startsWith(w))) return 'Mot de passe trop courant : choisissez-en un autre.';
  if (/^(.)\1+$/.test(plain) || /^(0123456789|1234567890|abcdefghij)/.test(plain)) return 'Mot de passe trop simple : choisissez-en un autre.';
  return null;
}
