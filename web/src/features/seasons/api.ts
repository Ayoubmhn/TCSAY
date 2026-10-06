import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export const STATUS_LABEL: Record<SeasonStatus, string> = {
  DRAFT: 'Brouillon',
  ACTIVE: 'Active',
  CLOSED: 'Clôturée',
  HISTORICAL: 'Historique',
};

/** Statuts verrouillés (R1). */
export const LOCKED_STATUSES: SeasonStatus[] = ['CLOSED', 'HISTORICAL'];

/** Transitions autorisées, identiques à l'API. */
export const TRANSITIONS: Record<SeasonStatus, SeasonStatus[]> = {
  DRAFT: ['ACTIVE', 'HISTORICAL'],
  ACTIVE: ['CLOSED'],
  CLOSED: ['ACTIVE', 'HISTORICAL'],
  HISTORICAL: ['DRAFT'],
};

export function isReopening(from: SeasonStatus, to: SeasonStatus): boolean {
  return LOCKED_STATUSES.includes(from) && !LOCKED_STATUSES.includes(to);
}

const KEY = ['seasons'] as const;

export function useSeasons(filters: SeasonFilters) {
  return useQuery({
    queryKey: [...KEY, filters],
    queryFn: () => api.get<Season[]>('/seasons', filters),
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
