import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { useMe } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card, CardGrid, CardRow, CardSubtitle, CardText, EmptyState, Kpi } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { ProgressBar } from '../../components/ui/InstallmentCard';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { DT, fD } from '../../lib/format';
import { useAction } from '../../lib/useAction';
import { useSeasons } from '../seasons/api';

type Bucket = { count: number; amount: number };
type FinanceStats = {
  season: { id: string; label: string; status: string };
  previous: { id: string; label: string } | null;
  today: string;
  summary: { due: number; cashed: number; remaining: number; rate: number | null; memberships: number; prevCashedToDate: number | null; comparedToDate: boolean };
  months: { month: string; cotisations: number; reservations: number; previous: number | null }[];
  forecast: { d30: number; d60: number; d90: number; later: number };
  aging: { lt30: Bucket; d30to60: Bucket; gt60: Bucket };
  toRemind: {
    playerId: string;
    name: string;
    code: string | null;
    contact: string | null;
    phone: string | null;
    canEmail: boolean;
    amount: number;
    installments: number;
    daysLate: number;
    oldestInstallmentId: string;
    oldestDue: string;
  }[];
  discounts: { byKind: { SIBLING: Bucket; SPECIAL: Bucket; EXEMPT: Bucket }; total: number; base: number };
  methods: { CASH: Bucket; CHEQUE: Bucket; ONLINE: Bucket };
  refunds: number;
  plans: { FULL: number; SEMESTER: number; MONTHLY: number };
  balance: { cotisations: number; reservations: number; salariesPaid: number; salariesDue: number; net: number };
};

const LINK_BTN = 'inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg';
const monthLabel = (m: string, long = false) => fD(`${m}-01`, long ? { month: 'long', year: 'numeric' } : { month: 'short' });
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/** Écart avec la saison précédente : « +12 % » (vert) ou « −8 % » (rose). */
function Trend({ now, before, label }: { now: number; before: number | null; label: string }) {
  if (before === null) return null;
  if (before === 0) return <Pill tone="s">{label} : pas de donnée</Pill>;
  const diff = Math.round(((now - before) / before) * 100);
  return (
    <Pill tone={diff >= 0 ? 'g' : 'r'}>
      {diff >= 0 ? '+' : '−'}
      {Math.abs(diff)} % {label}
    </Pill>
  );
}

