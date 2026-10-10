import { Role } from '@prisma/client';

/**
 * Catalogue des autorisations de l'espace administration.
 * Le président a toujours tout ; il règle les droits des autres rôles dans le module « Autorisations ».
 */
export const PERMISSIONS = [
  { key: 'stats.view', label: 'Statistiques du club (dashboard)', group: 'Pilotage' },
  { key: 'planning.view', label: 'Planning des terrains (emploi du temps)', group: 'Pilotage' },
  { key: 'audit.view', label: 'Historique des actions', group: 'Pilotage' },
  { key: 'players.manage', label: 'Joueurs (création, modification, archivage)', group: 'Utilisateurs' },
  { key: 'parents.manage', label: 'Parents', group: 'Utilisateurs' },
  { key: 'coaches.manage', label: 'Entraîneurs', group: 'Utilisateurs' },
  { key: 'staff.manage', label: 'Personnel administratif', group: 'Utilisateurs' },
  { key: 'groups.manage', label: 'Groupes et emploi du temps', group: 'Entraînement' },
  { key: 'absences.manage', label: 'Absences des entraîneurs (validation)', group: 'Entraînement' },
  { key: 'attendance.manage', label: 'Présences des joueurs (correction)', group: 'Entraînement' },
  { key: 'seasons.manage', label: 'Saisons et catégories', group: 'Entraînement' },
  { key: 'courts.manage', label: 'Terrains et tarifs terrains', group: 'Terrains' },
  { key: 'reservations.manage', label: 'Réservations', group: 'Terrains' },
  { key: 'fees.manage', label: 'Tarifs d’entraînement', group: 'Finances' },
  { key: 'payments.collect', label: 'Paiements des joueurs et parents', group: 'Finances' },
  { key: 'salaries.manage', label: 'Salaires des entraîneurs et du personnel', group: 'Finances' },
  { key: 'emails.view', label: 'Emails envoyés', group: 'Suivi' },
  { key: 'notifications.send', label: 'Envoyer des notifications (parents, joueurs, entraîneurs)', group: 'Suivi' },
  { key: 'import.manage', label: 'Import de l’historique', group: 'Suivi' },
] as const;

export type Permission = (typeof PERMISSIONS)[number]['key'] | 'permissions.manage';

export const PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p.key);

/** Rôles de l'espace administration (le président n'est pas réglable : il a tout). */
export const STAFF_ROLES: Role[] = [Role.PRESIDENT, Role.ADMIN_AGENT, Role.SUPERVISOR, Role.TECH_DIRECTOR];
export const EDITABLE_ROLES: Role[] = [Role.ADMIN_AGENT, Role.SUPERVISOR, Role.TECH_DIRECTOR];

export const ROLE_LABEL: Record<Role, string> = {
  PRESIDENT: 'Président',
  ADMIN_AGENT: 'Agent administratif',
  SUPERVISOR: 'Agent superviseur',
  TECH_DIRECTOR: 'Directeur technique',
  COACH: 'Entraîneur',
  PARENT: 'Parent',
  PLAYER: 'Joueur',
  ADMIN: 'Administrateur',
  STAFF: 'Personnel',
};

/** Droits proposés par défaut (modifiables ensuite par le président). */
export const DEFAULT_PERMISSIONS: Partial<Record<Role, string[]>> = {
  ADMIN_AGENT: [
    'players.manage',
    'parents.manage',
    'coaches.manage',
    'payments.collect',
    'salaries.manage',
    'reservations.manage',
    'planning.view',
    'emails.view',
    'notifications.send',
  ],
  SUPERVISOR: ['stats.view'],
  TECH_DIRECTOR: ['coaches.manage', 'groups.manage', 'absences.manage', 'attendance.manage', 'planning.view'],
};
