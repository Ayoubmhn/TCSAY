import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { MenuButton } from '../components/ui/MenuButton';
import { Badge } from '../components/ui/Pill';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { ADMIN_MENU } from './adminMenu';

/** Contenu du menu latéral (.side) : marque, « MAIN », entrées, carte utilisateur. */
function SideContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2.5 px-1.5">
        <div aria-hidden="true" className="grid h-[38px] w-[38px] place-items-center rounded-full bg-pg text-[13px] font-semibold text-ink">
          TC
        </div>
        <div>
          <b className="block font-semibold">TCSAY</b>
          <span className="text-xs text-mut">Tennis Club de Sayada</span>
        </div>
      </div>

      <div className="px-2.5 text-xs font-semibold tracking-[0.12em] text-mut">MAIN</div>

      <nav className="flex flex-col gap-1" aria-label="Navigation">
        {ADMIN_MENU.map((entry) => (
          <NavLink
            key={entry.path}
            to={entry.path}
            end={entry.path === '/admin'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center justify-between gap-2 rounded-[18px] px-3.5 py-[11px] text-left font-medium ${
                isActive ? 'bg-fg text-bg' : 'text-fg hover:bg-btn'
              }`
            }
          >
            <span>{entry.label}</span>
            {entry.soon && <Badge>À venir</Badge>}
          </NavLink>
        ))}
      </nav>

      {/* Carte utilisateur (.ucard) : branchée sur l'authentification au prochain lot. */}
      <div className="mt-auto flex flex-col gap-2.5 rounded-[24px] border-[1.5px] border-line bg-card p-3.5">
        <div className="flex items-center gap-2.5">
          <div aria-hidden="true" className="grid h-10 w-10 flex-none place-items-center rounded-[14px] bg-fld text-sm font-semibold">
            AD
          </div>
          <div>
            <b className="font-semibold">Admin</b>
            <div className="text-[12.5px] text-mut">Administrateur</div>
          </div>
        </div>
        <button
          type="button"
          disabled
          title="Disponible avec l’authentification"
          className="rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg disabled:opacity-45"
        >
          Déconnexion
        </button>
      </div>
    </>
  );
}

const SIDE = 'flex flex-col gap-[18px] overflow-y-auto border-r-[1.5px] border-line bg-dr px-4 py-[22px]';

/** Shell admin (.app) : menu 266px + zone principale ; tiroir 268px avec voile sous 860px. */
export function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="grid min-h-full grid-cols-1 nav:grid-cols-[266px_minmax(0,1fr)]">
      {/* Menu fixe (> 860px) */}
      <aside aria-label="Menu principal" className={`${SIDE} sticky top-0 hidden h-screen nav:flex`}>
        <SideContent />
      </aside>

      {/* Tiroir (≤ 860px) */}
      <div
        aria-hidden="true"
        onClick={() => setDrawerOpen(false)}
        className={`fixed inset-0 z-[39] bg-veil nav:hidden ${drawerOpen ? 'block' : 'hidden'}`}
      />
      <aside
        aria-label="Menu principal"
        inert={!drawerOpen}
        className={`drawer ${SIDE} fixed inset-y-0 left-0 z-40 w-[268px] pt-[calc(22px+env(safe-area-inset-top,0px))] transition-transform duration-250 ease-in-out nav:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-[105%]'
        }`}
      >
        <SideContent onNavigate={() => setDrawerOpen(false)} />
      </aside>

      <main className="min-w-0 px-[clamp(16px,3.5vw,40px)] pt-[22px] pb-[60px]">
        <div className="mb-[22px] flex items-center gap-3">
          <MenuButton expanded={drawerOpen} onClick={() => setDrawerOpen((v) => !v)} />
          <span className="flex-1" />
          <ThemeToggle />
        </div>
        <Outlet />
      </main>
    </div>
  );
}
