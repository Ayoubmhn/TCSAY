import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { SPACE_LABEL, useAuth, useMe } from '../auth/AuthContext';
import { NotificationBell } from '../components/NotificationBell';
import { Avatar } from '../components/ui/Avatar';
import { Brand } from '../components/ui/Brand';
import { IconChevron, IconLogout, IconMail, IconSettings } from '../components/ui/Icons';
import { MenuButton } from '../components/ui/MenuButton';
import { Badge } from '../components/ui/Pill';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { useI18n } from '../lib/i18n';
import type { Space } from '../lib/types';
import { firstPath, isGroup, menuFor, type MenuItem } from './menus';

const CLOSED_KEY = 'tcsay-menu-closed';

function readClosed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Catégories repliées : mémorisées par appareil (confort uniquement). */
function useClosedGroups() {
  const [closed, setClosed] = useState<string[]>(readClosed);
  const toggle = (label: string) =>
    setClosed((list) => {
      const next = list.includes(label) ? list.filter((l) => l !== label) : [...list, label];
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify(next));
      } catch {
        /* préférence non mémorisée */
      }
      return next;
    });
  const open = (label: string) => setClosed((list) => list.filter((l) => l !== label));
  return { closed, toggle, open };
}

const ROW = 'flex w-full items-center gap-3 rounded-[18px] px-3.5 py-3 text-start font-medium';

/** Lien de premier niveau : icône + libellé ; actif = fond gris et barre à gauche. */
function TopLink({ item, end, onNavigate }: { item: Extract<MenuItem, { path: string }>; end: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  const { t } = useI18n();
  return (
    <NavLink
      to={item.path}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) => `${ROW} relative ${isActive ? 'bg-btn text-fg' : 'text-fg hover:bg-fld'}`}
    >
      {({ isActive }) => (
        <>
          {isActive && <span aria-hidden="true" className="absolute start-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-fg/40" />}
          <Icon />
          <span className="flex-1">{t(item.label)}</span>
          {item.soon && <Badge>À venir</Badge>}
        </>
      )}
    </NavLink>
  );
}

