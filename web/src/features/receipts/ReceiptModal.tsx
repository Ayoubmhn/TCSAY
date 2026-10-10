import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { CardText } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { FormGrid, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { DT, formatDate, formatDateTime, fullName } from '../../lib/format';
import type { PaymentReceipts, Receipt } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { openPrintTab, receiptPrintUrl, type PrintMode } from './receiptPrint';

export const METHOD_LABEL = { CASH: 'Espèces', CHEQUE: 'Chèque', ONLINE: 'En ligne' } as const;
const KEYS = [['installments'], ['receipts'], ['payment-receipt'], ['audit']];

/** Reçu valide : impression sur le carnet, PDF, annulation avec motif. */
export function ReceiptActions({ receipt, onVoided }: { receipt: Receipt; onVoided?: () => void }) {
  const [voiding, setVoiding] = useState(false);
  const voidReceipt = useAction((reason: string) => api.post(`/receipts/${receipt.id}/void`, { reason }), {
    invalidate: KEYS,
    success: `Reçu n° ${receipt.numberText} annulé.`,
    onSuccess: () => {
      setVoiding(false);
      onVoided?.();
    },
  });
  const open = (mode: PrintMode) => window.open(receiptPrintUrl(receipt.id, mode), '_blank');
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => open('carnet')} disabled={Boolean(receipt.voidedAt)}>
          {receipt.printCount ? 'Réimprimer sur le carnet' : 'Imprimer sur le carnet'}
        </Button>
        <Button onClick={() => open('pdf')} disabled={Boolean(receipt.voidedAt)}>
          Reçu PDF
        </Button>
        {!receipt.voidedAt && (
          <Button variant="danger" onClick={() => setVoiding(true)}>
            Annuler le reçu
          </Button>
        )}
      </div>
      <ConfirmModal
        open={voiding}
        title={`Annuler le reçu n° ${receipt.numberText} ?`}
        text="Le numéro reste dans l’historique et ne pourra pas être réutilisé (reçu raté, erreur de saisie…). Le paiement n’est pas modifié (R7)."
        cta="Annuler le reçu"
        withMotif
        pending={voidReceipt.isPending}
        onConfirm={(motif) => voidReceipt.mutate(motif)}
        onClose={() => setVoiding(false)}
      />
    </>
  );
}

/** Ligne d'historique : numéro, état, impressions. */
export function ReceiptSummary({ receipt: r }: { receipt: Receipt }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Pills>
        <Pill tone="b">Reçu n° {r.numberText}</Pill>
        <Pill tone={r.voidedAt ? 'r' : 'g'}>{r.voidedAt ? 'Annulé' : 'Valide'}</Pill>
        <Pill tone="s">{r.printCount ? `Imprimé ${r.printCount} fois` : 'Pas encore imprimé'}</Pill>
      </Pills>
      <CardText>
        Émis le {formatDate(r.issuedOn)} par {r.issuedBy} · reçu de {r.payerName}
        {r.lastPrintedAt ? ` · dernière impression ${formatDateTime(r.lastPrintedAt)}` : ''}
      </CardText>
      {r.voidedAt && (
        <CardText>
          Annulé le {formatDateTime(r.voidedAt)} par {r.voidedBy} · motif : {r.voidReason}
        </CardText>
      )}
    </div>
  );
}

/**
 * Reçu d'un paiement (administration) : saisie du n° pré-imprimé du carnet (obligatoire, pour l'historique),
 * valeurs proposées modifiables, puis impression sur le carnet ou PDF.
 */
