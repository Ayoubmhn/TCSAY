import type { ReactNode } from 'react';
import { errorMessage } from '../../lib/api';
import { Button } from './Button';
import { EmptyState } from './Card';

/** États de chargement / erreur d'une requête, sinon le contenu. */
export function QueryState({
  isPending,
  error,
  refetch,
  children,
}: {
  isPending: boolean;
  error: unknown;
  refetch?: () => unknown;
  children: ReactNode;
}) {
  if (isPending) return <EmptyState>Chargement…</EmptyState>;
  if (error) {
    return (
      <EmptyState>
        <p className="mt-0">{errorMessage(error)}</p>
        {refetch && <Button onClick={() => refetch()}>Réessayer</Button>}
      </EmptyState>
    );
  }
  return <>{children}</>;
}
