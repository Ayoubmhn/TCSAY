import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { todayIso } from '../../lib/format';
import type { Receipt, ReceiptLayout } from '../../lib/types';
import { readLayoutDraft, type PrintMode } from './receiptPrint';
import { ReceiptSheet, type ReceiptValues } from './ReceiptSheet';

/** Valeurs d'exemple de la page de test (aucune donnée réelle). */
const SAMPLE: ReceiptValues = {
  numberText: '0000000',
  payerName: 'Nom Prénom (exemple)',
  amount: 300,
  amountWords: 'ثلاثمائة دينار',
  label: '1ère tranche',
  method: 'CASH',
  chequeNumber: null,
  seasonLabel: '2026-2027',
  issuedOn: todayIso(),
};

/**
 * Impression d'un reçu (onglet séparé, hors menu) : sur le carnet pré-imprimé (A5 à l'italienne, valeurs seules)
 * ou reçu complet à enregistrer en PDF. `/impression/recu-test` : page de réglage avec repères.
 */
export function ReceiptPrintPage({ test = false }: { test?: boolean }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const toast = useToast();
  const mode: PrintMode = params.get('mode') === 'pdf' ? 'pdf' : 'carnet';
  const guides = test && params.get('reperes') === '1';
  const auto = params.get('auto') === '1';

  const layoutQ = useQuery({ queryKey: ['receipt-layout'], queryFn: () => api.get<ReceiptLayout>('/receipts/layout') });
  const receiptQ = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => api.get<Receipt>(`/receipts/${id}`),
    enabled: !test && Boolean(id),
  });
  const layout = (test && readLayoutDraft()) || layoutQ.data;
  const receipt = receiptQ.data;
  const values: ReceiptValues | undefined = test ? SAMPLE : receipt;
  const ready = Boolean(layout && values);
  const [printing, setPrinting] = useState(false);
  const autoDone = useRef(false);

  // Format de page du reçu (remplace l'A4 par défaut) et nom du fichier PDF proposé.
  useEffect(() => {
    if (!layout) return;
    const style = document.createElement('style');
    style.textContent = `@page { size: ${layout.pageWidth}mm ${layout.pageHeight}mm; margin: 0; }
@media print { html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .receipt-screen { padding: 0 !important; display: block !important; }
  .receipt-frame { border: 0 !important; padding: 0 !important; background: none !important; transform: none !important; }
  .receipt-sheet { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [layout]);
  useEffect(() => {
    const previous = document.title;
    document.title = test ? 'Reçu - page de test' : `Reçu ${values?.numberText ?? ''}`.trim();
    return () => {
      document.title = previous;
    };
  }, [test, values?.numberText]);

  const print = async () => {
    if (!ready || receipt?.voidedAt) return;
    setPrinting(true);
    try {
      if (!test && receipt) await api.post(`/receipts/${receipt.id}/printed`, { kind: mode === 'pdf' ? 'PDF' : 'CARNET' });
      await document.fonts?.ready;
      window.print();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setPrinting(false);
    }
  };

  // Ouverture depuis « Imprimer » : la fenêtre d'impression s'ouvre seule une fois le reçu chargé.
  useEffect(() => {
    if (!auto || !ready || autoDone.current || receipt?.voidedAt) return;
    autoDone.current = true;
    const t = setTimeout(() => void print(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, ready]);

  return (
    <div className="receipt-screen flex min-h-full flex-col items-center gap-4 bg-bg px-4 py-6">
      <div className="no-print flex w-full max-w-[860px] flex-col gap-3">
        <h1 className="m-0 text-[23px] font-semibold">
          {test ? 'Page de test du carnet' : mode === 'pdf' ? 'Reçu PDF' : 'Impression sur le carnet'}
        </h1>
        <Pills>
          {values && <Pill tone="b">Reçu n° {values.numberText}</Pill>}
          <Pill tone="s">{mode === 'pdf' ? 'Reçu complet' : 'Valeurs seules, sur le reçu pré-imprimé'}</Pill>
          {layout && (
            <Pill tone="s">
              A5 paysage · {layout.pageWidth} × {layout.pageHeight} mm
            </Pill>
          )}
          {receipt?.voidedAt && <Pill tone="r">Reçu annulé</Pill>}
        </Pills>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void print()} disabled={!ready || printing || Boolean(receipt?.voidedAt)}>
            {mode === 'pdf' ? 'Enregistrer en PDF' : 'Imprimer'}
          </Button>
          <Button onClick={() => window.close()}>Fermer</Button>
        </div>
        <Note>
          Dans la fenêtre d’impression : format <b>A5</b>, orientation <b>paysage</b>, marges <b>aucune</b>, échelle <b>100 %</b>,
          sans en-têtes ni pieds de page.{' '}
          {mode === 'pdf'
            ? 'Destination : « Enregistrer au format PDF ».'
            : test
              ? 'Imprimez sur une feuille blanche, superposez-la à un reçu du carnet devant une lumière, puis ajustez le réglage.'
              : 'Placez le reçu du carnet dans le bac, face imprimée vers le haut, en haut à gauche.'}
        </Note>
      </div>
      <QueryState isPending={layoutQ.isPending || (!test && receiptQ.isPending)} error={layoutQ.error ?? receiptQ.error} refetch={() => void layoutQ.refetch()}>
        {layout && values && (
          <div className="receipt-frame overflow-auto rounded-[24px] border-[1.5px] border-line bg-fld p-4">
            <ReceiptSheet mode={mode} layout={layout} values={values} guides={guides} className="border border-line" />
          </div>
        )}
      </QueryState>
    </div>
  );
}