export function ReceiptModal({ paymentId, onClose }: { paymentId?: string; onClose: () => void }) {
  const toast = useToast();
  const q = useQuery({
    queryKey: ['payment-receipt', paymentId],
    queryFn: () => api.get<PaymentReceipts>(`/payments/${paymentId}/receipt`),
    enabled: Boolean(paymentId),
  });
  const data = q.data;
  const [form, setForm] = useState({ number: '', payerName: '', amountWords: '', label: '', chequeNumber: '', issuedOn: '' });
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!data) return;
    setForm({ ...data.draft, number: data.next ? String(data.next) : '' });
  }, [data]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useAction(
    (_mode: PrintMode) =>
      api.post<Receipt>(`/payments/${paymentId}/receipts`, {
        number: Number(form.number),
        payerName: form.payerName.trim(),
        amountWords: form.amountWords.trim(),
        label: form.label.trim(),
        chequeNumber: form.chequeNumber.trim() || undefined,
        issuedOn: form.issuedOn,
      }),
    { invalidate: KEYS, success: (r) => `Reçu n° ${r.numberText} enregistré.` },
  );

  const submit = (mode: PrintMode) => (e?: FormEvent) => {
    e?.preventDefault();
    if (!/^\d{1,8}$/.test(form.number.trim()) || Number(form.number) < 1) {
      return toast('Saisissez le n° imprimé en haut du reçu du carnet (chiffres seulement).');
    }
    if (form.payerName.trim().length < 2) return toast('Indiquez le nom de la personne qui paie.');
    if (form.amountWords.trim().length < 2) return toast('Indiquez le montant en lettres.');
    // L'onglet s'ouvre dans le clic (sinon bloqué par le navigateur), puis affiche le reçu enregistré.
    const tab = openPrintTab();
    setPending(true);
    create
      .mutateAsync(mode)
      .then((r) => {
        tab.go(receiptPrintUrl(r.id, mode));
        onClose();
      })
      // L'erreur (« R7 · n° déjà utilisé »…) est affichée en toast par useAction.
      .catch(() => tab.close())
      .finally(() => setPending(false));
  };

  const p = data?.payment;
  return (
    <Modal
      open={Boolean(paymentId)}
      size="lg"
      title={data?.active ? `Reçu n° ${data.active.numberText}` : 'Émettre le reçu'}
      onClose={onClose}
      footer={
        data && !data.active ? (
          <>
            <Button onClick={onClose}>Fermer</Button>
            <Button onClick={submit('pdf')} disabled={pending}>
              Enregistrer · reçu PDF
            </Button>
            <Button variant="primary" onClick={submit('carnet')} disabled={pending}>
              Enregistrer et imprimer sur le carnet
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Fermer</Button>
        )
      }
    >
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {data && p && (
          <>
            <Pills>
              <Pill tone="s">{fullName(p.player)}</Pill>
              <Pill tone="b">
                Tranche {p.installment.number}/{p.installment.count}
              </Pill>
              <Pill tone="g">{DT(p.amount)}</Pill>
              <Pill tone="s">{METHOD_LABEL[p.method]}</Pill>
              <Pill tone="b">{formatDate(p.paidAt.slice(0, 10))}</Pill>
            </Pills>
            {data.active ? (
              <>
                <ReceiptSummary receipt={data.active} />
                <ReceiptActions receipt={data.active} />
              </>
            ) : (
              <FormGrid id="receipt-form" onSubmit={submit('carnet')}>
                <TextField
                  label="N° du reçu (imprimé sur le carnet)"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="ex. 0002313"
                  value={form.number}
                  onChange={set('number')}
                />
                <TextField label="Date du reçu" type="date" value={form.issuedOn} onChange={set('issuedOn')} />
                <TextField label="Reçu de (nom imprimé)" full value={form.payerName} onChange={set('payerName')} />
                <TextField label="Montant en lettres (arabe)" full dir="rtl" value={form.amountWords} onChange={set('amountWords')} />
                <TextField label="Libellé de la tranche" value={form.label} onChange={set('label')} />
                {p.method === 'CHEQUE' && <TextField label="N° du chèque" value={form.chequeNumber} onChange={set('chequeNumber')} />}
              </FormGrid>
            )}
            {!data.active && (
              <p className="m-0 text-[13px] text-mut">
                {data.last ? `Dernier n° enregistré : ${String(data.last).padStart(7, '0')}. ` : ''}
                Vérifiez que le n° correspond au reçu placé dans l’imprimante : il ne pourra plus être réutilisé.
              </p>
            )}
            {data.history.filter((r) => r.voidedAt).length > 0 && (
              <div className="flex flex-col gap-2 border-t-[1.5px] border-line pt-3">
                <b className="text-[13px] font-semibold text-mut">Reçus annulés pour ce paiement</b>
                {data.history
                  .filter((r) => r.voidedAt)
                  .map((r) => (
                    <ReceiptSummary key={r.id} receipt={r} />
                  ))}
              </div>
            )}
          </>
        )}
      </QueryState>
    </Modal>
  );
}
