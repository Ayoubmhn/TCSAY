import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { MenuButton } from '../components/ui/MenuButton';
import { Pill } from '../components/ui/Pill';
import { ADMIN_MENU } from './adminMenu';

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Menu principal" className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center gap-3 px-2 pb-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-pill-green text-sm font-semibold text-pill-ink">
          TC
        </span>
        <div className="leading-tight">
          <p className="font-semibold">TCSAY</p>
          <p className="text-xs text-mut">Tennis Club de Sayada</p>
        </div>
      </div>

      <p className="px-3 text-xs font-semibold tracking-wider text-mut">MAIN</p>
      <ul className="flex flex-col gap-1">
        {ADMIN_MENU.map((entry) => (
          <li key={entry.path}>
            <NavLink
              to={entry.path}
              end={entry.path === '/admin'}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center justify-between gap-2 rounded-[18px] px-4 py-2.5 text-sm font-medium ${
                  isActive ? 'bg-fg text-bg' : 'text-fg hover:bg-fld'
                }`
              }
            >
              <span>{entry.label}</span>
              {entry.soon && (
                <Pill tone="sand" small>
                  À venir
                </Pill>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      {/* Carte utilisateur : branchée sur l'authentification au prochain lot. */}
      <div className="mt-auto rounded-[24px] border-[1.5px] border-line bg-card p-4">
        <p className="text-sm font-medium">Administrateur</p>
        <p className="text-xs text-mut">Connexion à venir</p>
        <button
          type="button"
          disabled
          className="mt-3 w-full rounded-full bg-btn px-4 py-2 text-sm font-medium opacity-50"
        >
          Déconnexion
        </button>
      </div>
    </nav>
  );
}

/** Mise en page admin : menu latéral 266px, en tiroir glissant avec voile sous 860px. */
export function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-dvh bg-bg">
      {/* Menu fixe (≥ 860px) */}
      <aside className="fixed inset-y-0 left-0 hidden w-[266px] border-r-[1.5px] border-line bg-dr min-[860px]:block">
        <Sidebar />
      </aside>

      {/* Tiroir (< 860px) */}
      <div
        className={`fixed inset-0 z-40 bg-black/45 transition-opacity min-[860px]:hidden ${
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[266px] bg-dr transition-transform min-[860px]:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
      >
        <Sidebar onNavigate={() => setDrawerOpen(false)} />
      </aside>

      <div className="min-[860px]:pl-[266px]">
        <header className="flex items-center gap-3 px-4 pt-4 min-[860px]:hidden">
          <MenuButton expanded={drawerOpen} onClick={() => setDrawerOpen((v) => !v)} />
          <span className="font-semibold">TCSAY</span>
        </header>
        <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