/** Barres par mois (faites main) : cotisations + réservations empilées, trait gris = saison précédente. */
function MonthlyChart({ months, previous }: { months: FinanceStats['months']; previous: string | null }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.cotisations + m.reservations, m.previous ?? 0)));
  const h = (v: number) => `${(v / max) * 100}%`;
  const total = months.reduce((t, m) => t + m.cotisations + m.reservations, 0);

  return (
    <>
      <div className="overflow-x-auto" role="img" aria-label={`Encaissements par mois, ${DT(Math.round(total))} au total`}>
        <div className="flex min-w-[520px] items-stretch gap-2" aria-hidden="true">
          {months.map((m) => {
            const tip = `${monthLabel(m.month, true)} : cotisations ${DT(m.cotisations)}, réservations ${DT(m.reservations)}${m.previous !== null ? `, saison précédente ${DT(m.previous)}` : ''}`;
            return (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1.5" title={tip}>
                <div className="relative flex h-[170px] w-full max-w-[34px] flex-col justify-end border-b-[1.5px] border-line">
                  {m.reservations > 0 && <i className="block w-full rounded-t-md bg-pri opacity-35" style={{ height: h(m.reservations) }} />}
                  {m.cotisations > 0 && <i className={`block w-full bg-pri ${m.reservations > 0 ? '' : 'rounded-t-md'}`} style={{ height: h(m.cotisations) }} />}
                  {m.previous !== null && m.previous > 0 && (
                    <i className="absolute -inset-x-1 h-[3px] rounded-full bg-mut" style={{ bottom: h(m.previous) }} />
                  )}
                </div>
                <span className="text-[11px] text-mut">{monthLabel(m.month)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <Pills className="mt-3">
        <Pill tone="b">
          <i className="me-1.5 inline-block size-2.5 rounded-full bg-pri align-middle" aria-hidden="true" />
          Cotisations
        </Pill>
        <Pill tone="b">
          <i className="me-1.5 inline-block size-2.5 rounded-full bg-pri align-middle opacity-35" aria-hidden="true" />
          Réservations
        </Pill>
        {previous && (
          <Pill tone="s">
            <i className="me-1.5 inline-block h-[3px] w-3 rounded-full bg-mut align-middle" aria-hidden="true" />
            Saison {previous}
          </Pill>
        )}
      </Pills>
      <ul className="sr-only">
        {months.map((m) => (
          <li key={m.month}>
            {monthLabel(m.month, true)} : cotisations {DT(m.cotisations)}, réservations {DT(m.reservations)}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Ligne libellé + barre + valeur. */
function BarRow({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  return (
    <div className="grid grid-cols-[minmax(110px,170px)_1fr_auto] items-center gap-3 text-sm">
      <span className="truncate">{label}</span>
      <ProgressBar value={value} max={Math.max(1, max)} />
      <b className="font-semibold tabular-nums">{text}</b>
    </div>
  );
}

/** Statistiques financières d'une saison (bloc Finances). */
export function FinanceStatsPage() {
  const [params, setParams] = useSearchParams();
  const seasonId = params.get('saison') ?? '';
  const seasons = useSeasons({});
  const q = useQuery({
    queryKey: ['finance-stats', seasonId],
    queryFn: () => api.get<FinanceStats>('/stats/finances', seasonId ? { seasonId } : undefined),
  });
  const me = useMe();
  const canCollect = me.permissions.includes('payments.collect');
  const remind = useAction((id: string) => api.post<{ sentTo: string }>(`/installments/${id}/remind`), {
    invalidate: [['emails']],
    success: (r) => `Rappel envoyé à ${r.sentTo}.`,
  });
  const d = q.data;

  const agingTotal = d ? d.aging.lt30.amount + d.aging.d30to60.amount + d.aging.gt60.amount : 0;
  const forecastMax = d ? Math.max(d.forecast.d30, d.forecast.d60, d.forecast.d90, d.forecast.later) : 0;
  const methodsTotal = d ? d.methods.CASH.amount + d.methods.CHEQUE.amount + d.methods.ONLINE.amount : 0;
  const plansTotal = d ? d.plans.FULL + d.plans.SEMESTER + d.plans.MONTHLY : 0;

  return (
    <>
      <PageHeader
        title="Statistiques financières"
        subtitle="Découvrez les encaissements, les retards et les réductions de la saison."
        action={d && <Pill tone="g">Saison {d.season.label}</Pill>}
      />
      <Filters>
        <FilterSelect
          label="Saison"
          value={seasonId || d?.season.id || ''}
          onChange={(e) => setParams(e.target.value ? { saison: e.target.value } : {}, { replace: true })}
        >
          {(seasons.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              Saison {s.label}
            </option>
          ))}
        </FilterSelect>
      </Filters>

      <div className="mt-4">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {d && (
            <>
              <CardGrid>
                <Card>
                  <CardSubtitle>Cotisations encaissées</CardSubtitle>
                  <Kpi>{DT(d.summary.cashed)}</Kpi>
                  <CardText>
                    sur {DT(d.summary.due)} dus{d.summary.rate !== null ? ` · ${d.summary.rate} %` : ''}
                  </CardText>
                  {d.summary.due > 0 && <ProgressBar value={d.summary.cashed} max={d.summary.due} />}
                  <Pills>
                    <Trend now={d.summary.cashed} before={d.summary.prevCashedToDate} label={d.summary.comparedToDate ? 'vs l’an passé à la même date' : `vs saison ${d.previous?.label ?? 'précédente'}`} />
                  </Pills>
                </Card>
                <Card>
                  <CardSubtitle>Reste à encaisser</CardSubtitle>
                  <Kpi>{DT(d.summary.remaining)}</Kpi>
                  <Pills>
                    {agingTotal > 0 ? <Pill tone="r">{DT(Math.round(agingTotal * 1000) / 1000)} en retard</Pill> : <Pill tone="g">Aucun retard</Pill>}
                  </Pills>
                </Card>
                <Card>
                  <CardSubtitle>Réductions accordées</CardSubtitle>
                  <Kpi>{DT(d.discounts.total)}</Kpi>
                  <CardText>
                    {pct(d.discounts.total, d.discounts.base)} % des tarifs ·{' '}
                    {d.discounts.byKind.SIBLING.count + d.discounts.byKind.SPECIAL.count + d.discounts.byKind.EXEMPT.count} joueur(s)
                  </CardText>
                </Card>
                <Card>
                  <CardSubtitle>Bilan de la saison</CardSubtitle>
                  <Kpi>{DT(d.balance.net)}</Kpi>
                  <CardText>recettes − salaires versés</CardText>
                </Card>
              </CardGrid>

              <Section title="Encaissements par mois">
                <Card>
                  {d.months.length ? <MonthlyChart months={d.months} previous={d.previous?.label ?? null} /> : <EmptyState>Aucun mois à afficher.</EmptyState>}
                </Card>
              </Section>

              <Section title="Retards et prévisions">
                <CardGrid>
                  <Card>
                    <CardRow>
                      <h3>Retards par ancienneté</h3>
                      <Pill tone="r">{d.aging.lt30.count + d.aging.d30to60.count + d.aging.gt60.count} tranche(s)</Pill>
                    </CardRow>
                    <div className="mt-3 flex flex-col gap-2.5">
                      <BarRow label="Moins de 30 jours" value={d.aging.lt30.amount} max={agingTotal} text={DT(d.aging.lt30.amount)} />
                      <BarRow label="30 à 60 jours" value={d.aging.d30to60.amount} max={agingTotal} text={DT(d.aging.d30to60.amount)} />
                      <BarRow label="Plus de 60 jours" value={d.aging.gt60.amount} max={agingTotal} text={DT(d.aging.gt60.amount)} />
                    </div>
                  </Card>
                  <Card>
                    <CardRow>
                      <h3>À encaisser bientôt</h3>
                      <Pill tone="b">Échéances à venir</Pill>
                    </CardRow>
                    <div className="mt-3 flex flex-col gap-2.5">
                      <BarRow label="Sous 30 jours" value={d.forecast.d30} max={forecastMax} text={DT(d.forecast.d30)} />
                      <BarRow label="31 à 60 jours" value={d.forecast.d60} max={forecastMax} text={DT(d.forecast.d60)} />
                      <BarRow label="61 à 90 jours" value={d.forecast.d90} max={forecastMax} text={DT(d.forecast.d90)} />
                      <BarRow label="Plus tard" value={d.forecast.later} max={forecastMax} text={DT(d.forecast.later)} />
                    </div>
                  </Card>
                </CardGrid>
              </Section>

              <Section title="Familles à relancer">
                {d.toRemind.length ? (
                  <CardGrid list>
                    {d.toRemind.map((f) => (
                      <Card key={f.playerId}>
                        <CardRow>
                          <h3>
                            <Link to={`/admin/joueurs/${f.playerId}`} className="hover:underline">
                              {f.name}
                            </Link>
                          </h3>
                          <Pill tone="r">{DT(f.amount)}</Pill>
                        </CardRow>
                        <Pills>
                          {f.code && <Pill tone="s">{f.code}</Pill>}
                          <Pill tone="b">{f.installments} tranche(s)</Pill>
                          <Pill tone={f.daysLate > 60 ? 'r' : 'b'}>{f.daysLate} j de retard</Pill>
                        </Pills>
                        <CardText>
                          {f.contact ? `Parent : ${f.contact}` : 'Sans parent lié'}
                          {f.phone ? ` · ${f.phone}` : ''}
                        </CardText>
                        {canCollect && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Link className={LINK_BTN} to="/admin/paiements">
                              Encaisser
                            </Link>
                            <Button
                              onClick={() => remind.mutate(f.oldestInstallmentId)}
                              disabled={remind.isPending || !f.canEmail}
                              title={f.canEmail ? undefined : 'Aucune adresse email'}
                            >
                              Envoyer un rappel
                            </Button>
                          </div>
                        )}
                      </Card>
                    ))}
                  </CardGrid>
                ) : (
                  <EmptyState>Aucune famille en retard.</EmptyState>
                )}
              </Section>

              <Section title="Réductions et modes de paiement">
                <CardGrid>
                  <Card>
                    <CardRow>
                      <h3>Coût des réductions</h3>
                      <Pill tone="s">{DT(d.discounts.total)}</Pill>
                    </CardRow>
                    <div className="mt-3 flex flex-col gap-2.5">
                      <BarRow label={`Fratrie (${d.discounts.byKind.SIBLING.count})`} value={d.discounts.byKind.SIBLING.amount} max={d.discounts.total} text={DT(d.discounts.byKind.SIBLING.amount)} />
                      <BarRow label={`Spéciale (${d.discounts.byKind.SPECIAL.count})`} value={d.discounts.byKind.SPECIAL.amount} max={d.discounts.total} text={DT(d.discounts.byKind.SPECIAL.amount)} />
                      <BarRow label={`Exonération (${d.discounts.byKind.EXEMPT.count})`} value={d.discounts.byKind.EXEMPT.amount} max={d.discounts.total} text={DT(d.discounts.byKind.EXEMPT.amount)} />
                    </div>
                  </Card>
                  <Card>
                    <CardRow>
                      <h3>Modes de paiement</h3>
                      <Pill tone="b">{d.methods.CASH.count + d.methods.CHEQUE.count + d.methods.ONLINE.count} paiement(s)</Pill>
                    </CardRow>
                    <div className="mt-3 flex flex-col gap-2.5">
                      <BarRow label="Espèces" value={d.methods.CASH.amount} max={methodsTotal} text={`${pct(d.methods.CASH.amount, methodsTotal)} %`} />
                      <BarRow label="Chèque" value={d.methods.CHEQUE.amount} max={methodsTotal} text={`${pct(d.methods.CHEQUE.amount, methodsTotal)} %`} />
                      <BarRow label="En ligne" value={d.methods.ONLINE.amount} max={methodsTotal} text={`${pct(d.methods.ONLINE.amount, methodsTotal)} %`} />
                    </div>
                    {d.refunds !== 0 && <CardText>Remboursements et corrections : {DT(d.refunds)}</CardText>}
                  </Card>
                  <Card>
                    <CardRow>
                      <h3>Échéanciers</h3>
                      <Pill tone="b">{d.summary.memberships} cotisation(s)</Pill>
                    </CardRow>
                    <div className="mt-3 flex flex-col gap-2.5">
                      <BarRow label="Comptant" value={d.plans.FULL} max={plansTotal} text={String(d.plans.FULL)} />
                      <BarRow label="Par semestre" value={d.plans.SEMESTER} max={plansTotal} text={String(d.plans.SEMESTER)} />
                      <BarRow label="Par mois" value={d.plans.MONTHLY} max={plansTotal} text={String(d.plans.MONTHLY)} />
                    </div>
                  </Card>
                </CardGrid>
              </Section>

              <Section title="Bilan">
                <Card>
                  <div className="flex flex-col gap-2 text-sm">
                    <CardRow>
                      <span>Cotisations encaissées</span>
                      <b className="font-semibold tabular-nums">+ {DT(d.balance.cotisations)}</b>
                    </CardRow>
                    <CardRow>
                      <span>Réservations de terrains</span>
                      <b className="font-semibold tabular-nums">+ {DT(d.balance.reservations)}</b>
                    </CardRow>
                    <CardRow>
                      <span>Salaires versés</span>
                      <b className="font-semibold tabular-nums">− {DT(d.balance.salariesPaid)}</b>
                    </CardRow>
                    <div className="border-t-[1.5px] border-line pt-2">
                      <CardRow>
                        <b className="font-semibold">Solde</b>
                        <Pill tone={d.balance.net >= 0 ? 'g' : 'r'}>{DT(d.balance.net)}</Pill>
                      </CardRow>
                    </div>
                  </div>
                  {d.balance.salariesDue > 0 && (
                    <Pills className="mt-3">
                      <Pill tone="s">{DT(d.balance.salariesDue)} de salaires à verser</Pill>
                    </Pills>
                  )}
                </Card>
                <Note>
                  Les réservations sont comptées au montant réservé (non annulées) : leur encaissement n’est pas encore saisi dans
                  l’application. Les dépenses (STEG, SONEDE, achats) s’ajouteront au bilan avec le module dépenses.
                </Note>
              </Section>
            </>
          )}
        </QueryState>
      </div>
    </>
  );
}
