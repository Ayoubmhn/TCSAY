import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'tcsay-theme';
const EVENT = 'tcsay-theme';

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

/** Change le thème partout (bascule de l'en-tête et page Paramètres restent synchronisées). */
export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* stockage indisponible : le thème vaut pour la session */
  }
  window.dispatchEvent(new CustomEvent<Theme>(EVENT, { detail: theme }));
}

/** Thème courant, mis à jour quand il change ailleurs. */
export function useTheme(): Theme {
  const [theme, setState] = useState<Theme>(() => readStored() ?? systemTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const on = (e: Event) => setState((e as CustomEvent<Theme>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [theme]);
  return theme;
}

/** Bascule clair / sombre du prototype : « ☾ Sombre » ou « ☀ Clair ». */
export function ThemeToggle() {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label={t('Changer de thème')}
      className="rounded-full bg-btn px-3 py-1.5 text-[12.5px] font-medium text-fg"
    >
      {t(theme === 'dark' ? '☀ Clair' : '☾ Sombre')}
    </button>
  );
}
