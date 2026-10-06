export type MenuEntry = {
  label: string;
  path: string;
  /** Module pas encore livré : badge sable « À venir ». */
  soon?: boolean;
};

/** Menu administrateur, dans l'ordre du prototype (MENUS.admin). */
export const ADMIN_MENU: MenuEntry[] = [
  { label: 'Dashboard', path: '/admin' },
  { label: 'Joueurs', path: '/admin/joueurs', soon: true },
  { label: 'Parents', path: '/admin/parents', soon: true },
  { label: 'Entraîneurs', path: '/admin/entraineurs', soon: true },
  { label: 'Groupes', path: '/admin/groupes', soon: true },
  { label: 'Terrains', path: '/admin/terrains', soon: true },
  { label: 'Catégories', path: '/admin/categories', soon: true },
  { label: 'Saisons', path: '/admin/saisons' },
  { label: 'Tarifs d’entraînement', path: '/admin/tarifs', soon: true },
  { label: 'Tarifs terrains', path: '/admin/tarifs-terrains', soon: true },
  { label: 'Réservations', path: '/admin/reservations', soon: true },
  { label: 'Salaires', path: '/admin/salaires', soon: true },
  { label: 'Paiements', path: '/admin/paiements', soon: true },
  { label: 'Emails envoyés', path: '/admin/emails', soon: true },
  { label: 'Journal d’audit', path: '/admin/audit', soon: true },
  { label: 'Import historique', path: '/admin/import', soon: true },
];
