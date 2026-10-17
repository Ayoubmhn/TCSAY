import { useQuery } from '@tanstack/react-query';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { useEffect, useState } from 'react';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { CardGrid, EmptyState } from '../../components/ui/Card';
import { FilterSelect, Filters, TextField } from '../../components/ui/Field';
import { InstallmentCard } from '../../components/ui/InstallmentCard';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { Segmented } from '../../components/ui/Segmented';
import { useToast } from '../../components/ui/Toast';
import { usePaymentConfig } from '../../lib/payment-config';
import { api } from '../../lib/api';
import { DT, fD, fullName } from '../../lib/format';
import { METHOD_LABEL, ReceiptModal } from '../../features/receipts/ReceiptModal';
import type { Group, Installment, Parent } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const KEYS = [['installments'], ['dashboard'], ['audit'], ['overview']];

/** Dernier encaissement d'une tranche (celui qu'on vient d'enregistrer). */
const lastPayment = (i: Installment) => [...(i.payments ?? [])].filter((p) => p.kind === 'PAYMENT').pop();

/** Nouvelle date limite d'une tranche non soldée (motif obligatoire, audit) : la famille sera prévenue si elle est dépassée. */
function DueDateModal({ installment: i, onClose }: { installment?: Installment; onClose: () => void }) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (i) (setDate(i.dueDate), setReason(''));
  }, [i]);
  const save = useAction(() => api.patch(`/installments/${i!.id}/due-date`, { dueDate: date, reason: reason.trim() }), {
    invalidate: KEYS,
    success: 'Date limite modifiée.',
    onSuccess: onClose,
  });
  return (
    <Modal
      open={Boolean(i)}
      title={i ? `Date limite · ${fullName(i.player)} · tranche ${i.number}/${i.count}` : ''}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={() => save.mutate()} disabled={!date || !reason.trim() || save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <TextField label="Nouvelle date limite" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <TextField label="Motif *" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="ex. accord avec la famille" />
      </div>
    </Modal>
  );
}

type GroupBy = 'parent' | 'player' | 'due' | 'none';
const MONTH = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

/** Regroupe les tranches : par famille (parents), par joueur ou par mois d'échéance. */
function groupInstallments(list: Installment[], by: GroupBy): { key: string; title: string; items: Installment[] }[] {
  if (by === 'none') return [{ key: 'all', title: '', items: list }];
  const map = new Map<string, { key: string; title: string; items: Installment[]; sort: string }>();
  for (const i of list) {
    const key =
      by === 'player' ? i.player.id : by === 'due' ? i.dueDate.slice(0, 7) : (i.parents ?? []).map((p) => p.id).sort().join('|') || `sans-${i.player.id}`;
    const title =
      by === 'player'
        ? fullName(i.player)
        : by === 'due'
          ? `Échéance ${MONTH(i.dueDate)}`
          : i.parents?.length
            ? `Famille ${i.parents.map((p) => fullName(p)).join(' · ')}`
            : `${fullName(i.player)} (sans parent)`;
    const sort = by === 'due' ? key : title.toLocaleLowerCase('fr');
    if (!map.has(key)) map.set(key, { key, title, items: [], sort });
    map.get(key)!.items.push(i);
  }
  return [...map.values()].sort((a, b) => a.sort.localeCompare(b.sort, 'fr'));
}

function readGroupBy(): GroupBy {
  try {
    const v = localStorage.getItem('tcsay-paiements-groupe');
    return v === 'player' || v === 'due' || v === 'none' ? v : 'parent';
  } catch {
    return 'parent';
  }
}

const METHODS = { CASH: 'Espèces', CHEQUE: 'Chèque', TRANSFER: 'Virement' } as const;
type Method = keyof typeof METHODS;

