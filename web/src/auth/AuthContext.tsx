import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from '../lib/api';
import type { Me } from '../lib/types';

type AuthState = {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** Parent : joueur choisi dans la liste en haut de chaque module ; joueur : lui-même. */
  playerId: string | undefined;
  setPlayerId: (id: string) => void;
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

  const { data: me, isPending } = useQuery({
    queryKey: ['me', token],
    queryFn: () => api.get<Me>('/auth/me'),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  });

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { accessToken } = await api.post<{ accessToken: string }>('/auth/login', { email, password });
      setToken(accessToken);
      const profile = await api.get<Me>('/auth/me');
      queryClient.setQueryData(['me', accessToken], profile);
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
    };
  }, [me, token, isPending, login, logout, refresh, kid, setPlayerId]);

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

export const ROLE_LABEL: Record<Me['role'], string> = {
  ADMIN: 'Administrateur',
  COACH: 'Coach',
  PARENT: 'Parent',
  PLAYER: 'Joueur',
  STAFF: 'Personnel',
};

/** Page d'accueil de chaque rôle. */
export function homeOf(role: Me['role']): string {
  if (role === 'ADMIN') return '/admin';
  if (role === 'COACH') return '/coach/seances';
  if (role === 'STAFF') return '/staff/planning';
  return '/';
}
