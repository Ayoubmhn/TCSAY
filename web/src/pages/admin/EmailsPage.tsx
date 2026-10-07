import { useQuery } from '@tanstack/react-query';
import { Card, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { EmailLog } from '../../lib/types';

const KIND: Record<EmailLog['kind'], string> = {
  CREDENTIALS: 'Identifiants',
  REMINDER: 'Rappel',
  SALARY: 'Salaire',
  RESERVATION: 'Réservation',
  OTHER: 'Information',
};

/** Emails envoyés (vMails). */
export function EmailsPage() {
  const q = useQuery({ queryKey: ['emails'], queryFn: () => api.get<EmailLog[]>('/emails') });
  return (
    <>
      <PageHeader title="Emails envoyés" subtitle="Découvrez les emails envoyés par la plateforme." />
      <div className="mt-5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid>
              {q.data.map((m) => (
                <Card key={m.id}>
                  <CardRow>
                    <h3 className="min-w-0 [overflow-wrap:anywhere]">{m.subject}</h3>
                  </CardRow>
                  <Pills>
                    <Pill tone="s">{KIND[m.kind]}</Pill>
                    <Pill tone={m.status === 'SENT' ? 'g' : 'r'}>{m.status === 'SENT' ? 'Envoyé' : 'Échec'}</Pill>
                    <Pill tone="b">{formatDateTime(m.createdAt)}</Pill>
                  </Pills>
                  <CardText>
                    <span className="[overflow-wrap:anywhere]">À : {m.to}</span>
                  </CardText>
                  {m.error && <CardText>Erreur : {m.error}</CardText>}
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun email envoyé.</EmptyState>
          )}
        </QueryState>
      </div>
      <Note>En développement, les emails sont capturés par Mailpit (interface sur le port 8025).</Note>
    </>
  );
}
