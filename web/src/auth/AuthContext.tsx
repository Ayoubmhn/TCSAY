import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { firstPath, menuFor } from '../layouts/menus';
import { api, getSpace, getToken, setStoredSpace, setToken, setUnauthorizedHandler } from '../lib/api';
import type { Actor, Me, Space } from '../lib/types';

type AuthState = {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** Parent : joueur choisi dans la liste en haut de chaque module ; joueur : lui-même. */
  playerId: string | undefined;
  setPlayerId: (id: string) => void;
  /** Changer d'espace (compte à plusieurs rôles : administration, entraîneur, parent, joueur). */
  switchSpace: (space: Space) => void;
};

const AuthContext = createContext<AuthState | null>(null);
const KID_KEY = 'tcsay-kid';

function readKid(): string | undefined {
  try {
    return localStorage.getItem(KID_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState(getToken());
  const [kid, setKid] = useState<string | undefined>(readKid());
  const [space, setSpace] = useState<Space | null>(getSpace());

  const { data: me, isPending } = useQuery({
    queryKey: ['me', token, space],
    queryFn: () => api.get<Me>('/auth/me'),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  });

  // L'API choisit l'espace par défaut si celui mémorisé n'appartient pas à ce compte.
  useEffect(() => {
    if (me && me.space !== space) {
      setStoredSpace(me.space);
      setSpace(me.space);
    }
  }, [me, space]);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setStoredSpace(null);
    setSpace(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { accessToken } = await api.post<{ accessToken: string }>('/auth/login', { email, password });
      setToken(accessToken);
      setStoredSpace(null);
      const profile = await api.get<Me>('/auth/me');
      setStoredSpace(profile.space);
      queryClient.setQueryData(['me', accessToken, profile.space], profile);
      setSpace(profile.space);
      setTokenState(accessToken);
      return profile;
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [queryClient]);

  const setPlayerId = useCallback((id: string) => {
    setKid(id);
    try {
      localStorage.setItem(KID_KEY, id);
    } catch {
      /* préférence non mémorisée */
    }
  }, []);

  const switchSpace = useCallback(
    (next: Space) => {
      setStoredSpace(next);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      setSpace(next);
    },
    [queryClient],
  );

  const value = useMemo<AuthState>(() => {
    const players = me?.players ?? [];
    const playerId = players.some((p) => p.id === kid) ? kid : players[0]?.id;
    return {
      me: token ? (me ?? null) : null,
      loading: Boolean(token) && isPending,
      login,
      logout,
      refresh,
      playerId,
      setPlayerId,
      switchSpace,
    };
  }, [me, token, isPending, login, logout, refresh, kid, setPlayerId, switchSpace]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>.');
  return ctx;
}

/** Utilisateur connecté (les écrans protégés sont toujours rendus avec un profil chargé). */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('Profil non chargé.');
  return me;
}

/** Libellé de l'espace courant. */
export const ROLE_LABEL: Record<Me['role'], string> = {
  ADMIN: 'Administration',
  COACH: 'Entraîneur',
  PARENT: 'Parent',
  PLAYER: 'Joueur',
  STAFF: 'Personnel',
};

export const SPACE_LABEL: Record<Space, string> = { admin: 'Administration', coach: 'Entraîneur', parent: 'Parent', player: 'Joueur' };

/** Acteurs (un compte peut en cumuler plusieurs). */
export const ACTOR_LABEL: Record<Actor, string> = {
  PRESIDENT: 'Président',
  ADMIN_AGENT: 'Agent administratif',
  SUPERVISOR: 'Agent superviseur',
  TECH_DIRECTOR: 'Directeur technique',
  COACH: 'Entraîneur',
  PARENT: 'Parent',
  PLAYER: 'Joueur',
};

/** Page d'accueil de l'espace : premier module autorisé du menu. */
export function homeOf(me: Me): string {
  return firstPath(menuFor(me));
}