function CashModal({
  installment: i,
  following = 0,
  onClose,
  onCashed,
}: {
  installment?: Installment;
  /** Restant des tranches suivantes de la même cotisation (paiement de plusieurs tranches en une fois). */
  following?: number;
  onClose: () => void;
  /** Encaissement enregistré : ouverture du reçu. */
  onCashed: (paymentId: string) => void;
}) {
  const toast = useToast();
  const cfg = usePaymentConfig(Boolean(i));
  const methods = (cfg.data?.collect.methods ?? ['CASH', 'CHEQUE']) as Method[];
  const multi = Boolean(cfg.data?.collect.multi) && following > 0;
  const receiptRequired = Boolean(cfg.data?.collect.receiptRequired);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('CASH');
  const [chequeNumber, setChequeNumber] = useState('');
  const [receipt, setReceipt] = useState('');
  const next = useQuery({ queryKey: ['receipt-next'], queryFn: () => api.get<{ next: number | null }>('/receipts/next'), enabled: Boolean(i) && receiptRequired });
  useEffect(() => {
    setAmount(i ? String(i.remaining) : '');
    setMethod('CASH');
    setChequeNumber('');
    setReceipt('');
  }, [i]);
  useEffect(() => {
    if (i && receiptRequired && next.data?.next && !receipt) setReceipt(String(next.data.next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, receiptRequired, next.data]);
  const max = i ? Math.round((i.remaining + (multi ? following : 0)) * 1000) / 1000 : 0;
  const cash = useAction(
    () =>
      api.post<Installment & { paymentId?: string }>(`/installments/${i!.id}/payments`, {
        amount: Number(amount),
        method,
        chequeNumber: method === 'CHEQUE' ? chequeNumber.trim() || undefined : undefined,
        spread: multi && Number(amount) > i!.remaining ? true : undefined,
        receiptNumber: receipt.trim() ? Number(receipt.replace(/\D/g, '')) : undefined,
      }),
    {
      invalidate: [...KEYS, ['receipts'], ['receipt-next']],
      success: () => `${DT(Number(amount))} encaissés pour ${i?.player.firstName}.`,
      onSuccess: (r) => {
        onClose();
        const id = r.paymentId ?? lastPayment(r)?.id;
        if (id) onCashed(id);
      },
    },
  );
  const confirm = () => {
    const v = Number(amount);
    if (!v || v <= 0) return toast('Saisissez un montant positif.');
    if (i && v > max + 1e-9) return toast(`Montant supérieur au restant (${DT(max)}).`);
    if (method === 'CHEQUE' && !chequeNumber.trim()) return toast('Saisissez le n° du chèque.');
    if (receiptRequired && !receipt.trim()) return toast('Saisissez le n° du reçu du carnet.');
    cash.mutate();
  };
  return (
    <Modal
      open={Boolean(i)}
      title="Encaisser un paiement"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={confirm} disabled={cash.isPending}>
            Encaisser
          </Button>
        </>
      }
    >
      {i && (
        <Pills>
          <Pill tone="s">{fullName(i.player)}</Pill>
          <Pill tone="b">
            Tranche {i.number}/{i.count}
          </Pill>
          <Pill tone="r">Restant {DT(i.remaining)}</Pill>
          {multi && <Pill tone="s">Tranches suivantes {DT(following)}</Pill>}
        </Pills>
      )}
      <TextField
        label={multi ? `Montant reçu (DT) · jusqu’à ${DT(max)} sur plusieurs tranches` : 'Montant reçu (DT)'}
        type="number"
        min={0.001}
        max={max}
        step="0.001"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      {methods.length > 1 && (
        <Segmented label="Mode de paiement" options={methods.map((m) => ({ value: m, label: METHODS[m] }))} value={method} onChange={setMethod} />
      )}
      {method === 'CHEQUE' && <TextField label="N° du chèque" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} />}
      {multi && Number(amount) > (i?.remaining ?? 0) && (
        <Pill tone="b" className="self-start whitespace-normal">
          Le surplus va sur les tranches suivantes : un seul reçu pour l’ensemble.
        </Pill>
      )}
      <TextField
        label={receiptRequired ? 'N° du reçu du carnet *' : 'N° du reçu du carnet (facultatif, sinon après)'}
        inputMode="numeric"
        value={receipt}
        onChange={(e) => setReceipt(e.target.value)}
      />
      <p className="m-0 text-[13px] text-mut">
        Une fois encaissé, ce paiement ne pourra plus être modifié ni supprimé (R7). Le reçu s’imprime ensuite depuis la fenêtre du reçu.
      </p>
    </Modal>
  );
}

