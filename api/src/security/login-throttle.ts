import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

type Entry = { failures: number[]; blockedUntil: number };

const WINDOW_MS = 15 * 60_000;
/** Échecs tolérés par identifiant (depuis une même adresse) puis par adresse IP, sur 15 minutes. */
const MAX_PER_LOGIN = 5;
const MAX_PER_IP = 20;
const BLOCK_MS = 15 * 60_000;

/**
 * Limite des essais de connexion (et de « mot de passe actuel » au changement) : protège contre les essais de mots de
 * passe en série. En mémoire (une seule instance de l'API) : un redémarrage remet les compteurs à zéro.
 */
@Injectable()
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly logger = new Logger('Sécurité');

  /** Refuse (429) si l'identifiant ou l'adresse IP est bloqué. */
  check(ip: string, login: string) {
    const now = Date.now();
    for (const key of this.keys(ip, login)) {
      const e = this.entries.get(key);
      if (e && e.blockedUntil > now) {
        const minutes = Math.ceil((e.blockedUntil - now) / 60_000);
        throw new HttpException(
          `Trop d’essais incorrects : réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  fail(ip: string, login: string) {
    const now = Date.now();
    const [byLogin, byIp] = this.keys(ip, login);
    for (const [key, max] of [
      [byLogin, MAX_PER_LOGIN],
      [byIp, MAX_PER_IP],
    ] as const) {
      const e = this.entries.get(key) ?? { failures: [], blockedUntil: 0 };
      e.failures = e.failures.filter((t) => now - t < WINDOW_MS);
      e.failures.push(now);
      if (e.failures.length >= max) {
        e.blockedUntil = now + BLOCK_MS;
        e.failures = [];
        this.logger.warn(`Connexion bloquée 15 min après ${max} échecs : ${key.startsWith('ip:') ? key : `identifiant « ${login} »`} (${ip})`);
      }
      this.entries.set(key, e);
    }
    this.prune(now);
  }

  /** Connexion réussie : le compteur de cet identifiant repart de zéro (pas celui de l'adresse IP). */
  success(ip: string, login: string) {
    this.entries.delete(this.keys(ip, login)[0]);
  }

  private keys(ip: string, login: string): [string, string] {
    return [`login:${ip}|${login.trim().toLowerCase()}`, `ip:${ip}`];
  }

  private prune(now: number) {
    if (this.entries.size < 5000) return;
    for (const [k, e] of this.entries) if (e.blockedUntil < now && !e.failures.some((t) => now - t < WINDOW_MS)) this.entries.delete(k);
  }
}
