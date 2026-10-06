import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'tcsay-theme';

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Applique le thème mémorisé au chargement (avant le premier rendu). */
export function applyStoredTheme(): void {
  const stored = readStored();
  if (stored) document.documentElement.dataset.theme = stored;
}

/** Bascule clair / sombre du prototype : « ☾ Sombre » ou « ☀ Clair ». */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readStored() ?? systemTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* stockage indisponible : le thème vaut pour la session */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Changer de thème"
      className="rounded-full bg-btn px-3 py-1.5 text-[12.5px] font-medium text-fg"
    >
      {theme === 'dark' ? '☀ Clair' : '☾ Sombre'}
    </button>
  );
}