/** Encaissements d'une tranche avec leur reçu (n° du carnet) ou le bouton pour l'émettre. */
function PaymentLines({ installment: i, onReceipt }: { installment: Installment; onReceipt: (paymentId: string) => void }) {
  const payments = (i.payments ?? []).filter((p) => p.kind === 'PAYMENT');
  if (!payments.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {payments.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="tabular-nums">
            {DT(p.amount)} · {fD(p.paidAt.slice(0, 10), { day: 'numeric', month: 'short' })} · {METHOD_LABEL[p.method]}
            {p.chequeNumber ? ` n° ${p.chequeNumber}` : ''}
          </span>
          {p.receipt ? (
            <button type="button" className="rounded-full bg-pg px-[13px] py-[5px] text-[#111]" onClick={() => onReceipt(p.id)}>
              Reçu n° {p.receipt.number}
            </button>
          ) : (
            <ActionIcon kind="receipt" onClick={() => onReceipt(p.id)} />
          )}
        </div>
      ))}
    </div>
  );
}

/** Paiements (vApay) : tranches de la saison, encaissement en espèces ou par chèque (R7), reçus. */
export function PaymentsAdminPage() {
  const [view, setView] = useViewMode('paiements');
  // Filtres : recherche (joueur ou parent), parent, groupe, état de la tranche.
  const [search, setSearch] = useState('');
  const [parentId, setParentId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [state, setState] = useState<'' | 'TODO' | 'LATE' | 'PAID'>('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const q = useQuery({
    queryKey: ['installments', 'admin', term, parentId, groupId],
    queryFn: () => api.get<Installment[]>('/installments', { q: term || undefined, parentId: parentId || undefined, groupId: groupId || undefined }),
  });
  const parents = useQuery({ queryKey: ['parents'], queryFn: () => api.get<Parent[]>('/parents') });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<Group[]>('/groups') });
  const [cashFor, setCashFor] = useState<Installment>();
  const [dueFor, setDueFor] = useState<Installment>();
  const [groupBy, setGroupByState] = useState<GroupBy>(readGroupBy);
  const setGroupBy = (v: GroupBy) => {
    setGroupByState(v);
    try {
      localStorage.setItem('tcsay-paiements-groupe', v);
    } catch {
      /* préférence non mémorisée */
    }
  };
  const [receiptFor, setReceiptFor] = useState<string>();
  // R7 : la règle vit côté API, l'écran affiche son refus.
  const edit = useAction(() => api.patch('/payments/0'), {});
  const remind = useAction((id: string) => api.post<{ sentTo: string }>(`/installments/${id}/remind`), {
    invalidate: [['emails']],
    success: (r) => `Rappel envoyé à ${r.sentTo}.`,
  });
  const list = (q.data ?? []).filter(
    (i) => !state || (state === 'PAID' ? i.status === 'PAID' : state === 'LATE' ? i.status === 'LATE' : i.status !== 'PAID'),
  );

  return (
    <>
      <PageHeader action={<ViewToggle value={view} onChange={setView} />} title="Paiements" subtitle="Découvrez les tranches de la saison, encaissez les paiements et émettez les reçus." />
      <Filters>
        <input
          className="fld w-[240px] text-fg"
          placeholder="Rechercher un joueur ou un parent"
          aria-label="Rechercher un joueur ou un parent"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FilterSelect label="Filtrer par parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">Tous les parents</option>
          {parents.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {fullName(p)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Filtrer par groupe" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">Tous les groupes</option>
          {groups.data?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Filtrer par état" value={state} onChange={(e) => setState(e.target.value as typeof state)}>
          <option value="">Toutes les tranches</option>
          <option value="TODO">À payer</option>
          <option value="LATE">En retard</option>
          <option value="PAID">Payées</option>
        </FilterSelect>
        <FilterSelect label="Grouper par" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
          <option value="parent">Grouper par famille</option>
          <option value="player">Grouper par joueur</option>
          <option value="due">Grouper par échéance</option>
          <option value="none">Sans regroupement</option>
        </FilterSelect>
        {(search || parentId || groupId || state) && (
          <Button onClick={() => (setSearch(''), setParentId(''), setGroupId(''), setState(''))}>Effacer les filtres</Button>
        )}
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        <Pills className="my-[18px]">
          <Pill tone="b">{list.length} tranche(s)</Pill>
          <Pill tone="g">Encaissé {DT(list.reduce((s, i) => s + i.paid, 0))}</Pill>
          <Pill tone="r">Restant {DT(list.reduce((s, i) => s + i.remaining, 0))}</Pill>
        </Pills>
        {list.length ? (
          groupInstallments(list, groupBy).map((g) => {
            const grid = (
              <CardGrid list={view === 'list'}>
              {g.items.map((i) => (
                <InstallmentCard
                  key={i.id}
                  installment={i}
                  title={fullName(i.player)}
                  bar={false}
                  pills={
                    <>
                      <Pill tone="b">
                        Tranche {i.number}/{i.count}
                      </Pill>
                      <Pill tone="b">{fD(i.dueDate, { day: 'numeric', month: 'short' })}</Pill>
                      {i.groups?.map((g) => (
                        <Pill key={g.id} tone="s" className="card-text">
                          {g.name}
                        </Pill>
                      ))}
                      {i.parents?.length ? <Pill tone="s" className="card-text">Parent : {i.parents.map((p) => fullName(p)).join(', ')}</Pill> : null}
                    </>
                  }
                  action={
                    <>
                    <PaymentLines installment={i} onReceipt={setReceiptFor} />
                    <div className="card-actions flex flex-wrap gap-1.5">
                      {i.remaining ? (
                        <>
                          <ActionIcon kind="pay" primary onClick={() => setCashFor(i)} />
                          <ActionIcon kind="edit" label="Modifier la date limite" onClick={() => setDueFor(i)} />
                          {i.status === 'LATE' && <ActionIcon kind="remind" onClick={() => remind.mutate(i.id)} disabled={remind.isPending} />}
                        </>
                      ) : (
                        <ActionIcon kind="edit" label="Modifier le paiement" onClick={() => edit.mutate()} />
                      )}
                    </div>
                    </>
                  }
                />
              ))}
              </CardGrid>
            );
            if (!g.title) return <div key={g.key}>{grid}</div>;
            const rest = g.items.reduce((t, i) => t + i.remaining, 0);
            const late = g.items.filter((i) => i.status === 'LATE').length;
            return (
              <Section key={g.key} title={g.title}>
                <Pills className="mb-3">
                  <Pill tone="b">{g.items.length} tranche(s)</Pill>
                  <Pill tone="g">Payé {DT(g.items.reduce((t, i) => t + i.paid, 0))}</Pill>
                  {rest > 0 && <Pill tone="r">Restant {DT(rest)}</Pill>}
                  {late > 0 && <Pill tone="r">{late} en retard</Pill>}
                </Pills>
                {grid}
              </Section>
            );
          })
        ) : (
          <EmptyState>Aucune tranche ne correspond à ces filtres.</EmptyState>
        )}
      </QueryState>
      <Note>
        Un paiement encaissé n’est jamais modifié ni supprimé : remboursement ou écriture corrective (R7). Le coach n’a jamais
        accès à cet écran (403).
      </Note>
      <DueDateModal installment={dueFor} onClose={() => setDueFor(undefined)} />
      <CashModal
        installment={cashFor}
        following={
          cashFor
            ? (q.data ?? [])
                .filter((x) => x.player.id === cashFor.player.id && x.season.id === cashFor.season.id && x.number > cashFor.number)
                .reduce((t, x) => t + x.remaining, 0)
            : 0
        }
        onClose={() => setCashFor(undefined)} onCashed={setReceiptFor} />
      <ReceiptModal paymentId={receiptFor} onClose={() => setReceiptFor(undefined)} />
    </>
  );
}
