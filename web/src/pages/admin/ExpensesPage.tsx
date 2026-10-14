import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { FilterSelect, Filters, SelectField, TextArea, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { useToast } from '../../components/ui/Toast';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { api, errorMessage, openFile } from '../../lib/api';
import { DT, fD, todayIso } from '../../lib/format';
import { useAction } from '../../lib/useAction';

type State = 'PAID' | 'DUE' | 'LATE' | 'ARCHIVED';
type Method = 'CASH' | 'CHEQUE' | 'TRANSFER';
type Expense = {
  id: string;
  category: string;
  categoryLabel: string;
  label: string;
  supplier: string | null;
  reference: string | null;
  amount: number;
  date: string;
  dueDate: string | null;
  paidAt: string | null;
  method: Method | null;
  methodLabel: string | null;
  note: string | null;
  fileName: string | null;
  state: State;
  archiveReason: string | null;
  version: number;
  createdBy: string;
};
type List = {
  rows: Expense[];
  totals: { all: number; paid: number; due: number; late: number; byCategory: { category: string; label: string; total: number; count: number }[] };
};
const KEYS = [['expenses'], ['finance-stats'], ['audit']];
const STATE: Record<State, { label: string; tone: 'g' | 'r' | 's' | 'b' }> = {
  PAID: { label: 'Payée', tone: 'g' },
  DUE: { label: 'À payer', tone: 'b' },
  LATE: { label: 'En retard', tone: 'r' },
  ARCHIVED: { label: 'Archivée', tone: 's' },
};
const METHODS: [Method, string][] = [
  ['CASH', 'Espèces'],
  ['CHEQUE', 'Chèque'],
  ['TRANSFER', 'Virement'],
];

type Form = { category: string; label: string; supplier: string; reference: string; amount: string; date: string; dueDate: string; paid: boolean; paidAt: string; method: Method; note: string };
const EMPTY: Form = { category: '', label: '', supplier: '', reference: '', amount: '', date: todayIso(), dueDate: '', paid: false, paidAt: todayIso(), method: 'CASH', note: '' };

/** Saisie ou modification d'une dépense, avec justificatif facultatif. */
function ExpenseModal({ open, expense, categories, onClose }: { open: boolean; expense?: Expense; categories: { value: string; label: string }[]; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Form>(EMPTY);
  const [file, setFile] = useState<File>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setFile(undefined);
    setF(
      expense
        ? {
            category: expense.category,
            label: expense.label,
            supplier: expense.supplier ?? '',
            reference: expense.reference ?? '',
            amount: String(expense.amount),
            date: expense.date,
            dueDate: expense.dueDate ?? '',
            paid: Boolean(expense.paidAt),
            paidAt: expense.paidAt ?? todayIso(),
            method: expense.method ?? 'CASH',
            note: expense.note ?? '',
          }
        : EMPTY,
    );
  }, [open, expense]);
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
  const save = useAction(
    async () => {
      const body = {
        category: f.category,
        label: f.label.trim(),
        supplier: f.supplier.trim() || undefined,
        reference: f.reference.trim() || undefined,
        amount: Number(f.amount.replace(',', '.')),
        date: f.date,
        dueDate: f.dueDate || null,
        paidAt: f.paid ? f.paidAt : null,
        method: f.paid ? f.method : null,
        note: f.note.trim() || undefined,
      };
      const saved = expense ? await api.patch<Expense>(`/expenses/${expense.id}`, { ...body, version: expense.version }) : await api.post<Expense>('/expenses', body);
      if (file) await api.upload(`/expenses/${saved.id}/file`, file);
      return saved;
    },
    { invalidate: KEYS, success: expense ? 'Dépense modifiée.' : 'Dépense enregistrée.', onSuccess: onClose },
  );
  const submit = () => {
    if (!f.category) return toast('Choisissez la catégorie.');
    if (!f.label.trim()) return toast('Libellé obligatoire.');
    if (!(Number(f.amount.replace(',', '.')) > 0)) return toast('Montant positif obligatoire.');
    save.mutate();
  };
  return (
    <Modal
      open={open}
      size="lg"
      title={expense ? 'Modifier la dépense' : 'Nouvelle dépense'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={submit} disabled={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-2">
        <SelectField label="Catégorie *" value={f.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">— Choisir —</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </SelectField>
        <TextField label="Libellé *" value={f.label} maxLength={160} onChange={(e) => set({ label: e.target.value })} placeholder="ex. Facture STEG septembre" />
        <TextField label="Fournisseur / organisme" value={f.supplier} maxLength={120} onChange={(e) => set({ supplier: e.target.value })} placeholder="ex. STEG, CNSS, recette des finances" />
        <TextField label="N° de facture / déclaration" value={f.reference} maxLength={60} onChange={(e) => set({ reference: e.target.value })} />
        <TextField label="Montant (DT) *" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />
        <TextField label="Date de la facture *" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
        <TextField label="Date limite de paiement" type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
        <label className="flex items-end gap-2 pb-3 text-sm text-fg">
          <input type="checkbox" className="h-4 w-4 accent-pri" checked={f.paid} onChange={(e) => set({ paid: e.target.checked })} /> Déjà payée
        </label>
        {f.paid && (
          <>
            <TextField label="Payée le" type="date" value={f.paidAt} onChange={(e) => set({ paidAt: e.target.value })} />
            <SelectField label="Mode de paiement" value={f.method} onChange={(e) => set({ method: e.target.value as Method })}>
              {METHODS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </SelectField>
          </>
        )}
        <TextArea label="Note" full rows={2} maxLength={500} value={f.note} onChange={(e) => set({ note: e.target.value })} />
        <div className="col-span-full flex flex-wrap items-center gap-2 text-sm">
          <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setFile(e.target.files?.[0])} />
          <Button type="button" onClick={() => input.current?.click()}>
            {file ? 'Changer le justificatif' : expense?.fileName ? 'Remplacer le justificatif' : 'Joindre le justificatif'}
          </Button>
          <span className="text-mut">{file?.name ?? expense?.fileName ?? 'PDF ou photo, 5 Mo au plus (facultatif)'}</span>
        </div>
      </div>
    </Modal>
  );
}

/** Dépenses du club : factures, déclarations fiscales et sociales, matériel ; paiement, justificatif, archivage (R8). */
export function ExpensesPage() {
  const toast = useToast();
  const [view, setView] = useViewMode('depenses');
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${new Date().getMonth() >= 8 ? year : year - 1}-09-01`);
  const [to, setTo] = useState(`${new Date().getMonth() >= 8 ? year + 1 : year}-08-31`);
  const [category, setCategory] = useState('');
  const [state, setState] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ open: boolean; expense?: Expense }>({ open: false });
  const [paying, setPaying] = useState<Expense>();
  const [payDate, setPayDate] = useState(todayIso());
  const [payMethod, setPayMethod] = useState<Method>('CASH');
  const [archiving, setArchiving] = useState<Expense>();
  const categories = useQuery({ queryKey: ['expense-categories'], queryFn: () => api.get<{ value: string; label: string }[]>('/expenses/categories') });
  const q = useQuery({
    queryKey: ['expenses', from, to, category, state, search.trim()],
    queryFn: () => api.get<List>('/expenses', { from, to, category: category || undefined, state: state || undefined, q: search.trim() || undefined }),
  });
  const pay = useAction(() => api.post(`/expenses/${paying!.id}/pay`, { paidAt: payDate, method: payMethod }), { invalidate: KEYS, success: 'Dépense payée.', onSuccess: () => setPaying(undefined) });
  const archive = useAction((reason: string) => api.post(`/expenses/${archiving!.id}/archive`, { reason }), { invalidate: KEYS, success: 'Dépense archivée.', onSuccess: () => setArchiving(undefined) });
  const restore = useAction((id: string) => api.post(`/expenses/${id}/restore`), { invalidate: KEYS, success: 'Dépense restaurée.' });
  const d = q.data;

  return (
    <>
      <PageHeader
        title="Dépenses"
        subtitle="Découvrez les factures et déclarations du club, et suivez leur paiement."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            <Button variant="primary" onClick={() => setForm({ open: true })}>
              + Nouvelle dépense
            </Button>
          </div>
        }
      />
      <Filters>
        <input className="fld w-[160px] text-fg" type="date" aria-label="Du" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="fld w-[160px] text-fg" type="date" aria-label="Au" value={to} onChange={(e) => setTo(e.target.value)} />
        <FilterSelect label="Catégorie" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Toutes les catégories</option>
          {categories.data?.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="État" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">Toutes</option>
          <option value="due">À payer</option>
          <option value="late">En retard</option>
          <option value="paid">Payées</option>
          <option value="archived">Archivées</option>
        </FilterSelect>
        <input className="fld w-[200px] text-fg" placeholder="Libellé, fournisseur, n°" aria-label="Rechercher" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {d && (
          <>
            <Pills className="my-[18px]">
              <Pill tone="b">{d.rows.length} dépense(s) · {DT(d.totals.all)}</Pill>
              <Pill tone="g">Payé {DT(d.totals.paid)}</Pill>
              {d.totals.due > 0 && <Pill tone="r">À payer {DT(d.totals.due)}</Pill>}
              {d.totals.late > 0 && <Pill tone="r">{d.totals.late} en retard</Pill>}
            </Pills>
            {d.rows.length ? (
              <CardGrid list={view === 'list'}>
                {d.rows.map((e) => (
                  <Card key={e.id}>
                    <CardRow>
                      <h3 className="min-w-0">{e.label}</h3>
                      <Pill tone={STATE[e.state].tone}>{STATE[e.state].label}</Pill>
                    </CardRow>
                    <Pills>
                      <Pill tone="b">{DT(e.amount)}</Pill>
                      <Pill tone="s">{e.categoryLabel}</Pill>
                      <Pill tone="b">{fD(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</Pill>
                      {e.dueDate && !e.paidAt && <Pill tone={e.state === 'LATE' ? 'r' : 'b'} className="card-text">Avant le {fD(e.dueDate, { day: 'numeric', month: 'short' })}</Pill>}
                      {e.paidAt && <Pill tone="g" className="card-text">Payée le {fD(e.paidAt, { day: 'numeric', month: 'short' })} · {e.methodLabel}</Pill>}
                    </Pills>
                    <CardText>
                      {[e.supplier, e.reference && `n° ${e.reference}`, e.note].filter(Boolean).join(' · ') || `Saisie par ${e.createdBy}`}
                      {e.archiveReason ? ` · archivée : ${e.archiveReason}` : ''}
                    </CardText>
                    <CardActions>
                      {e.state === 'ARCHIVED' ? (
                        <ActionIcon kind="restore" onClick={() => restore.mutate(e.id)} />
                      ) : (
                        <>
                          {!e.paidAt && <ActionIcon kind="pay" primary label="Marquer payée" onClick={() => (setPayDate(todayIso()), setPaying(e))} />}
                          {e.fileName && <ActionIcon kind="pdf" label="Voir le justificatif" onClick={() => openFile(`/expenses/${e.id}/file`).catch((err) => toast(errorMessage(err)))} />}
                          <ActionIcon kind="edit" onClick={() => setForm({ open: true, expense: e })} />
                          <ActionIcon kind="archive" onClick={() => setArchiving(e)} />
                        </>
                      )}
                    </CardActions>
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucune dépense sur cette période.</EmptyState>
            )}
            {d.totals.byCategory.length > 0 && (
              <Section title="Par catégorie">
                <CardGrid list>
                  {d.totals.byCategory.map((c) => (
                    <Card key={c.category}>
                      <CardRow>
                        <h3>{c.label}</h3>
                        <Pill tone="b">{DT(c.total)}</Pill>
                      </CardRow>
                      <Pills>
                        <Pill tone="s">{c.count} dépense(s)</Pill>
                        <Pill tone="g">{d.totals.all ? Math.round((c.total / d.totals.all) * 100) : 0} %</Pill>
                      </Pills>
                    </Card>
                  ))}
                </CardGrid>
              </Section>
            )}
          </>
        )}
      </QueryState>
      <Note>
        Une dépense n’est jamais supprimée : elle est archivée avec un motif (R8) et figure dans l’historique. Les dépenses payées
        s’ajoutent au bilan des statistiques financières.
      </Note>
      <ExpenseModal open={form.open} expense={form.expense} categories={categories.data ?? []} onClose={() => setForm({ open: false })} />
      <Modal
        open={Boolean(paying)}
        title={paying ? `Payer · ${paying.label}` : ''}
        onClose={() => setPaying(undefined)}
        footer={
          <>
            <Button onClick={() => setPaying(undefined)}>Annuler</Button>
            <Button variant="primary" data-primary onClick={() => pay.mutate()} disabled={pay.isPending}>
              Enregistrer le paiement
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Pills>{paying && <Pill tone="b">{DT(paying.amount)}</Pill>}</Pills>
          <TextField label="Payée le" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          <SelectField label="Mode de paiement" value={payMethod} onChange={(e) => setPayMethod(e.target.value as Method)}>
            {METHODS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </SelectField>
        </div>
      </Modal>
      <ConfirmModal
        open={Boolean(archiving)}
        title="Archiver la dépense ?"
        text={`${archiving?.label ?? ''} : elle sort des totaux mais reste dans l’historique (restaurable).`}
        cta="Archiver"
        withMotif
        pending={archive.isPending}
        onConfirm={(reason) => archive.mutate(reason)}
        onClose={() => setArchiving(undefined)}
      />
    </>
  );
}
