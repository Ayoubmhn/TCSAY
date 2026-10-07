import type { Role } from '../lib/types';

export type MenuEntry = {
  label: string;
  path: string;
  /** Module pas encore livré : badge sable « À venir ». */
  soon?: boolean;
};

const PLAYER_MENU: MenuEntry[] = [
  { label: 'Accueil', path: '/' },
  { label: 'Mes paiements', path: '/paiements' },
  { label: 'Mes séances', path: '/seances' },
  { label: 'Mes absences', path: '/absences' },
  { label: 'Réserver un terrain', path: '/reserver' },
  { label: 'Historique des tournois', path: '/tournois', soon: true },
];

/** Menus par rôle, dans l'ordre du prototype (MENUS). */
export const MENUS: Record<Role, MenuEntry[]> = {
  PLAYER: PLAYER_MENU,
  PARENT: PLAYER_MENU,
  COACH: [
    { label: 'Mes séances', path: '/coach/seances' },
    { label: 'Mes salaires', path: '/coach/salaires' },
    { label: 'Réserver (séances privées)', path: '/coach/reserver' },
  ],
  ADMIN: [
    { label: 'Dashboard', path: '/admin' },
    { label: 'Joueurs', path: '/admin/joueurs' },
    { label: 'Parents', path: '/admin/parents' },
    { label: 'Entraîneurs', path: '/admin/entraineurs' },
    { label: 'Groupes', path: '/admin/groupes' },
    { label: 'Terrains', path: '/admin/terrains' },
    { label: 'Catégories', path: '/admin/categories' },
    { label: 'Saisons', path: '/admin/saisons' },
    { label: 'Tarifs d’entraînement', path: '/admin/tarifs' },
    { label: 'Tarifs terrains', path: '/admin/tarifs-terrains' },
    { label: 'Réservations', path: '/admin/reservations' },
    { label: 'Salaires', path: '/admin/salaires' },
    { label: 'Paiements', path: '/admin/paiements' },
    { label: 'Emails envoyés', path: '/admin/emails' },
    { label: 'Journal d’audit', path: '/admin/audit' },
    { label: 'Import historique', path: '/admin/import', soon: true },
  ],
};
