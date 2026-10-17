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
  { key: 'federation.manage', label: 'Comptes fédération IJIN (saisie)', group: 'Utilisateurs' },
  { key: 'groups.manage', label: 'Groupes et emploi du temps', group: 'Entraînement' },
  { key: 'absences.manage', label: 'Absences des entraîneurs (validation)', group: 'Entraînement' },
  { key: 'attendance.manage', label: 'Présences des joueurs (correction)', group: 'Entraînement' },
  { key: 'evaluations.manage', label: 'Suivi technique (bilans, niveaux, alertes)', group: 'Entraînement' },
  { key: 'matches.manage', label: 'Matchs (création, saisie des points, correction)', group: 'Entraînement' },
  { key: 'tournaments.manage', label: 'Tournois (création, inscriptions, tableau, planning)', group: 'Entraînement' },
  { key: 'seasons.manage', label: 'Saisons et catégories', group: 'Entraînement' },
  { key: 'courts.manage', label: 'Terrains et tarifs terrains', group: 'Terrains' },
  { key: 'reservations.manage', label: 'Réservations', group: 'Terrains' },
  { key: 'fees.manage', label: 'Tarifs d’entraînement', group: 'Finances' },
  { key: 'payments.collect', label: 'Paiements des joueurs et parents', group: 'Finances' },
  { key: 'salaries.manage', label: 'Salaires des entraîneurs et du personnel', group: 'Finances' },
  { key: 'expenses.manage', label: 'Dépenses (factures, déclarations)', group: 'Finances' },
  { key: 'emails.view', label: 'Emails envoyés', group: 'Suivi' },
  { key: 'notifications.send', label: 'Envoyer des notifications (parents, joueurs, entraîneurs)', group: 'Suivi' },
  { key: 'events.manage', label: 'Événements du club (création, publication, participations)', group: 'Suivi' },
  { key: 'albums.manage', label: 'Albums photos (création, envoi, identification, retrait)', group: 'Suivi' },
  { key: 'complaints.manage', label: 'Réclamations et suggestions (toutes, sauf comportement : président)', group: 'Suivi' },
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
    'federation.manage',
    'expenses.manage',
    'events.manage',
  ],
  SUPERVISOR: ['stats.view'],
  TECH_DIRECTOR: ['coaches.manage', 'groups.manage', 'absences.manage', 'attendance.manage', 'evaluations.manage', 'matches.manage', 'tournaments.manage', 'planning.view'],
};
