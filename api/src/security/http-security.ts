import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

const production = () => process.env.NODE_ENV === 'production' || process.env.TCSAY_PRODUCTION === 'true';

/**
 * Pages du site (servies par l'API en hébergement) : sources autorisées. Polices Google (Montserrat) seulement ;
 * aucun script externe, aucune intégration dans un autre site (frame-ancestors).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Durcissement HTTP fait main (sans bibliothèque) :
 * - adresse réelle du visiteur derrière l'hébergeur (proxy) pour la limite d'essais ;
 * - en-têtes de sécurité sur toutes les réponses, HTTPS imposé (HSTS) en production ;
 * - CORS : en production, seulement les adresses de CORS_ORIGIN (même adresse que le site : aucun autre site) ;
 * - limite globale de requêtes par adresse IP (protection contre les abus).
 */
export function applyHttpSecurity(app: NestExpressApplication) {
  const prod = production();
  if (process.env.TRUST_PROXY === 'true' || process.env.RENDER) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Réponses de l'API : jamais mises en cache (données personnelles).
    if (req.path.startsWith('/api/v1')) res.setHeader('Cache-Control', 'no-store');
    // Pages du site : politique de contenu (Swagger, qui a ses propres scripts, en est exclu).
    else if (!req.path.startsWith('/api/docs')) res.setHeader('Content-Security-Policy', CSP);
    next();
  });

  const origins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
  // Développement : site Vite sur un autre port, toutes origines. Production : liste explicite, sinon même adresse seulement.
  app.enableCors({ origin: origins?.length ? origins : prod ? false : true });

  app.use(rateLimit(Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300)));
}

/** Au plus `perMinute` requêtes par adresse IP et par minute ; au-delà : 429 pendant le reste de la minute. */
function rateLimit(perMinute: number) {
  const hits = new Map<string, { count: number; start: number }>();
  let warnedAt = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/v1') || perMinute <= 0) return next();
    const now = Date.now();
    const ip = req.ip ?? 'inconnu';
    let e = hits.get(ip);
    if (!e || now - e.start >= 60_000) {
      e = { count: 0, start: now };
      hits.set(ip, e);
      if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start >= 60_000) hits.delete(k);
    }
    e.count++;
    if (e.count > perMinute) {
      if (now - warnedAt > 60_000) {
        Logger.warn(`Trop de requêtes depuis ${ip} (${e.count}/min)`, 'Sécurité');
        warnedAt = now;
      }
      res.setHeader('Retry-After', String(Math.ceil((e.start + 60_000 - now) / 1000)));
      res.status(429).json({ statusCode: 429, message: 'Trop de requêtes : patientez une minute.' });
      return;
    }
    next();
  };
}

/** Swagger (plan complet de l'API) : désactivé en production, sauf SWAGGER=true. */
export const swaggerEnabled = () => !production() || process.env.SWAGGER === 'true';
