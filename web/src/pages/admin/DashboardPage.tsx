import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useMe } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardSubtitle, CardText, EmptyState, Kpi } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/InstallmentCard';
import { QueryState } from '../../components/ui/Loading';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { DT, fD } from '../../lib/format';
import type { Dashboard } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const LINK_BTN = 'inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg';

/** Dashboard admin (vDash). */
export function DashboardPage() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard') });
  const remind = useAction((id: string) => api.post<{ sentTo: string }>(`/installments/${id}/remind`), {
    invalidate: [['emails']],
    success: (r) => `Rappel envoyé à ${r.sentTo}.`,
  });
  const d = q.data;
  const me = useMe();
  const canAuthorize = me.permissions.includes('permissions.manage');
  const canCollect = me.permissions.includes('payments.collect');

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={d ? `Vue d’ensemble de la saison ${d.season.label}.` : 'Vue d’ensemble de la saison.'}
        action={d && <Pill tone="g">Saison active {d.season.label}</Pill>}
      />
      <div className="mt-5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {d && (
            <>
              <CardGrid>
                <Card>
                  <CardSubtitle>Joueurs actifs</CardSubtitle>
                  <Kpi>{d.activePlayers}</Kpi>
                  <CardText>
                    {d.groupsCount} groupes · {d.coachesCount} entraîneurs
                  </CardText>
                </Card>
                <Card>
                  <CardSubtitle>Encaissé cette saison</CardSubtitle>
                  <Kpi>{DT(d.cashed)}</Kpi>
                  <CardText>{d.paymentsCount} paiements enregistrés</CardText>
                </Card>
                <Card>
                  <CardSubtitle>Tranches en retard</CardSubtitle>
                  <Kpi>{d.late.length}</Kpi>
                  <Pills>{d.late.length ? <Pill tone="r">{DT(d.lateAmount)} dus</Pill> : <Pill tone="g">Aucune</Pill>}</Pills>
                </Card>
                <Card>
                  <CardSubtitle>Réservations demain</CardSubtitle>
                  <Kpi>{d.reservationsTomorrow}</Kpi>
                  <CardText>{fD(d.tomorrow, { weekday: 'long', day: 'numeric', month: 'long' })}</CardText>
                </Card>
              </CardGrid>

              {canAuthorize && (
                <Section title="Autorisations">
                  <Card>
                    <CardRow>
                      <h3>Droits des rôles et des comptes</h3>
                      <Pill tone="s">Président</Pill>
                    </CardRow>
                    <CardText>
                      Choisissez ce que peuvent faire l’agent administratif, l’agent superviseur et le directeur technique, et
                      attribuez les rôles des comptes.
                    </CardText>
                    <CardActions>
                      <Link className={LINK_BTN} to="/admin/autorisations">
                        Gérer les autorisations
                      </Link>
                    </CardActions>
                  </Card>
                </Section>
              )}

              <Section title="Tranches à relancer">
                {d.late.length ? (
                  <CardGrid>
                    {d.late.map((i) => (
                      <Card key={i.id}>
                        <CardRow>
                          <h3>
                            {i.player.firstName} {i.player.lastName}
                          </h3>
                          <Pill tone="r">En retard</Pill>
                        </CardRow>
                        <Pills>
                          <Pill tone="b">
                            Tranche {i.number}/{i.count}
                          </Pill>
                          <Pill tone="b">Échéance {fD(i.dueDate, { day: 'numeric', month: 'short' })}</Pill>
                        </Pills>
                        <CardText>Restant {DT(i.remaining)}</CardText>
                        {canCollect && (
                          <CardActions>
                            <Link className={LINK_BTN} to="/admin/paiements">
                              Encaisser
                            </Link>
                            <Button onClick={() => remind.mutate(i.id)} disabled={remind.isPending}>
                              Envoyer un rappel
                            </Button>
                          </CardActions>
                        )}
                      </Card>
                    ))}
                  </CardGrid>
                ) : (
                  <EmptyState>Aucune tranche en retard.</EmptyState>
                )}
              </Section>

              <Section title="Groupes">
                <CardGrid>
                  {d.groups.map((g) => (
                    <Card key={g.id}>
                      <CardRow>
                        <h3>{g.name}</h3>
                        <Pill tone={g.members >= g.capacity ? 'r' : 'g'}>
                          {g.members}/{g.capacity}
                        </Pill>
                      </CardRow>
                      <ProgressBar value={g.members} max={g.capacity} />
                    </Card>
                  ))}
                </CardGrid>
              </Section>
            </>
          )}
        </QueryState>
      </div>
    </>
  );
}
