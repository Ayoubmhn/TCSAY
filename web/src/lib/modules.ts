import { useAuth } from '../auth/AuthContext';
import type { Me, ModuleKey } from './types';

/**
 * Modules activables (version du club) : la liste des modules coupés vient du serveur (`disabledModules` du profil,
 * réglée par MODULES_COUPES à l'installation). Plusieurs clés : allumé si l'un d'eux l'est.
 */
export function moduleOn(me: Pick<Me, 'disabledModules'> | null | undefined, keys: ModuleKey | ModuleKey[]): boolean {
  const off = me?.disabledModules ?? [];
  return (Array.isArray(keys) ? keys : [keys]).some((k) => !off.includes(k));
}

/** Module allumé pour le compte connecté (avant la connexion : tout est allumé, l'API refuse de toute façon). */
export function useModule(keys: ModuleKey | ModuleKey[]): boolean {
  return moduleOn(useAuth().me, keys);
}
