import type { ComponentType } from 'react';
import {
  IconCalendar,
  IconCard,
  IconChart,
  IconClipboard,
  IconCourt,
  IconHome,
  IconRacket,
  IconTrophy,
  IconUsers,
  IconWallet,
} from '../components/ui/Icons';
import type { Role } from '../lib/types';

export type MenuLink = {
  label: string;
  path: string;
  /** Module pas encore livré : badge sable « À venir ». */
  soon?: boolean;
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

/** Menus par rôle, regroupés par catégorie (modules du prototype). */
export const MENUS: Record<Role, MenuItem[]> = {
  PLAYER: PLAYER_MENU,
  PARENT: PLAYER_MENU,
  COACH: [
    { label: 'Mes séances', path: '/coach/seances', icon: IconCalendar },
    { label: 'Mes salaires', path: '/coach/salaires', icon: IconWallet },
    { label: 'Réserver (séances privées)', path: '/coach/reserver', icon: IconCourt },
  ],
  ADMIN: [
    { label: 'Dashboard', path: '/admin', icon: IconChart },
    {
      label: 'Utilisateurs',
      icon: IconUsers,
      children: [
        { label: 'Joueurs', path: '/admin/joueurs' },
        { label: 'Parents', path: '/admin/parents' },
        { label: 'Entraîneurs', path: '/admin/entraineurs' },
      ],
    },
    {
      label: 'Entraînement',
      icon: IconRacket,
      children: [
        { label: 'Groupes', path: '/admin/groupes' },
        { label: 'Catégories', path: '/admin/categories' },
        { label: 'Saisons', path: '/admin/saisons' },
      ],
    },
    {
      label: 'Terrains',
      icon: IconCourt,
      children: [
        { label: 'Terrains', path: '/admin/terrains' },
        { label: 'Réservations', path: '/admin/reservations' },
        { label: 'Tarifs terrains', path: '/admin/tarifs-terrains' },
      ],
    },
    {
      label: 'Finances',
      icon: IconWallet,
      children: [
        { label: 'Paiements', path: '/admin/paiements' },
        { label: 'Tarifs d’entraînement', path: '/admin/tarifs' },
        { label: 'Salaires', path: '/admin/salaires' },
      ],
    },
    {
      label: 'Suivi',
      icon: IconClipboard,
      children: [
        { label: 'Emails envoyés', path: '/admin/emails' },
        { label: 'Journal d’audit', path: '/admin/audit' },
        { label: 'Import historique', path: '/admin/import', soon: true },
      ],
    },
  ],
};

/** Premier lien du menu (accueil du rôle). */
export function firstPath(items: MenuItem[]): string {
  const first = items[0];
  return isGroup(first) ? first.children[0].path : first.path;
}
