/**
 * Version du site, fixée à la construction (vite.config.ts) :
 * - démo : VITE_DEMO=1 (projet Vercel de la démo) ou `npm run dev:demo` ;
 * - club en local : `npm run dev:club` (pas de boutons de comptes de démo, comme en ligne).
 */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';
export const IS_CLUB_DEV = import.meta.env.VITE_CLUB === '1';
