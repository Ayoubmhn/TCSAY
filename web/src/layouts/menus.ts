import type { ComponentType } from 'react';
import {
  IconCalendar,
  IconCard,
  IconChart,
  IconClipboard,
  IconCourt,
  IconHome,
  IconRacket,
  IconSettings,
  IconTrophy,
  IconUserOff,
  IconUsers,
  IconWallet,
} from '../components/ui/Icons';
import type { Actor, Me, Space } from '../lib/types';

export type MenuLink = {
  label: string;
  path: string;
  /** Module pas encore livré : badge sable « À venir ». */
  soon?: boolean;
  /** Espace administration : au moins une de ces autorisations (le président a tout). */
  perm?: string[];
  /** Réservé à certains acteurs (ex. « Mes salaires » pour le personnel salarié). */
  actors?: Actor[];
};

type Icon = ComponentType<{ size?: number }>;

/** Entrée du menu : lien direct (avec icône) ou catégorie repliable qui regroupe ses modules. */
export type MenuItem = (MenuLink & { icon: Icon }) | { label: string; icon: Icon; children: MenuLink[] };

export const isGroup = (item: MenuItem): item is Extract<MenuItem, { children: MenuLink[] }> => 'children' in item;

const PLAYER_MENU: MenuItem[] = [
  { label: 'Accueil', path: '/', icon: IconHome },
  {
    label: 'Mon activité',
    icon: IconRacket,
    children: [
      { label: 'Mes séances', path: '/seances' },
      { label: 'Mes absences', path: '/absences' },
    ],
  },
  { label: 'Mes paiements', path: '/paiements', icon: IconCard },
  { label: 'Réserver un terrain', path: '/reserver', icon: IconCourt },
  { label: 'Historique des tournois', path: '/tournois', icon: IconTrophy, soon: true },
];

const COACH_MENU: MenuItem[] = [
  { label: 'Mes séances', path: '/coach/seances', icon: IconCalendar },
  { label: 'Présences', path: '/coach/presences', icon: IconClipboard },
  { label: 'Mes absences', path: '/coach/absences', icon: IconUserOff },
  { label: 'Mes salaires', path: '/coach/salaires', icon: IconWallet },
  { label: 'Réserver (séances privées)', path: '/coach/reserver', icon: IconCourt },
];

/** Espace administration : président, agents, superviseur, directeur technique (modules selon les autorisations). */
const ADMIN_MENU: MenuItem[] = [
  { label: 'Dashboard', path: '/admin', icon: IconChart, perm: ['stats.view'] },
  { label: 'Planning des terrains', path: '/admin/planning', icon: IconCalendar, perm: ['planning.view', 'groups.manage'] },
  {
    label: 'Utilisateurs',
    icon: IconUsers,
    children: [
      { label: 'Joueurs', path: '/admin/joueurs', perm: ['players.manage'] },
      { label: 'Parents', path: '/admin/parents', perm: ['parents.manage'] },
      { label: 'Entraîneurs', path: '/admin/entraineurs', perm: ['coaches.manage'] },
      { label: 'Personnel', path: '/admin/personnel', perm: ['staff.manage'] },
      { label: 'Fiche d’inscription (A4)', path: '/admin/fiche-inscription', perm: ['players.manage'] },
    ],
  },
  {
    label: 'Entraînement',
    icon: IconRacket,
    children: [
      { label: 'Groupes', path: '/admin/groupes', perm: ['groups.manage'] },
      { label: 'Absences des entraîneurs', path: '/admin/absences', perm: ['absences.manage'] },
      { label: 'Catégories', path: '/admin/categories', perm: ['seasons.manage'] },
      { label: 'Saisons', path: '/admin/saisons', perm: ['seasons.manage', 'stats.view'] },
    ],
  },
  {
    label: 'Terrains',
    icon: IconCourt,
    children: [
      { label: 'Terrains', path: '/admin/terrains', perm: ['courts.manage'] },
      { label: 'Réservations', path: '/admin/reservations', perm: ['reservations.manage'] },
      { label: 'Tarifs terrains', path: '/admin/tarifs-terrains', perm: ['courts.manage'] },
    ],
  },
  {
    label: 'Finances',
    icon: IconWallet,
    children: [
      { label: 'Paiements', path: '/admin/paiements', perm: ['payments.collect'] },
      { label: 'Reçus', path: '/admin/recus', perm: ['payments.collect'] },
      { label: 'Tarifs d’entraînement', path: '/admin/tarifs', perm: ['fees.manage'] },
      { label: 'Salaires', path: '/admin/salaires', perm: ['salaries.manage'] },
      { label: 'Mes salaires', path: '/admin/mes-salaires', actors: ['ADMIN_AGENT', 'SUPERVISOR', 'TECH_DIRECTOR'] },
    ],
  },
  {
    label: 'Suivi',
    icon: IconClipboard,
    children: [
      { label: 'Envoyer une notification', path: '/admin/notifications', perm: ['notifications.send'] },
      { label: 'Emails envoyés', path: '/admin/emails', perm: ['emails.view'] },
      { label: 'Historique des actions', path: '/admin/audit', perm: ['audit.view'] },
      { label: 'Import historique', path: '/admin/import', soon: true, perm: ['import.manage'] },
    ],
  },
  { label: 'Autorisations', path: '/admin/autorisations', icon: IconSettings, perm: ['permissions.manage'] },
];

export const MENUS: Record<Space, MenuItem[]> = {
  player: PLAYER_MENU,
  parent: PLAYER_MENU,
  coach: COACH_MENU,
  admin: ADMIN_MENU,
};

/** Lien visible pour cet utilisateur (autorisations de l'espace administration, acteurs). */
export function allowed(link: MenuLink, me: Pick<Me, 'permissions' | 'roles'>): boolean {
  if (link.perm && !link.perm.some((p) => me.permissions.includes(p))) return false;
  if (link.actors && !link.actors.some((a) => me.roles.includes(a))) return false;
  return true;
}

/** Menu de l'espace courant, limité aux modules autorisés. */
export function menuFor(me: Pick<Me, 'space' | 'permissions' | 'roles'>): MenuItem[] {
  return MENUS[me.space]
    .map((item) => (isGroup(item) ? { ...item, children: item.children.filter((c) => allowed(c, me)) } : item))
    .filter((item) => (isGroup(item) ? item.children.length > 0 : allowed(item, me)));
}

/** Premier lien du menu (accueil de l'espace). */
export function firstPath(items: MenuItem[]): string {
  const first = items[0];
  if (!first) return '/parametres';
  return isGroup(first) ? first.children[0].path : first.path;
}

/** Toutes les routes du menu avec leurs conditions (contrôle d'accès des pages). */
export function linkFor(path: string): MenuLink | undefined {
  for (const items of Object.values(MENUS)) {
    for (const item of items) {
      if (isGroup(item)) {
        const found = item.children.find((c) => c.path === path);
        if (found) return found;
      } else if (item.path === path) return item;
    }
  }
  return undefined;
}
