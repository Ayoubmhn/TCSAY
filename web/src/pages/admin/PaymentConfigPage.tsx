import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMe } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card, CardSubtitle } from '../../components/ui/Card';
import { TextArea } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Segmented } from '../../components/ui/Segmented';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { DT, fD } from '../../lib/format';
import { MONTHS, PLAN_LABEL, PLANS } from '../../lib/payment-config';
import type { Fee, PaymentConfig, PaymentPlan, ScheduleLine } from '../../lib/types';
import { useAction } from '../../lib/useAction';

type View = 'modes' | 'rappels';
type Preview = { plan: PaymentPlan; label: string; schedule: ScheduleLine[] }[];

const fld = 'rounded-[20px] bg-fld px-3 py-[9px] text-[14px] text-fg disabled:opacity-60';
const lab = 'mb-1 block text-[12px] text-mut';

/** Case à cocher en ligne (libellé, aide). */
function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 border-b-[1.5px] border-line py-3 last:border-0">
      <span className="text-[14.5px]">
        {label}
        {hint && <small className="block text-[12px] text-mut">{hint}</small>}
      </span>
      <input type="checkbox" className="h-5 w-5 flex-none accent-[var(--pri)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Choix parmi quelques valeurs (pastilles). */
function Chips<T extends string | number>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={disabled}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-[13px] py-[7px] text-[13px] ${o.value === value ? 'bg-toggle text-bg' : 'bg-fld text-fg'} disabled:opacity-60`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b-[1.5px] border-line py-3 last:border-0">
      <span className="text-[14.5px]">
        {label}
        {hint && <small className="block text-[12px] text-mut">{hint}</small>}
      </span>
      {children}
    </div>
  );
}

/** Date « MM-JJ » (jour et mois, l'année est celle de la saison). */
function DayMonth({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [m, d] = value.split('-').map(Number);
  const set = (mm: number, dd: number) => onChange(`${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
  return (
    <div>
      <span className={lab}>{label}</span>
      <div className="flex gap-1.5">
        <select aria-label={`${label} : jour`} className={`${fld} w-[70px]`} value={d} disabled={disabled} onChange={(e) => set(m, Number(e.target.value))}>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select aria-label={`${label} : mois`} className={`${fld} flex-1`} value={m} disabled={disabled} onChange={(e) => set(Number(e.target.value), d)}>
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Schedule({ lines }: { lines: ScheduleLine[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {lines.map((l, i) => (
        <div key={i} className="min-w-[96px] flex-1 rounded-[14px] bg-fld px-2.5 py-2 text-[12.5px]">
          <b className="block text-[14px] font-semibold">{DT(l.amount)}</b>
          {fD(l.dueDate, { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </div>
      ))}
    </div>
  );
}

/** Configuration des paiements (président) : modes proposés et échéances, acompte, rappels et retards, encaissement. */
export function PaymentConfigPage() {
  const me = useMe();
  const toast = useToast();
  const canEdit = me.permissions.includes('permissions.manage');
  const [params, setParams] = useSearchParams();
  const view: View = params.get('vue') === 'rappels' ? 'rappels' : 'modes';
  const q = useQuery({ queryKey: ['payment-config'], queryFn: () => api.get<PaymentConfig>('/payments/config') });
  const fees = useQuery({ queryKey: ['fees', 'config'], queryFn: () => api.get<Fee[]>('/fees') });
  const [cfg, setCfg] = useState<PaymentConfig>();
  useEffect(() => {
    if (q.data) setCfg(q.data);
  }, [q.data]);
  const dirty = Boolean(cfg && q.data && JSON.stringify(cfg) !== JSON.stringify(q.data));

  // Aperçu : tarif le plus courant de la base (montant et acompte), modifiable pour essayer.
  const fee = fees.data?.find((f) => !f.group) ?? fees.data?.[0];
  const [amount, setAmount] = useState('');
  useEffect(() => {
    if (fee && amount === '') setAmount(String(fee.amount));
  }, [fee, amount]);
  const [preview, setPreview] = useState<Preview>();
  useEffect(() => {
    if (!cfg || !(Number(amount) > 0)) return;
    const t = setTimeout(() => {
      api
        .post<Preview>('/payments/config/preview', { config: cfg, amount: Number(amount), deposit: fee ? Number(fee.depositAmount) : 0 })
        .then(setPreview)
        .catch(() => setPreview(undefined));
    }, 300);
    return () => clearTimeout(t);
  }, [cfg, amount, fee]);

  const save = useAction(() => api.put<PaymentConfig>('/payments/config', { config: cfg }), {
    invalidate: [['payment-config'], ['installments'], ['audit']],
    success: 'Configuration des paiements enregistrée (nouvelles inscriptions).',
  });
  const [redo, setRedo] = useState(false);
  const [reason, setReason] = useState('');
  const reschedule = useAction(() => api.post<{ rescheduled: number }>('/payments/config/reschedule', { reason: reason.trim() }), {
    invalidate: [['installments'], ['players'], ['membership-info']],
    onSuccess: (r) => {
      toast(`${r.rescheduled} échéancier(s) refait(s) : tranches payées gardées.`);
      setRedo(false);
      setReason('');
    },
  });

  const set = <K extends keyof PaymentConfig>(k: K, v: Partial<PaymentConfig[K]>) => setCfg((c) => (c ? { ...c, [k]: { ...(c[k] as object), ...v } } : c));
  const off = !canEdit;

  return (
    <>
      <PageHeader
        title={view === 'modes' ? 'Configuration des paiements' : 'Retards et rappels'}
        subtitle={view === 'modes' ? 'Découvrez les modes de paiement proposés et leurs échéances.' : 'Découvrez quand une tranche passe « En retard » et qui est prévenu.'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<View>
              label="Partie de la configuration"
              value={view}
              onChange={(v) => setParams(v === 'rappels' ? { vue: 'rappels' } : {}, { replace: true })}
              options={[
                { value: 'modes', label: 'Modes et échéances' },
                { value: 'rappels', label: 'Retards et rappels' },
              ]}
            />
            {canEdit && (
              <Button variant="primary" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                Enregistrer
              </Button>
            )}
          </div>
        }
      />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {cfg && view === 'modes' && (
          <div className="mt-4 grid grid-cols-1 gap-4 min-[1100px]:grid-cols-2">
            <Card>
              <h3>Modes de paiement proposés</h3>
              <CardSubtitle>Choisis à l’inscription du joueur</CardSubtitle>
              {PLANS.map((p) => {
                const on = cfg.plans[p];
                return (
                  <div key={p} className={`rounded-[22px] border-[1.5px] p-3.5 ${on ? 'border-pri' : 'border-line'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <b className="font-semibold">{PLAN_LABEL[p]}</b>
                      <div className="flex items-center gap-2">
                        {cfg.defaultPlan === p ? (
                          <Pill tone="g">Par défaut</Pill>
                        ) : (
                          on &&
                          canEdit && (
                            <button type="button" className="rounded-full bg-fld px-3 py-[5px] text-[12.5px]" onClick={() => setCfg({ ...cfg, defaultPlan: p })}>
                              Mettre par défaut
                            </button>
                          )
                        )}
                        <input
                          type="checkbox"
                          aria-label={`Proposer « ${PLAN_LABEL[p]} »`}
                          className="h-5 w-5 accent-[var(--pri)]"
                          checked={on}
                          disabled={off || (on && Object.values(cfg.plans).filter(Boolean).length === 1)}
                          onChange={(e) => {
                            const plans = { ...cfg.plans, [p]: e.target.checked };
                            const def = plans[cfg.defaultPlan] ? cfg.defaultPlan : PLANS.find((x) => plans[x])!;
                            setCfg({ ...cfg, plans, defaultPlan: def });
                          }}
                        />
                      </div>
                    </div>
                    {on && p === 'FULL' && <p className="m-0 mt-2 text-[13px] text-mut">Une tranche, à l’inscription.</p>}
                    {on && p === 'SEMESTER' && (
                      <div className="mt-2.5 grid grid-cols-1 gap-2.5 min-[521px]:grid-cols-2">
                        <DayMonth label="Tranche 2 (tranche 1 à l’inscription)" value={cfg.semester.second} disabled={off} onChange={(v) => set('semester', { second: v })} />
                        <div>
                          <span className={lab}>Répartition</span>
                          <select className={`${fld} w-full`} disabled={off} value={cfg.semester.firstPercent} onChange={(e) => set('semester', { firstPercent: Number(e.target.value) })}>
                            {[50, 60, 70, 40, 30].map((n) => (
                              <option key={n} value={n}>
                                {n} % / {100 - n} %
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                    {on && p === 'QUARTER' && (
                      <div className="mt-2.5 grid grid-cols-1 gap-2.5 min-[521px]:grid-cols-2">
                        <DayMonth label="Tranche 2 (tranche 1 à l’inscription)" value={cfg.quarter.second} disabled={off} onChange={(v) => set('quarter', { second: v })} />
                        <DayMonth label="Tranche 3" value={cfg.quarter.third} disabled={off} onChange={(v) => set('quarter', { third: v })} />
                      </div>
                    )}
                    {on && p === 'MONTHLY' && (
                      <>
                        <div className="mt-2.5 grid grid-cols-3 gap-2">
                          <div>
                            <span className={lab}>Jour de paiement</span>
                            <select className={`${fld} w-full`} disabled={off} value={cfg.monthly.day} onChange={(e) => set('monthly', { day: Number(e.target.value) })}>
                              {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                                <option key={n} value={n}>
                                  le {n}
                                </option>
                              ))}
                            </select>
                          </div>
                          {(['firstMonth', 'lastMonth'] as const).map((k) => (
                            <div key={k}>
                              <span className={lab}>{k === 'firstMonth' ? 'Premier mois' : 'Dernier mois'}</span>
                              <select
                                className={`${fld} w-full`}
                                disabled={off}
                                value={cfg.monthly[k] ?? ''}
                                onChange={(e) => set('monthly', { [k]: e.target.value ? Number(e.target.value) : null })}
                              >
                                <option value="">Saison</option>
                                {MONTHS.map((name, i) => (
                                  <option key={name} value={i + 1}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                        <Pills className="mt-2">
                          <Pill tone="s" className="whitespace-normal">
                            Inscription en cours d’année : mois restants seulement
                          </Pill>
                        </Pills>
                      </>
                    )}
                  </div>
                );
              })}
            </Card>
            <div className="flex flex-col gap-4">
              <Card>
                <h3>Acompte à l’inscription</h3>
                <CardSubtitle>Semestre, trimestre et mois</CardSubtitle>
                <Toggle label="Acompte demandé" hint="Payé le jour de l’inscription" checked={cfg.deposit.enabled} disabled={off} onChange={(v) => set('deposit', { enabled: v })} />
                {cfg.deposit.enabled && (
                  <>
                    <Row label="Montant de l’acompte">
                      <div className="flex items-center gap-2">
                        <Chips
                          value={cfg.deposit.mode}
                          disabled={off}
                          onChange={(v) => set('deposit', { mode: v })}
                          options={[
                            { value: 'FEE', label: 'Celui du tarif' },
                            { value: 'PERCENT', label: 'Pourcentage' },
                          ]}
                        />
                        {cfg.deposit.mode === 'PERCENT' && (
                          <select className={fld} disabled={off} value={cfg.deposit.percent} onChange={(e) => set('deposit', { percent: Number(e.target.value) })}>
                            {[10, 15, 20, 25, 30, 40, 50].map((n) => (
                              <option key={n} value={n}>
                                {n} %
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </Row>
                    <Toggle
                      label="Acompte compris dans la 1re tranche"
                      hint="Sinon tranche à part, le jour de l’inscription"
                      checked={cfg.deposit.inFirst}
                      disabled={off}
                      onChange={(v) => set('deposit', { inFirst: v })}
                    />
                  </>
                )}
              </Card>
              <Card>
                <h3>Aperçu des échéanciers</h3>
                <CardSubtitle>Inscription aujourd’hui, saison active{fee ? ` · tarif ${fee.category.name}` : ''}</CardSubtitle>
                <label className="flex items-center gap-2 text-[13px] text-mut">
                  Cotisation
                  <input className={`${fld} w-[110px] text-center`} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Montant de la cotisation" />
                  DT
                </label>
                {preview?.map((p) => (
                  <div key={p.plan}>
                    <span className="text-[13px] font-semibold text-mut">
                      {p.label} · {p.schedule.length} tranche{p.schedule.length > 1 ? 's' : ''}
                    </span>
                    <Schedule lines={p.schedule} />
                  </div>
                ))}
              </Card>
            </div>
          </div>
        )}
        {cfg && view === 'rappels' && (
          <div className="mt-4 grid grid-cols-1 gap-4 min-[1100px]:grid-cols-2">
            <Card>
              <h3>Rappels aux familles</h3>
              <CardSubtitle>Notification dans l’application, email au choix</CardSubtitle>
              <Row label="Rappel avant l’échéance">
                <Chips
                  value={cfg.reminders.beforeDays}
                  disabled={off}
                  onChange={(v) => set('reminders', { beforeDays: v })}
                  options={[0, 1, 3, 7].map((n) => ({ value: n, label: n ? `${n} j avant` : 'Non' }))}
                />
              </Row>
              <Row label="Délai de grâce avant « En retard »" hint="Statut des tranches et premier message de retard">
                <Chips value={cfg.reminders.graceDays} disabled={off} onChange={(v) => set('reminders', { graceDays: v })} options={[0, 3, 7, 15].map((n) => ({ value: n, label: `${n} j` }))} />
              </Row>
              <Row label="Relance si toujours impayé">
                <Chips
                  value={cfg.reminders.repeatDays}
                  disabled={off}
                  onChange={(v) => set('reminders', { repeatDays: v })}
                  options={[0, 7, 15].map((n) => ({ value: n, label: n ? `tous les ${n} j` : 'Non' }))}
                />
              </Row>
              {cfg.reminders.repeatDays > 0 && (
                <Row label="Relances au plus" hint="Ensuite : « Familles à relancer » (Statistiques)">
                  <select className={fld} disabled={off} value={cfg.reminders.maxRepeats} onChange={(e) => set('reminders', { maxRepeats: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Row>
              )}
              <Toggle label="Envoyer aussi par email" hint="Aux parents (ou au joueur majeur) qui ont une adresse" checked={cfg.reminders.email} disabled={off} onChange={(v) => set('reminders', { email: v })} />
            </Card>
            <div className="flex flex-col gap-4">
              <Card>
                <h3>Encaissement</h3>
                <CardSubtitle>Écran Paiements</CardSubtitle>
                <Row label="Modes acceptés">
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ['CASH', 'Espèces'],
                        ['CHEQUE', 'Chèque'],
                        ['TRANSFER', 'Virement'],
                      ] as const
                    ).map(([m, label]) => {
                      const on = cfg.collect.methods.includes(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          disabled={off || (on && cfg.collect.methods.length === 1)}
                          aria-pressed={on}
                          onClick={() => set('collect', { methods: on ? cfg.collect.methods.filter((x) => x !== m) : [...cfg.collect.methods, m] })}
                          className={`rounded-full px-[13px] py-[7px] text-[13px] ${on ? 'bg-toggle text-bg' : 'bg-fld text-fg'} disabled:opacity-60`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </Row>
                <Toggle label="Reçu du carnet obligatoire à l’encaissement" hint="Le n° du reçu est saisi avec le paiement" checked={cfg.collect.receiptRequired} disabled={off} onChange={(v) => set('collect', { receiptRequired: v })} />
                <Toggle label="Paiement de plusieurs tranches en une fois" hint="Le surplus va sur les tranches suivantes, un seul reçu" checked={cfg.collect.multi} disabled={off} onChange={(v) => set('collect', { multi: v })} />
                <Row label="Arrondi des tranches" hint="L’écart va sur la dernière tranche">
                  <Chips
                    value={cfg.collect.rounding}
                    disabled={off}
                    onChange={(v) => set('collect', { rounding: v })}
                    options={[
                      { value: 'MILLIME', label: 'Millime' },
                      { value: 'DINAR', label: 'Dinar' },
                      { value: 'FIVE', label: '5 DT' },
                    ]}
                  />
                </Row>
              </Card>
              <Card>
                <h3>Exemple de message</h3>
                <CardSubtitle>{cfg.reminders.beforeDays ? `Rappel ${cfg.reminders.beforeDays} jour(s) avant` : 'Retard'}</CardSubtitle>
                <p className="m-0 rounded-[18px] bg-fld px-4 py-3 text-[13.5px]">
                  🔔{' '}
                  {cfg.reminders.beforeDays ? (
                    <>
                      <b>Rappel : tranche 2/2 de Yassine</b> · La tranche 2/2 de Yassine Ben Ali est à régler avant le … Le paiement se fait au club.
                    </>
                  ) : (
                    <>
                      <b>Paiement en retard : tranche 2/2 de Yassine</b> · La tranche 2/2 de Yassine Ben Ali était à régler avant le … Le paiement se fait au club.
                    </>
                  )}
                </p>
              </Card>
            </div>
          </div>
        )}
      </QueryState>
      {canEdit && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => setRedo(true)}>Refaire les échéanciers non payés</Button>
        </div>
      )}
      <Note>
        Les changements s’appliquent aux <b>nouvelles inscriptions</b>. « Refaire les échéanciers non payés » applique la configuration aux cotisations de la
        saison active : les tranches déjà payées sont gardées (R7), le reste est réparti à nouveau. L’accès des familles après un retard se règle dans « Accès
        après paiement ». Seul le président modifie ces réglages ; chaque changement va dans l’historique des actions.
      </Note>
      <Modal
        open={redo}
        title="Refaire les échéanciers non payés"
        onClose={() => setRedo(false)}
        footer={
          <>
            <Button onClick={() => setRedo(false)}>Annuler</Button>
            <Button variant="primary" disabled={!reason.trim() || reschedule.isPending || dirty} onClick={() => reschedule.mutate()}>
              Refaire
            </Button>
          </>
        }
      >
        <p className="m-0 text-[14px]">
          Toutes les cotisations non soldées de la saison active sont réparties à nouveau selon la configuration enregistrée. Les tranches déjà payées ne
          changent pas, les dates choisies pour un joueur sont remplacées.
        </p>
        {dirty && (
          <Pill tone="r" className="whitespace-normal">
            Enregistrez d’abord la configuration.
          </Pill>
        )}
        <TextArea label="Motif (obligatoire)" full value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. nouvelles dates votées par le bureau" />
      </Modal>
    </>
  );
}
