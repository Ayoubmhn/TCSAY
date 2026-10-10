import { Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Chiffrement des secrets stockés (mot de passe du compte fédération IJIN) : AES-256-GCM.
 * Clé : TCSAY_SECRET_KEY dans api/.env (64 caractères hexadécimaux). À défaut (développement), clé dérivée de JWT_SECRET.
 * Ne jamais changer la clé en production sans re-saisie des mots de passe (ils deviendraient illisibles).
 */
let key: Buffer | null = null;
function secretKey(): Buffer {
  if (key) return key;
  const hex = process.env.TCSAY_SECRET_KEY?.trim();
  if (hex && /^[0-9a-f]{64}$/i.test(hex)) key = Buffer.from(hex, 'hex');
  else {
    if (process.env.NODE_ENV === 'production' || process.env.TCSAY_PRODUCTION === 'true') {
      Logger.warn('TCSAY_SECRET_KEY absente ou invalide : clé dérivée de JWT_SECRET (à définir dans api/.env).', 'Secrets');
    }
    key = scryptSync(process.env.JWT_SECRET || 'tcsay-dev-secret', 'tcsay-secret-box', 32);
  }
  return key;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function open(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(':');
  if (v !== 'v1') throw new Error('format de secret inconnu');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
