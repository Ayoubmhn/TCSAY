import type { Me } from './types';

/** Écran d'accueil selon l'espace choisi. */
export function homeOf(me: Pick<Me, 'space'>): string {
  if (me.space === 'coach') return '/coach/seances';
  if (me.space === 'admin') return '/admin';
  return '/';
}

/** Écrans présents dans l'application (même adresse que sur le site) ; les autres liens ouvrent les notifications. */
const ROUTES = new Set([
  '/',
  '/paiements',
  '/seances',
  '/absences',
  '/notifications',
  '/parametres',
  '/plus',
  '/coach/seances',
  '/coach/presences',
  '/coach/salaires',
  '/admin',
]);

export function appRoute(link: string | null | undefined): string | null {
  if (!link) return null;
  const path = link.split('?')[0].replace(/\/+$/, '') || '/';
  return ROUTES.has(path) ? path : null;
}

export const SPACE_LABEL: Record<string, string> = {
  admin: 'Administration',
  coach: 'Entraîneur',
  parent: 'Parent',
  player: 'Joueur',
};
