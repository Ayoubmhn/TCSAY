import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useToast } from '../components/ui/Toast';
import { errorMessage } from './api';

type Options<TResult, TVars> = {
  /** Requêtes à recharger après succès comme après erreur (R13 : on relit la version). */
  invalidate?: QueryKey[];
  /** Toast de succès (texte fixe ou calculé ; texte vide = pas de toast). */
  success?: string | ((result: TResult, vars: TVars) => string | undefined);
  onSuccess?: (result: TResult, vars: TVars) => void;
};

/** Mutation standard : erreurs API en toast (jamais seulement en console), succès en toast, rechargement des listes. */
export function useAction<TVars = void, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, options: Options<TResult, TVars> = {}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, vars) => {
      const message = typeof options.success === 'function' ? options.success(result, vars) : options.success;
      if (message) toast(message);
      options.onSuccess?.(result, vars);
    },
    onError: (error) => toast(errorMessage(error)),
    onSettled: () => {
      for (const key of options.invalidate ?? []) void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
