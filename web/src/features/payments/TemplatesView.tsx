import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Card, CardSubtitle, EmptyState } from '../../components/ui/Card';
import { TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { DT, fD } from '../../lib/format';
import { MONTHS, MONTHS_SHORT, usePaymentTemplates } from '../../lib/payment-config';
import type { PaymentTemplate, ScheduleLine, TemplateLine } from '../../lib/types';
import { useAction } from '../../lib/useAction';

type Draft = Omit<PaymentTemplate, 'id' | 'version' | 'archivedAt' | 'used'>;
type Preview = { error: string | null; schedule: ScheduleLine[] };

const EMPTY: Draft = {
  name: '',
  kind: 'FIXED',
  lines: [
    { date: 'ENROLL', mode: 'PERCENT', value: 50 },
    { date: '02-01', mode: 'REST', value: 0 },
  ],
  monthlyDay: 5,
  months: [10, 11, 12, 1, 2, 3, 4, 5, 6],
  deposit: false,
  scope: 'ALL',
  visible: true,
  lateMode: 'MERGE',
};
// Mois de la saison, dans l'ordre (septembre → août).
const SEASON_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];
/** Champs modifiables d'un modèle (l'API refuse les autres). */
const toDraft = (t: PaymentTemplate): Draft => ({
  name: t.name,
  kind: t.kind,
  lines: t.lines,
  monthlyDay: t.monthlyDay,
  months: t.months,
  deposit: t.deposit,
  scope: t.scope,
  visible: t.visible,
  lateMode: t.lateMode,
});
const SCOPE = { ALL: 'Toutes les catégories', COMPETITIVE: 'Compétition', LEISURE: 'Loisirs' } as const;
const fld = 'rounded-[20px] bg-fld px-3 py-[9px] text-[14px] text-fg';

