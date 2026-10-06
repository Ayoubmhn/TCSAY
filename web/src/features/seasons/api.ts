import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PillTone } from '../../components/ui/Pill';
import { api } from '../../lib/api';

export type SeasonStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'HISTORICAL';

export type Season = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: SeasonStatus;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SeasonFilters = { status?: SeasonStatus; includeArchived?: boolean };

export type SeasonInput = { label: string; startDate: string; endDate: string; status?: 'DRAFT' | 'HISTORICAL' };

/** Libellé et couleur de pastille par statut (ST du prototype). */
export const STATUS: Record<SeasonStatus, { label: string; tone: PillTone; text: string }> = {
  DRAFT: { label: 'Brouillon', tone: 's', text: 'Préparation : tarifs et groupes en cours.' },
  ACTIVE: { label: 'Active', tone: 'g', text: 'Saison en cours : inscriptions et paiements ouverts.' },
  CLOSED: { label: 'Clôturée', tone: 'r', text: 'Verrouillée : aucune modification sans réouverture.' },
  HISTORICAL: { label: 'Historique', tone: 'b', text: 'Créée pour l’import des cahiers.' },
};

/** Statuts verrouillés (R1) : ni modification ni archivage sans réouverture. */
export const LOCKED_STATUSES: SeasonStatus[] = ['CLOSED', 'HISTORICAL'];

/** Action proposée sur la carte, comme dans le prototype. */
export type SeasonAction = { kind: 'activate' | 'close' | 'reopen'; target: SeasonStatus; label: string };

export function seasonAction(status: SeasonStatus): SeasonAction {
  switch (status) {
    case 'DRAFT':
      return { kind: 'activate', target: 'ACTIVE', label: 'Activer' };
    case 'ACTIVE':
      return { kind: 'close', target: 'CLOSED', label: 'Clôturer' };
    case 'CLOSED':
      return { kind: 'reopen', target: 'ACTIVE', label: 'Rouvrir (motif)' };
    case 'HISTORICAL':
      return { kind: 'reopen', target: 'DRAFT', label: 'Rouvrir (motif)' };
  }
}

const KEY = ['seasons'] as const;

export function useSeasons(filters: SeasonFilters) {
  return useQuery({
    queryKey: [...KEY, filters],
    queryFn: () => api.get<Season[]>('/seasons', filters),
  });
}

export function useActiveSeason() {
  return useQuery({
    queryKey: [...KEY, 'active'],
    queryFn: () => api.get<Season>('/seasons/active'),
    retry: false,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: KEY });
}

export function useCreateSeason() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: SeasonInput) => api.post<Season>('/seasons', input),
    onSuccess: invalidate,
  });
}

export function useUpdateSeason() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...input }: Omit<SeasonInput, 'status'> & { id: string; version: number }) =>
      api.patch<Season>(`/seasons/${id}`, input),
    onSettled: invalidate, // en cas de conflit de version (R13), on recharge aussi
  });
}

export function useChangeSeasonStatus() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status: SeasonStatus; version: number; reason?: string }) =>
      api.post<Season>(`/seasons/${id}/status`, body),
    onSettled: invalidate,
  });
}

export function useArchiveSeason() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.delete<Season>(`/seasons/${id}`, { version }),
    onSettled: invalidate,
  });
}
