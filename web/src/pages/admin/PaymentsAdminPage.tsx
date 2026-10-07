import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { CardGrid, EmptyState } from '../../components/ui/Card';
import { TextField } from '../../components/ui/Field';
import { InstallmentCard } from '../../components/ui/InstallmentCard';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { DT, fD, fullName } from '../../lib/format';
import type { Installment } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const KEYS = [['installments'], ['dashboard'], ['audit'], ['overview']];

function CashModal({ installment: i, onClose }: { installment?: Installment; onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  useEffect(() => setAmount(i ? String(i.remaining) : ''), [i]);
  const cash = useAction(() => api.post<Installment>(`/installments/${i!.id}/payments`, { amount: Number(amount) }), {
    invalidate: KEYS,
    success: () => `${DT(Number(amount))} encaissés pour ${i?.player.firstName}.`,
    onSuccess: onClose,
  });
  const confirm = () => {
    const v = Number(amount);
    if (!v || v <= 0) return toast('Saisissez un montant positif.');
    if (i && v > i.remaining) return toast(`Montant supérieur au restant (${DT(i.remaining)}).`);
    cash.mutate();
  };
  return (
    <Modal
      open={Boolean(i)}
      title="Encaisser en espèces"
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
      <p className="m-0 text-[13px] text-mut">Une fois encaissé, ce paiement ne pourra plus être modifié ni supprimé (R7).</p>
    </Modal>
  );
}

/** Paiements (vApay) : tranches de la saison, encaissement en espèces (R7). */
export function PaymentsAdminPage() {
  const q = useQuery({ queryKey: ['installments', 'admin'], queryFn: () => api.get<Installment[]>('/installments') });
  const [cashFor, setCashFor] = useState<Installment>();
  // R7 : la règle vit côté API, l'écran affiche son refus.
  const edit = useAction(() => api.patch('/payments/0'), {});
  const remind = useAction((id: string) => api.post<{ sentTo: string }>(`/installments/${id}/remind`), {
    invalidate: [['emails']],
    success: (r) => `Rappel envoyé à ${r.sentTo}.`,
  });
  const list = q.data ?? [];

  return (
    <>
      <PageHeader title="Paiements" subtitle="Découvrez les tranches de la saison et encaissez les paiements en espèces." />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        <Pills className="my-[18px]">
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
                  </>
                }
                action={
                  i.remaining ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" onClick={() => setCashFor(i)}>
                        Encaisser en espèces
                      </Button>
                      {i.status === 'LATE' && (
                        <Button onClick={() => remind.mutate(i.id)} disabled={remind.isPending}>
                          Envoyer un rappel
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Button onClick={() => edit.mutate()}>Modifier le paiement</Button>
                  )
                }
              />
            ))}
          </CardGrid>
        ) : (
          <EmptyState>Aucune tranche pour cette saison.</EmptyState>
        )}
      </QueryState>
      <Note>
        Un paiement encaissé n’est jamais modifié ni supprimé : remboursement ou écriture corrective (R7). Le coach n’a jamais
        accès à cet écran (403).
      </Note>
      <CashModal installment={cashFor} onClose={() => setCashFor(undefined)} />
    </>
  );
}
