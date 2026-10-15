import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ApiError,
  api,
  getStoredKid,
  getToken,
  loadSession,
  setStoredKid,
  setStoredSpace,
  setToken,
  setUnauthorizedHandler,
  type Space,
} from '../lib/api';
import type { Me } from '../lib/types';

type AuthState = {
  /** Session lue sur le téléphone (au démarrage). */
  ready: boolean;
  me: Me | null;
  loading: boolean;
  /** Session gardée mais serveur injoignable. */
  offline: boolean;
  retry: () => void;
  login: (email: string, password: string, remember: boolean) => Promise<Me>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** Joueur suivi (parent : enfant choisi ; joueur : lui-même). */
  playerId: string | undefined;
  setPlayerId: (id: string) => void;
  switchSpace: (space: Space) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);
  const [space, setSpace] = useState<Space | null>(null);
  const [kid, setKid] = useState<string | undefined>();

  useEffect(() => {
    void loadSession().then((s) => {
      setTokenState(s.token);
      setSpace(s.space);
      setKid(s.kid ?? undefined);
      setReady(true);
    });
  }, []);

  const { data: me, isPending, error, refetch } = useQuery({
    queryKey: ['me', token, space],
    queryFn: () => api.get<Me>('/auth/me'),
    enabled: ready && Boolean(token),
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
    async (email: string, password: string, remember: boolean) => {
      const { accessToken } = await api.post<{ accessToken: string }>('/auth/login', { email, password, remember });
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
    setStoredKid(id);
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
    const chosen = kid ?? getStoredKid() ?? undefined;
    const playerId = me?.role === 'PLAYER' && me.playerId ? me.playerId : players.some((p) => p.id === chosen) ? chosen : players[0]?.id;
    return {
      ready,
      me: token ? (me ?? null) : null,
      loading: !ready || (Boolean(token) && isPending),
      offline: Boolean(token) && !me && error instanceof ApiError && error.status === 0,
      retry: () => void refetch(),
      login,
      logout,
      refresh,
      playerId,
      setPlayerId,
      switchSpace,
    };
  }, [ready, me, token, isPending, error, refetch, login, logout, refresh, kid, setPlayerId, switchSpace]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider manquant');
  return ctx;
}

/** Compte connecté (écrans protégés seulement). */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('Session absente');
  return me;
}

export const getAuthToken = getToken;