const dateLabel = (d: string) => {
  if (d === 'ENROLL') return 'À l’inscription';
  const [m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]}`;
};
const partLabel = (l: TemplateLine) => (l.mode === 'REST' ? 'Le reste' : l.mode === 'PERCENT' ? `${l.value} %` : DT(l.value));

function Chips<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-[13px] py-[7px] text-[13px] ${o.value === value ? 'bg-toggle text-bg' : 'bg-fld text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ScheduleCards({ lines }: { lines: ScheduleLine[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 min-[521px]:grid-cols-3">
      {lines.map((l, i) => (
        <div key={i} className="rounded-[18px] bg-fld px-3 py-2.5">
          <small className="block text-[12px] text-mut">
            Tranche {i + 1}/{lines.length}
          </small>
          <b className="block text-[17px] font-semibold">{DT(l.amount)}</b>
          <small className="text-[12px]">{fD(l.dueDate, { day: '2-digit', month: '2-digit', year: 'numeric' })}</small>
        </div>
      ))}
    </div>
  );
}

/** Aperçu calculé par l'API (configuration d'arrondi et saison active). */
function usePreview(draft: Draft | undefined, amount: number, on?: string) {
  const [p, setP] = useState<Preview>();
  useEffect(() => {
    if (!draft || !(amount > 0)) return;
    const t = setTimeout(() => {
      api
        .post<Preview>('/payments/templates/preview', { template: { ...draft, name: draft.name || 'Aperçu' }, amount, on })
        .then(setP)
        .catch(() => setP(undefined));
    }, 250);
    return () => clearTimeout(t);
  }, [draft, amount, on]);
  return p;
}

function TemplateEditor({ open, template, amount, onClose }: { open: boolean; template?: PaymentTemplate; amount: number; onClose: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(EMPTY);
  useEffect(() => {
    if (!open) return;
    setD(template ? toDraft(template) : EMPTY);
  }, [open, template]);
  const preview = usePreview(open ? d : undefined, amount);
  const setLine = (i: number, v: Partial<TemplateLine>) => setD({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...v } : l)) });
  const pct = d.lines.filter((l) => l.mode === 'PERCENT').reduce((t, l) => t + l.value, 0);
  const hasRest = d.lines.some((l) => l.mode === 'REST');
  const save = useAction(
    () => (template ? api.patch(`/payments/templates/${template.id}`, { ...d, version: template.version }) : api.post('/payments/templates', d)),
    { invalidate: [['payment-templates']], success: template ? 'Modèle enregistré (nouvelles inscriptions).' : 'Modèle créé.', onSuccess: onClose },
  );
  const submit = () => {
    if (!d.name.trim()) return toast('Le nom du modèle est obligatoire.');
    if (preview?.error) return toast(preview.error);
    save.mutate();
  };
  return (
    <Modal
      open={open}
      size="lg"
      title={template ? `Modifier le modèle · ${template.name}` : 'Nouveau modèle d’échéancier'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending}>
            {template ? 'Enregistrer' : 'Créer le modèle'}
          </Button>
        </>
      }
    >
      <TextField label="Nom du modèle" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Ex. Rentrée en 3 fois" />
      <div>
        <span className="mb-1 block text-[12px] text-mut">Type</span>
        <Chips
          value={d.kind}
          onChange={(kind) => setD({ ...d, kind })}
          options={[
            { value: 'FIXED', label: 'Tranches à dates fixes' },
            { value: 'MONTHLY', label: 'Mensuel (mois choisis)' },
          ]}
        />
      </div>

      {d.kind === 'FIXED' ? (
        <div className="flex flex-col gap-2">
          <span className="text-[12px] text-mut">Tranches</span>
          {d.lines.map((l, i) => {
            const [m, day] = l.date === 'ENROLL' ? [0, 1] : l.date.split('-').map(Number);
            const setDate = (mm: number, dd: number) => setLine(i, { date: mm === 0 ? 'ENROLL' : `${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` });
            return (
              <div key={i} className="grid grid-cols-[28px_1fr_1fr] items-center gap-2 min-[620px]:grid-cols-[28px_1.4fr_1fr_36px]">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-fld text-[13px] font-semibold">{i + 1}</span>
                <div className="flex gap-1.5">
                  <select aria-label={`Tranche ${i + 1} : mois`} className={`${fld} flex-1`} value={m} onChange={(e) => setDate(Number(e.target.value), day)}>
                    <option value={0}>À l’inscription</option>
                    {MONTHS.map((name, k) => (
                      <option key={name} value={k + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {m > 0 && (
                    <select aria-label={`Tranche ${i + 1} : jour`} className={`${fld} w-[66px]`} value={day} onChange={(e) => setDate(m, Number(e.target.value))}>
                      {Array.from({ length: 31 }, (_, k) => k + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <select aria-label={`Tranche ${i + 1} : calcul`} className={`${fld} w-[112px]`} value={l.mode} onChange={(e) => setLine(i, { mode: e.target.value as TemplateLine['mode'] })}>
                    <option value="PERCENT">%</option>
                    <option value="AMOUNT">Montant DT</option>
                    <option value="REST">Le reste</option>
                  </select>
                  {l.mode !== 'REST' && (
                    <input
                      aria-label={`Tranche ${i + 1} : part`}
                      type="number"
                      min={0}
                      className={`${fld} w-full min-w-0 text-center`}
                      value={l.value}
                      onChange={(e) => setLine(i, { value: Number(e.target.value) })}
                    />
                  )}
                </div>
                <ActionIcon kind="delete" label="Retirer la tranche" onClick={() => setD({ ...d, lines: d.lines.filter((_, j) => j !== i) })} disabled={d.lines.length === 1} />
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              onClick={() => setD({ ...d, lines: [...d.lines, { date: '03-01', mode: hasRest ? 'PERCENT' : 'REST', value: hasRest ? 10 : 0 }] })}
              disabled={d.lines.length >= 12}
            >
              + Ajouter une tranche
            </Button>
            <span className={`text-[13px] font-semibold ${preview?.error ? 'text-[#c0392b]' : 'text-[#2f7a4d]'}`}>
              {preview?.error ?? `✓ ${hasRest ? `${pct} % + le reste` : `Total ${pct} %`}`}
            </span>
          </div>
          {!preview?.error && preview && (
            <div className="flex h-2.5 overflow-hidden rounded-full bg-fld" aria-hidden="true">
              {preview.schedule.map((s, i) => (
                <span key={i} style={{ width: `${(s.amount / Math.max(1, amount)) * 100}%`, background: ['#5a5acd', '#8f8fe0', '#c7c7f1'][i % 3] }} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="mb-1 block text-[12px] text-mut">Jour de paiement</span>
              <select className={`${fld} w-full`} value={d.monthlyDay} onChange={(e) => setD({ ...d, monthlyDay: Number(e.target.value) })}>
                {Array.from({ length: 28 }, (_, k) => k + 1).map((n) => (
                  <option key={n} value={n}>
                    le {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-[14px]">
              <input type="checkbox" className="h-5 w-5 accent-[var(--pri)]" checked={d.deposit} onChange={(e) => setD({ ...d, deposit: e.target.checked })} />
              Acompte à l’inscription (réglage du club)
            </label>
          </div>
          <span className="text-[12px] text-mut">Mois de paiement (ordre de la saison)</span>
          <div className="grid grid-cols-4 gap-1.5 min-[521px]:grid-cols-6">
            {SEASON_MONTHS.map((m) => {
              const on = d.months.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setD({ ...d, months: on ? d.months.filter((x) => x !== m) : [...d.months, m] })}
                  className={`rounded-[14px] py-2 text-[13px] ${on ? 'bg-pri font-semibold text-white' : 'bg-fld text-fg'}`}
                >
                  {MONTHS_SHORT[m - 1]}
                </button>
              );
            })}
          </div>
          <Pills>
            <Pill tone="b">{d.months.length} mois</Pill>
            <Pill tone="s" className="whitespace-normal">
              Inscription en cours d’année : mois restants seulement
            </Pill>
          </Pills>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t-[1.5px] border-line pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[14.5px]">Réservé à</span>
          <Chips value={d.scope} onChange={(scope) => setD({ ...d, scope })} options={(Object.keys(SCOPE) as Draft['scope'][]).map((k) => ({ value: k, label: SCOPE[k] }))} />
        </div>
        <label className="flex items-center justify-between gap-3 text-[14.5px]">
          <span>
            Proposé à l’inscription
            <small className="block text-[12px] text-mut">Sinon : sur accord du bureau (affiché à part)</small>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-[var(--pri)]" checked={d.visible} onChange={(e) => setD({ ...d, visible: e.target.checked })} />
        </label>
        {d.kind === 'FIXED' && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[14.5px]">Tranches déjà passées (inscription tardive)</span>
            <Chips
              value={d.lateMode}
              onChange={(lateMode) => setD({ ...d, lateMode })}
              options={[
                { value: 'MERGE', label: 'Regroupées dans la 1re' },
                { value: 'SPREAD', label: 'Réparties sur les suivantes' },
              ]}
            />
          </div>
        )}
      </div>
      {preview && !preview.error && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-mut">Aperçu pour {DT(amount)}, inscription aujourd’hui</span>
          <ScheduleCards lines={preview.schedule} />
        </div>
      )}
    </Modal>
  );
}

/** Configuration des paiements › Modèles du club : échéanciers créés par le club, proposés en plus des 4 modes. */
export function TemplatesView({ canEdit, amount }: { canEdit: boolean; amount: number }) {
  const q = usePaymentTemplates();
  const [edit, setEdit] = useState<{ open: boolean; template?: PaymentTemplate }>({ open: false });
  const [selected, setSelected] = useState<string>();
  const list = q.data ?? [];
  const active = list.find((t) => t.id === selected) ?? list.find((t) => !t.archivedAt);
  // Inscription tardive : 30 jours après la 2e tranche d'un modèle à dates fixes (saison en cours).
  const lateDay = (() => {
    const second = active?.kind === 'FIXED' ? active.lines.find((l) => l.date !== 'ENROLL') : undefined;
    if (!second) return undefined;
    const [m, d] = second.date.split('-').map(Number);
    const today = new Date();
    const startYear = today.getMonth() + 1 >= 8 ? today.getFullYear() : today.getFullYear() - 1;
    const due = Date.UTC(m >= 8 ? startYear : startYear + 1, m - 1, Math.min(d, 28));
    return new Date(due + 30 * 86_400_000).toISOString().slice(0, 10);
  })();
  // Modèle sans les champs de lecture (id, version…), stable tant que le modèle ne change pas.
  const draft = useMemo<Draft | undefined>(() => (active ? toDraft(active) : undefined), [active]);
  const now = usePreview(draft, amount);
  const late = usePreview(lateDay ? draft : undefined, amount, lateDay);
  const archive = useAction((id: string) => api.post<{ archived: boolean }>(`/payments/templates/${id}/archive`), {
    invalidate: [['payment-templates']],
    success: (r) => (r.archived ? 'Modèle archivé : il n’est plus proposé.' : 'Modèle restauré.'),
  });

  return (
    <>
      <div className="mt-4 grid grid-cols-1 gap-4 min-[1100px]:grid-cols-2">
        <Card>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3>Modèles d’échéancier</h3>
              <CardSubtitle>Proposés dans la fiche joueur, en plus des 4 modes</CardSubtitle>
            </div>
            {canEdit && (
              <Button variant="primary" onClick={() => setEdit({ open: true })}>
                + Nouveau modèle
              </Button>
            )}
          </div>
          {!list.length && <EmptyState>Aucun modèle : créez par exemple « Rentrée en 3 fois ».</EmptyState>}
          {list.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(t.id)}
              onKeyDown={(e) => e.key === 'Enter' && setSelected(t.id)}
              className={`cursor-pointer rounded-[22px] border-[1.5px] p-3.5 ${active?.id === t.id ? 'border-pri' : 'border-line'} ${t.archivedAt ? 'opacity-60' : ''}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b className="font-semibold">{t.name}</b>
                <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {t.archivedAt ? <Pill tone="s">Archivé</Pill> : t.visible ? <Pill tone="g">Proposé</Pill> : <Pill tone="s">Sur accord du bureau</Pill>}
                  <Pill tone="b">
                    {t.used} joueur{t.used > 1 ? 's' : ''}
                  </Pill>
                  {canEdit && !t.archivedAt && <ActionIcon kind="edit" onClick={() => setEdit({ open: true, template: t })} />}
                  {canEdit && <ActionIcon kind={t.archivedAt ? 'restore' : 'archive'} onClick={() => archive.mutate(t.id)} />}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {t.kind === 'FIXED' ? (
                  t.lines.map((l, i) => (
                    <div key={i} className="min-w-[96px] flex-1 rounded-[14px] bg-fld px-2.5 py-2 text-[12.5px]">
                      <b className="block text-[14px] font-semibold">{partLabel(l)}</b>
                      {dateLabel(l.date)}
                    </div>
                  ))
                ) : (
                  <>
                    <div className="flex-1 rounded-[14px] bg-fld px-2.5 py-2 text-[12.5px]">
                      <b className="block text-[14px] font-semibold">Le {t.monthlyDay}</b>
                      de chaque mois coché
                    </div>
                    <div className="flex-1 rounded-[14px] bg-fld px-2.5 py-2 text-[12.5px]">
                      <b className="block text-[14px] font-semibold">{t.months.length} mois</b>
                      {SEASON_MONTHS.filter((m) => t.months.includes(m))
                        .map((m) => MONTHS_SHORT[m - 1])
                        .join(', ')}
                    </div>
                  </>
                )}
              </div>
              <Pills className="mt-2">
                <Pill tone="s">{SCOPE[t.scope]}</Pill>
                {t.kind === 'FIXED' && <Pill tone="s">Inscription tardive : {t.lateMode === 'MERGE' ? 'regroupées dans la 1re' : 'réparties'}</Pill>}
              </Pills>
            </div>
          ))}
        </Card>
        {active && (
          <Card>
            <h3>Aperçu · {active.name}</h3>
            <CardSubtitle>Cotisation de {DT(amount)}, inscription aujourd’hui</CardSubtitle>
            {now && !now.error && <ScheduleCards lines={now.schedule} />}
            {late && !late.error && lateDay && (
              <>
                <span className="mt-1 text-[13px] text-mut">Inscription le {fD(lateDay, { day: '2-digit', month: '2-digit', year: 'numeric' })} (tranche déjà passée)</span>
                <ScheduleCards lines={late.schedule} />
              </>
            )}
            <p className="m-0 rounded-[18px] bg-fld px-4 py-3 text-[13px]">
              ⓘ Un modèle utilisé n’est jamais supprimé : il est archivé. Le modifier ne change que les nouvelles inscriptions (sauf « Refaire les échéanciers non
              payés »).
            </p>
          </Card>
        )}
      </div>
      <TemplateEditor open={edit.open} template={edit.template} amount={amount} onClose={() => setEdit({ open: false })} />
    </>
  );
}
