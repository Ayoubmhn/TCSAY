import { lazy, type ComponentType } from 'react';
import { isOffline } from './offline-cache';
import { slowNetwork } from './pwa';

const RELOAD_KEY = 'tcsay.chunk-reload';

/** Chargeurs de tous les écrans : préchargés avec du réseau pour qu'ils s'ouvrent ensuite sans connexion. */
const loaders: (() => Promise<unknown>)[] = [];

/** Écran introuvable sans réseau : affiché par l'écran d'erreur avec les boutons pour revenir. */
export class OfflinePageError extends Error {
  constructor() {
    super('Page pas encore enregistrée sur cet appareil.');
    this.name = 'OfflinePageError';
  }
}

/**
 * Écran chargé à la demande (`React.lazy` sur un export nommé).
 * Après un déploiement, les anciens fichiers n'existent plus : la page se recharge une fois pour prendre la nouvelle version
 * (jamais sans réseau : l'écran d'erreur s'affiche à la place d'une page noire).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function page<M extends Record<K, ComponentType<any>>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  loaders.push(load);
  return lazy(async () => {
    try {
      const mod = await load();
      sessionStorage.removeItem(RELOAD_KEY);
      return { default: mod[name] as M[K] };
    } catch (e) {
      if (!navigator.onLine || isOffline()) throw new OfflinePageError();
      if (!sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, '1');
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      // Fichier de l'écran introuvable même après rechargement : réseau absent ou coupé.
      if (/dynamically imported|module script|Failed to fetch|Load failed/i.test(String((e as Error)?.message))) throw new OfflinePageError();
      throw e;
    }
  });
}

let preloaded = false;

/** Télécharge tous les écrans en tâche de fond (gardés par le service worker et le navigateur). */
export async function preloadPages() {
  // Réseau lent ou économie de données : les écrans se téléchargent seulement quand on les ouvre.
  if (preloaded || !navigator.onLine || slowNetwork()) return;
  preloaded = true;
  for (const load of loaders) {
    if (!navigator.onLine) {
      preloaded = false;
      return;
    }
    await load().catch(() => undefined);
  }
}
