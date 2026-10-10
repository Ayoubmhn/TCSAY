import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardSubtitle, CardText, EmptyState, Kpi } from '../../components/ui/Card';
import { FilterSelect, Filters, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills, type PillTone } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { EmailLog, EmailStatus, MailConfig } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const KIND: Record<EmailLog['kind'], string> = {
  CREDENTIALS: 'Identifiants',
  REMINDER: 'Rappel',
  SALARY: 'Salaire',
  RESERVATION: 'Réservation',
  OTHER: 'Information',
};

const STATUS: Record<EmailStatus, { label: string; tone: PillTone }> = {
  PENDING: { label: 'En attente', tone: 's' },
  SENT: { label: 'Envoyé', tone: 'g' },
  FAILED: { label: 'Échec', tone: 'r' },
};

const SECURITY: Record<MailConfig['security'], string> = {
  tls: 'TLS (port 465)',
  starttls: 'STARTTLS (port 587)',
  none: 'Sans chiffrement',
};

const KEYS = [['emails'], ['emails-config']];

/** Serveur d'envoi, compteurs de la file, email de test et renvoi des échecs. */
function MailServerCard({ config }: { config: MailConfig }) {
  const toast = useToast();
  const { me } = useAuth();
  const [to, setTo] = useState(me?.email ?? '');
  const test = useAction(() => api.post<{ sentTo: string }>('/emails/test', { to: to.trim() }), {
    invalidate: KEYS,
    success: (r) => `Email de test envoyé à ${r.sentTo}.`,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+$/.test(to.trim())) return toast('Adresse email invalide.');
    test.mutate();
  };
  return (
    <>
      <Card>
        <CardRow>
          <h3>Serveur d’envoi</h3>
          <Pill tone={config.devCapture ? 's' : 'g'}>{config.devCapture ? 'Mailpit (développement)' : 'Production'}</Pill>
        </CardRow>
        <Pills>
          <Pill tone="b">
            {config.host}:{config.port}
          </Pill>
          <Pill tone="b">{SECURITY[config.security]}</Pill>
          <Pill tone={config.auth ? 'g' : 's'}>{config.auth ? `Compte ${config.user}` : 'Sans authentification'}</Pill>
        </Pills>
        <CardText>
          Expéditeur : {config.fromName} &lt;{config.from}&gt;
          {config.replyTo ? ` · réponses à ${config.replyTo}` : ''}
        </CardText>
        <CardText>Liens des emails : {config.appUrl}</CardText>
        {config.auth && !config.passwordSet && <Pill tone="r">Mot de passe SMTP manquant (SMTP_PASS)</Pill>}
      </Card>
      <Card>
        <CardSubtitle>File d’envoi</CardSubtitle>
        <Kpi>{config.sent}</Kpi>
        <Pills>
          <Pill tone="g">{config.sent} envoyé(s)</Pill>
          <Pill tone="s">{config.pending} en attente</Pill>
          <Pill tone={config.failed ? 'r' : 'g'}>{config.failed} échec(s)</Pill>
        </Pills>
      </Card>
      <Card>
        <CardSubtitle>Tester la configuration</CardSubtitle>
        <form className="flex flex-col gap-2.5" onSubmit={submit}>
          <TextField label="Envoyer un email de test à" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button variant="primary" type="submit" disabled={test.isPending}>
            {test.isPending ? 'Envoi…' : 'Envoyer le test'}
          </Button>
        </form>
      </Card>
    </>
  );
}

/** Emails envoyés (vMails) : configuration SMTP, file d'envoi, historique, renvoi des échecs. */
export function EmailsPage() {
  const [status, setStatus] = useState<'' | EmailStatus>('');
  // Tant que des emails attendent, compteurs et liste se mettent à jour seuls.
  const config = useQuery({
    queryKey: ['emails-config'],
    queryFn: () => api.get<MailConfig>('/emails/config'),
    refetchInterval: (query) => (query.state.data?.pending ? 2000 : false),
  });
  const q = useQuery({
    queryKey: ['emails', status],
    queryFn: () => api.get<EmailLog[]>('/emails', { status: status || undefined }),
    refetchInterval: (query) => (query.state.data?.some((m) => m.status === 'PENDING') || config.data?.pending ? 2000 : false),
  });

  const resend = useAction((id: string) => api.post(`/emails/${id}/resend`), { invalidate: KEYS, success: 'Email remis dans la file d’envoi.' });
  const resendAll = useAction(() => api.post<{ queued: number }>('/emails/resend-failed'), {
    invalidate: KEYS,
    success: (r) => `${r.queued} email(s) remis dans la file d’envoi.`,
  });
  const failed = config.data?.failed ?? 0;

  return (
    <>
      <PageHeader title="Emails envoyés" subtitle="Découvrez les emails envoyés par la plateforme." />
      <Section title="Messagerie">
        <QueryState isPending={config.isPending} error={config.error} refetch={config.refetch}>
          {config.data && (
            <CardGrid>
              <MailServerCard config={config.data} />
            </CardGrid>
          )}
        </QueryState>
      </Section>

      <Section title="Historique">
        <Filters>
          <FilterSelect label="Statut" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">Tous les statuts</option>
            <option value="SENT">Envoyés</option>
            <option value="PENDING">En attente</option>
            <option value="FAILED">Échecs</option>
          </FilterSelect>
          {failed > 0 && (
            <Button onClick={() => resendAll.mutate()} disabled={resendAll.isPending}>
              Renvoyer les échecs ({failed})
            </Button>
          )}
        </Filters>
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
                    <Pill tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Pill>
                    <Pill tone="b">{formatDateTime(m.sentAt ?? m.createdAt)}</Pill>
                    {m.attempts > 1 && <Pill tone="s">{m.attempts} tentatives</Pill>}
                  </Pills>
                  <CardText>
                    <span className="[overflow-wrap:anywhere]">À : {m.to}</span>
                  </CardText>
                  {m.error && (
                    <CardText>
                      <span className="[overflow-wrap:anywhere]">Erreur : {m.error}</span>
                    </CardText>
                  )}
                  {m.status === 'FAILED' && (
                    <CardActions>
                      <Button onClick={() => resend.mutate(m.id)} disabled={resend.isPending}>
                        Renvoyer
                      </Button>
                    </CardActions>
                  )}
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun email.</EmptyState>
          )}
        </QueryState>
      </Section>
      <Note>
        Les emails partent en arrière-plan, un par un : une action (création de compte, paiement…) n’attend jamais le
        serveur. Le serveur se règle dans <b>api/.env</b> (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM), puis
        redémarrage de l’API. En développement, Mailpit capture tout (interface sur le port 8025).
      </Note>
    </>
  );
}
