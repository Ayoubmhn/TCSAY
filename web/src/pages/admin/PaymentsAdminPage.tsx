import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { CardGrid, EmptyState } from '../../components/ui/Card';
import { FilterSelect, Filters, TextField } from '../../components/ui/Field';
import { InstallmentCard } from '../../components/ui/InstallmentCard';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Segmented } from '../../components/ui/Segmented';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { DT, fD, fullName } from '../../lib/format';
import { METHOD_LABEL, ReceiptModal } from '../../features/receipts/ReceiptModal';
import type { Group, Installment, Parent } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const KEYS = [['installments'], ['dashboard'], ['audit'], ['overview']];

/** Dernier encaissement d'une tranche (celui qu'on vient d'enregistrer). */
const lastPayment = (i: Installment) => [...(i.payments ?? [])].filter((p) => p.kind === 'PAYMENT').pop();

function CashModal({
  installment: i,
  onClose,
  onCashed,
}: {
  installment?: Installment;
  onClose: () => void;
  /** Encaissement enregistré : ouverture du reçu. */
  onCashed: (paymentId: string) => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'CHEQUE'>('CASH');
  const [chequeNumber, setChequeNumber] = useState('');
  useEffect(() => {
    setAmount(i ? String(i.remaining) : '');
    setMethod('CASH');
    setChequeNumber('');
  }, [i]);
  const cash = useAction(
    () =>
      api.post<Installment>(`/installments/${i!.id}/payments`, {
        amount: Number(amount),
        method,
        chequeNumber: method === 'CHEQUE' ? chequeNumber.trim() || undefined : undefined,
      }),
    {
      invalidate: KEYS,
      success: () => `${DT(Number(amount))} encaissés pour ${i?.player.firstName}.`,
      onSuccess: (r) => {
        onClose();
        const p = lastPayment(r);
        if (p) onCashed(p.id);
      },
    },
  );
  const confirm = () => {
    const v = Number(amount);
    if (!v || v <= 0) return toast('Saisissez un montant positif.');
    if (i && v > i.remaining) return toast(`Montant supérieur au restant (${DT(i.remaining)}).`);
    if (method === 'CHEQUE' && !chequeNumber.trim()) return toast('Saisissez le n° du chèque.');
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
        </Pills>
      )}
      <TextField
        label="Montant reçu (DT)"
        type="number"
        min={0.001}
        max={i?.remaining}
        step="0.001"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Segmented
        label="Mode de paiement"
        options={[
          { value: 'CASH', label: 'Espèces' },
          { value: 'CHEQUE', label: 'Chèque' },
        ]}
        value={method}
        onChange={setMethod}
      />
      {method === 'CHEQUE' && <TextField label="N° du chèque" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} />}
      <p className="m-0 text-[13px] text-mut">
        Une fois encaissé, ce paiement ne pourra plus être modifié ni supprimé (R7). Le reçu s’émet ensuite avec le n° du carnet.
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
            <button type="button" className="rounded-full bg-btn px-[13px] py-[5px] font-medium text-fg" onClick={() => onReceipt(p.id)}>
              Émettre le reçu
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Paiements (vApay) : tranches de la saison, encaissement en espèces ou par chèque (R7), reçus. */
export function PaymentsAdminPage() {
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
      <PageHeader title="Paiements" subtitle="Découvrez les tranches de la saison, encaissez les paiements et émettez les reçus." />
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
          <CardGrid>
            {list.map((i) => (
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
                      <Pill key={g.id} tone="s">
                        {g.name}
                      </Pill>
                    ))}
                    {i.parents?.length ? <Pill tone="s">Parent : {i.parents.map((p) => fullName(p)).join(', ')}</Pill> : null}
                  </>
                }
                action={
                  <>
                  <PaymentLines installment={i} onReceipt={setReceiptFor} />
                  {i.remaining ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" onClick={() => setCashFor(i)}>
                        Encaisser
                      </Button>
                      {i.status === 'LATE' && (
                        <Button onClick={() => remind.mutate(i.id)} disabled={remind.isPending}>
                          Envoyer un rappel
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Button onClick={() => edit.mutate()}>Modifier le paiement</Button>
                  )}
                  </>
                }
              />
            ))}
          </CardGrid>
        ) : (
          <EmptyState>Aucune tranche ne correspond à ces filtres.</EmptyState>
        )}
      </QueryState>
      <Note>
        Un paiement encaissé n’est jamais modifié ni supprimé : remboursement ou écriture corrective (R7). Le coach n’a jamais
        accès à cet écran (403).
      </Note>
      <CashModal installment={cashFor} onClose={() => setCashFor(undefined)} onCashed={setReceiptFor} />
      <ReceiptModal paymentId={receiptFor} onClose={() => setReceiptFor(undefined)} />
    </>
  );
}