/** Catégorie repliable : titre + chevron, modules dessous avec puce et trait vertical. */
function Group({
  item,
  open,
  onToggle,
  onNavigate,
}: {
  item: Extract<MenuItem, { children: unknown }>;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const { t } = useI18n();
  const id = `menu-${item.label.replace(/\W+/g, '-')}`;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className={`${ROW} ${open ? 'bg-fld' : 'hover:bg-fld'} text-fg`}
      >
        <Icon />
        <span className="flex-1">{t(item.label)}</span>
        <IconChevron open={open} size={18} />
      </button>
      {open && (
        <ul id={id} className="mt-1 mb-1.5 ms-[26px] flex flex-col border-s-[1.5px] border-line ps-3">
          {item.children.map((child) => (
            <li key={child.path}>
              <NavLink
                to={child.path}
                end
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-[14px] px-2.5 py-2.5 ${isActive ? 'font-semibold text-fg' : 'text-mut hover:text-fg'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span aria-hidden="true" className={`h-1.5 w-1.5 flex-none rounded-full ${isActive ? 'bg-pri' : 'bg-mut/50'}`} />
                    <span className="flex-1">{t(child.label)}</span>
                    {child.soon && <Badge>À venir</Badge>}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Contenu du menu latéral : logo, « MAIN », catégories et modules du rôle, carte utilisateur. */
function SideContent({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe();
  const { logout, switchSpace } = useAuth();
  const { t } = useI18n();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const menu = menuFor(me);
  const home = firstPath(menu);
  const { closed, toggle, open } = useClosedGroups();

  // La catégorie de la page affichée est toujours dépliée.
  useEffect(() => {
    const current = menu.find((i) => isGroup(i) && i.children.some((c) => c.path === pathname));
    if (current) open(current.label);
  }, [pathname]);

  return (
    <>
      <Brand />
      {/* Seule la liste défile : la carte utilisateur reste visible en bas. */}
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-1 [scrollbar-width:thin]">
      <div className="px-2.5 text-xs font-semibold tracking-[0.12em] text-mut">{t('MAIN')}</div>

      <nav className="flex flex-col gap-1" aria-label={t('Navigation')}>
        {menu.map((item) =>
          isGroup(item) ? (
            <Group
              key={item.label}
              item={item}
              open={!closed.includes(item.label)}
              onToggle={() => toggle(item.label)}
              onNavigate={onNavigate}
            />
          ) : (
            <TopLink key={item.path} item={item} end={item.path === home} onNavigate={onNavigate} />
          ),
        )}
      </nav>
      </div>

      {/* Compte à plusieurs rôles : choix de l'espace (administration, entraîneur, parent, joueur) */}
      {me.spaces.length > 1 && (
        <div role="group" aria-label={t('Espace')} className="flex flex-none flex-wrap gap-1 rounded-[18px] bg-btn p-1">
          {me.spaces.map((sp: Space) => (
            <button
              key={sp}
              type="button"
              aria-pressed={sp === me.space}
              onClick={() => {
                if (sp === me.space) return;
                switchSpace(sp);
                onNavigate?.();
                navigate('/');
              }}
              className={`flex-1 rounded-[14px] px-2.5 py-1.5 text-[12.5px] font-medium ${sp === me.space ? 'bg-toggle text-bg' : 'text-fg'}`}
            >
              {t(SPACE_LABEL[sp])}
            </button>
          ))}
        </div>
      )}

      {/* Carte utilisateur : avatar, nom, email, déconnexion */}
      <div className="flex flex-none items-center gap-2.5 rounded-[24px] border-[1.5px] border-line bg-card p-3">
        <Avatar first={me.firstName} last={me.lastName} />
        <div className="min-w-0 flex-1">
          <b className="block truncate font-semibold">
            {me.firstName} {me.lastName.toUpperCase()}
          </b>
          <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-mut">
            <IconMail size={14} />
            <span className="truncate">{me.email ?? me.cin}</span>
          </span>
        </div>
        <Link
          to="/parametres"
          onClick={onNavigate}
          aria-label={t('Paramètres')}
          title={t('Paramètres')}
          className="grid h-10 w-10 flex-none place-items-center rounded-[14px] text-mut hover:bg-fld hover:text-fg"
        >
          <IconSettings />
        </Link>
        <button
          type="button"
          onClick={logout}
          aria-label={t('Déconnexion')}
          title={t('Déconnexion')}
          className="grid h-10 w-10 flex-none place-items-center rounded-[14px] text-mut hover:bg-fld hover:text-fg"
        >
          <IconLogout />
        </button>
      </div>
    </>
  );
}

const SIDE = 'flex flex-col gap-[18px] overflow-hidden border-e-[1.5px] border-line bg-dr px-4 py-[22px]';

/** Shell (.app) : menu 266px + zone principale ; tiroir 268px avec voile sous 860px. */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();
  const { t } = useI18n();

  useEffect(() => {
    setDrawerOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="grid min-h-full grid-cols-1 nav:grid-cols-[266px_minmax(0,1fr)]">
      <aside aria-label={t('Menu principal')} className={`no-print ${SIDE} sticky top-0 hidden h-screen nav:flex`}>
        <SideContent />
      </aside>

      <div
        aria-hidden="true"
        onClick={() => setDrawerOpen(false)}
        className={`fixed inset-0 z-[39] bg-veil nav:hidden ${drawerOpen ? 'block' : 'hidden'}`}
      />
      <aside
        aria-label={t('Menu principal')}
        inert={!drawerOpen}
        className={`no-print drawer ${SIDE} fixed inset-y-0 start-0 z-40 w-[268px] pt-[calc(22px+env(safe-area-inset-top,0px))] transition-transform duration-250 ease-in-out nav:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-[105%] rtl:translate-x-[105%]'
        }`}
      >
        <SideContent onNavigate={() => setDrawerOpen(false)} />
      </aside>

      <main className="print-main min-w-0 px-[clamp(16px,3.5vw,40px)] pt-[22px] pb-[60px]">
        <div className="no-print mb-[22px] flex items-center gap-3">
          <MenuButton expanded={drawerOpen} onClick={() => setDrawerOpen((v) => !v)} />
          <span className="flex-1" />
          <NotificationBell />
          <ThemeToggle />
        </div>
        <Outlet />
      </main>
    </div>
  );
}
