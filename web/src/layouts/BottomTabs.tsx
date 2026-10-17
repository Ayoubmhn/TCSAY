import type { ComponentType } from 'react';
import { NavLink } from 'react-router';
import { useMe } from '../auth/AuthContext';
import { IconBell, IconCalendar, IconCard, IconChart, IconClipboard, IconHome, IconTrophy, IconWallet } from '../components/ui/Icons';
import { apiUrl } from '../lib/api';
import { initials } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { firstPath, menuFor } from './menus';

type Tab = { label: string; path: string; Icon: ComponentType<{ size?: number }>; end?: boolean };

/** Onglets du bas selon l'espace (familles, entraîneur, administration) : les écrans les plus utilisés au téléphone. */
function tabsFor(me: ReturnType<typeof useMe>): Tab[] {
  if (me.space === 'coach') {
    return [
      { label: 'Séances', path: '/coach/seances', Icon: IconCalendar },
      { label: 'Présences', path: '/coach/presences', Icon: IconClipboard },
      { label: 'Matchs', path: '/matchs', Icon: IconTrophy },
      { label: 'Salaires', path: '/coach/salaires', Icon: IconWallet },
    ];
  }
  if (me.space === 'admin') {
    const has = (p: string) => me.permissions.includes(p);
    const tabs: Tab[] = [{ label: 'Accueil', path: firstPath(menuFor(me)), Icon: IconHome, end: true }];
    if (has('payments.collect')) tabs.push({ label: 'Paiements', path: '/admin/paiements', Icon: IconCard });
    if (has('planning.view') || has('groups.manage')) tabs.push({ label: 'Planning', path: '/admin/planning', Icon: IconCalendar });
    else if (has('stats.view')) tabs.push({ label: 'Stats', path: '/admin/statistiques', Icon: IconChart });
    tabs.push({ label: 'Alertes', path: '/notifications', Icon: IconBell });
    return tabs.slice(0, 4);
  }
  return [
    { label: 'Accueil', path: '/', Icon: IconHome, end: true },
    { label: 'Séances', path: '/seances', Icon: IconCalendar },
    { label: 'Paiements', path: '/paiements', Icon: IconCard },
    { label: 'Matchs', path: '/matchs', Icon: IconTrophy },
  ];
}

/** Pastille ronde du compte : photo de profil, sinon initiales. */
function AccountBadge({ active }: { active: boolean }) {
  const me = useMe();
  const src = apiUrl(me.photoUrl);
  return (
    <span
      aria-hidden="true"
      className={`grid h-[24px] w-[24px] place-items-center overflow-hidden rounded-full text-[10px] font-semibold ${active ? 'ring-2 ring-pri' : ''} ${src ? '' : 'bg-fld text-fg'}`}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials(me.firstName, me.lastName)}
    </span>
  );
}

/**
 * Barre d'onglets en bas de l'écran (téléphone, sous 860 px) : 4 écrans principaux + « Compte » (photo de profil,
 * Paramètres). Le menu complet s'ouvre avec le bouton du haut, toujours visible. Respecte la zone sûre des iPhone.
 */
export function BottomTabs() {
  const me = useMe();
  const { t } = useI18n();
  const item = 'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px] py-1.5 text-[11px] font-medium';
  return (
    <nav
      aria-label={t('Navigation principale')}
      className="no-print fixed inset-x-0 bottom-0 z-30 border-t-[1.5px] border-line bg-card px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom,0px))] nav:hidden"
    >
      <div className="mx-auto flex max-w-[560px] gap-1">
        {tabsFor(me).map(({ label, path, Icon, end }) => (
          <NavLink key={path} to={path} end={end} className={({ isActive }) => `${item} ${isActive ? 'bg-btn text-pri' : 'text-mut'}`}>
            <Icon size={22} />
            <span className="truncate">{t(label)}</span>
          </NavLink>
        ))}
        <NavLink to="/parametres" className={({ isActive }) => `${item} ${isActive ? 'bg-btn text-pri' : 'text-mut'}`}>
          {({ isActive }) => (
            <>
              <AccountBadge active={isActive} />
              <span className="truncate">{t('Compte')}</span>
            </>
          )}
        </NavLink>
      </div>
    </nav>
  );
}
