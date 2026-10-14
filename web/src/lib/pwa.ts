import { useEffect, useState } from 'react';

/** Événement « beforeinstallprompt » (Chrome, Edge, Samsung Internet) : proposer l'installation au bon moment. */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Enregistre le service worker (production seulement : en développement, Vite recharge les fichiers lui-même). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  if (!import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

/** L'application tourne-t-elle installée (écran d'accueil) ? */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export const isIos = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Installation : disponible (Android / ordinateur), à faire à la main (iPhone : Partager › Sur l'écran d'accueil), ou déjà faite. */
export function useInstall() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const installed = isStandalone();
  return {
    installed,
    canPrompt: Boolean(deferred) && !installed,
    iosManual: isIos() && !installed,
    install: async () => {
      if (!deferred) return false;
      await deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      notify();
      return choice.outcome === 'accepted';
    },
  };
}
