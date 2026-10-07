import { useQuery } from '@tanstack/react-query';
import { Card, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { AuditEntry } from '../../lib/types';

/** Journal d'audit (vAudit) : lecture seule. */
export function AuditPage() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api.get<AuditEntry[]>('/audit') });
  return (
    <>
      <PageHeader title="Journal d’audit" subtitle="Découvrez qui a modifié quoi, quand et pourquoi." />
      <div className="mt-5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid>
              {q.data.map((a) => (
                <Card key={a.id}>
                  <CardRow>
                    <h3>{a.action}</h3>
                  </CardRow>
                  <Pills>
                    <Pill tone="b">{formatDateTime(a.createdAt)}</Pill>
                    <Pill tone="s">{a.who}</Pill>
                  </Pills>
                  <span className="text-sm [overflow-wrap:anywhere]">{a.target}</span>
                  {(a.before || a.after) && (
                    <Pills>
                      {a.before && <Pill tone="r" className="whitespace-normal">Avant : {a.before}</Pill>}
                      {a.after && <Pill tone="g" className="whitespace-normal">Après : {a.after}</Pill>}
                    </Pills>
                  )}
                  {a.reason && <CardText>Motif : {a.reason}</CardText>}
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucune entrée.</EmptyState>
          )}
        </QueryState>
      </div>
      <Note>Lecture seule. Chaque modification sensible y est enregistrée automatiquement.</Note>
    </>
  );
}
