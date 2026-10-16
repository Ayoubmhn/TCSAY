import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'tcsay.chunk-reload';

/**
 * Écran chargé à la demande (`React.lazy` sur un export nommé).
 * Après un déploiement, les anciens fichiers n'existent plus : la page se recharge une fois pour prendre la nouvelle version.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function page<M extends Record<K, ComponentType<any>>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  return lazy(async () => {
    try {
      const mod = await load();
      sessionStorage.removeItem(RELOAD_KEY);
      return { default: mod[name] as M[K] };
    } catch (e) {
      if (!sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, '1');
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      throw e;
    }
  });
}
