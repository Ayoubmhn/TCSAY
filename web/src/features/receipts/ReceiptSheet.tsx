import type { CSSProperties, ReactNode } from 'react';
import type { ReceiptField, ReceiptLayout } from '../../lib/types';

/** Valeurs imprimées sur un reçu (celles enregistrées avec le numéro du carnet). */
export type ReceiptValues = {
  numberText: string;
  payerName: string;
  amount: number;
  amountWords: string;
  label: string;
  method: 'CASH' | 'CHEQUE' | 'ONLINE';
  chequeNumber: string | null;
  seasonLabel: string;
  issuedOn: string;
};

export const FIELD_LABEL: Record<ReceiptField, string> = {
  label: 'Tranche',
  payerName: 'Reçu de (nom)',
  amountWords: 'Montant en lettres',
  amountDigits: 'Montant en chiffres',
  barCheque: 'Trait sur « chèque » (espèces)',
  barCash: 'Trait sur « espèces » (chèque)',
  chequeNumber: 'N° du chèque',
  season: 'Saison',
  date: 'Date',
};

/** 300 → « 300,000 » (dinars et millimes, comme sur le carnet). */
export const amountDigits = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).replace(/ | /g, ' ');

/** « 2026-09-30 » → « 30/09/2026 ». */
export const dateFr = (iso: string) => iso.split('-').reverse().join('/');

/** « 2026-2027 » → « 2026/2027 ». */
const seasonText = (label: string) => label.replace('-', '/');

const ARABIC_FONT = "Montserrat, 'Segoe UI', Tahoma, 'Noto Naskh Arabic', Arial, sans-serif";

/**
 * Feuille de reçu A5 à l'italienne.
 * - `carnet` : seulement les valeurs, placées au millimètre sur le reçu pré-imprimé du club.
 * - `pdf` : le reçu complet (en-tête, textes du carnet, valeurs), pour l'enregistrer en PDF.
 * - `guides` : en plus, cadre de la feuille et repères de chaque champ (page de réglage).
 */
export function ReceiptSheet({
  mode,
  layout,
  values,
  guides = false,
  className = '',
}: {
  mode: 'carnet' | 'pdf';
  layout: ReceiptLayout;
  values: ReceiptValues;
  guides?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`receipt-sheet relative box-border overflow-hidden bg-white text-black ${className}`}
      style={{ width: `${layout.pageWidth}mm`, height: `${layout.pageHeight}mm`, fontFamily: ARABIC_FONT }}
    >
      {mode === 'carnet' ? <CarnetFields layout={layout} values={values} guides={guides} /> : <FullReceipt layout={layout} values={values} />}
    </div>
  );
}

function CarnetFields({ layout, values, guides }: { layout: ReceiptLayout; values: ReceiptValues; guides: boolean }) {
  const { fields: f, offsetX, offsetY, fontSize } = layout;
  const line = (fontSize * 0.3528 * 1.35).toFixed(2); // hauteur de ligne en mm
  const box = (key: ReceiptField, align: CSSProperties['justifyContent'], children: ReactNode, rtl = false) => (
    <div
      key={key}
      data-field={key}
      className={`absolute flex items-end overflow-hidden whitespace-nowrap ${guides ? 'outline outline-[0.2mm] outline-[#5a5acd]' : ''}`}
      dir={rtl ? 'rtl' : 'ltr'}
      style={{
        left: `${f[key].x + offsetX}mm`,
        top: `calc(${f[key].y + offsetY}mm - ${line}mm)`,
        width: `${f[key].w}mm`,
        height: `${line}mm`,
        justifyContent: align,
        fontSize: `${fontSize}pt`,
        lineHeight: 1.1,
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
  const bar = (key: ReceiptField) => (
    <div
      key={key}
      data-field={key}
      className="absolute"
      style={{ left: `${f[key].x + offsetX}mm`, top: `${f[key].y + offsetY}mm`, width: `${f[key].w}mm`, borderTop: '0.5mm solid #000' }}
    />
  );
  const cash = values.method !== 'CHEQUE';
  return (
    <>
      {guides && (
        <>
          <div className="absolute inset-0 border-[0.3mm] border-dashed border-black" aria-hidden="true" />
          {Object.entries(f).map(([key, b]) => (
            <span
              key={`g-${key}`}
              aria-hidden="true"
              className="absolute text-[6pt] text-[#5a5acd]"
              style={{ left: `${b.x + offsetX}mm`, top: `${b.y + offsetY + 0.6}mm` }}
            >
              {FIELD_LABEL[key as ReceiptField]}
            </span>
          ))}
        </>
      )}
      {box('label', 'flex-start', values.label)}
      {box('payerName', 'flex-end', values.payerName)}
      {box('amountWords', 'flex-start', values.amountWords, true)}
      {box('amountDigits', 'center', amountDigits(values.amount))}
      {cash ? bar('barCheque') : bar('barCash')}
      {!cash && values.chequeNumber && box('chequeNumber', 'flex-end', values.chequeNumber)}
      {box('season', 'center', seasonText(values.seasonLabel))}
      {box('date', 'center', dateFr(values.issuedOn))}
    </>
  );
}

/** Reçu complet, fidèle au carnet du club (A5 à l'italienne). */
function FullReceipt({ layout, values }: { layout: ReceiptLayout; values: ReceiptValues }) {
  const cash = values.method !== 'CHEQUE';
  const dotted = 'border-b border-dotted border-black';
  const val = 'px-[2mm] font-semibold';
  return (
    <div className="flex h-full flex-col px-[10mm] pt-[7mm] pb-[6mm] text-[10.5pt]">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-[4mm]">
        <div className="text-[12pt] font-semibold tracking-wide">TENNIS CLUB DE SAYADA</div>
        <img src="/logo-tcsay.png" alt="" className="h-[22mm] w-[22mm] object-contain" />
        <div dir="rtl" className="text-[15pt] font-semibold">
          نادي التنس بصيادة
        </div>
      </header>
      <div className="mt-[1mm] flex justify-end text-[11pt] font-semibold italic">{values.label}</div>
      <div className="mt-[2mm] flex items-baseline justify-center gap-[10mm]">
        <span className="font-mono text-[13pt] tracking-wider">{values.numberText}</span>
        <span dir="rtl" className="text-[17pt] font-semibold">
          وصل إشتراك
        </span>
      </div>

      <div dir="rtl" className="mt-[5mm] flex flex-col gap-[4.5mm]">
        <div className="flex items-end gap-[2mm]">
          <span className="whitespace-nowrap">توصلت من السيد:</span>
          <span className={`${dotted} ${val} flex-1`} dir="auto">
            {values.payerName}
          </span>
          <span className="whitespace-nowrap">ما قدره:</span>
          <span className={`${dotted} ${val} flex-[1.4]`}>{values.amountWords}</span>
        </div>
        <div className="flex items-end gap-[2mm]">
          <span className={`${dotted} ${val} w-[38mm] text-center`} dir="ltr">
            {amountDigits(values.amount)} د.ت
          </span>
          <span className={cash ? '' : 'line-through decoration-[0.5mm]'}>نقدا</span>
          <span>/</span>
          <span className={cash ? 'line-through decoration-[0.5mm]' : ''}>صكا . عدد الصك</span>
          <span className={`${dotted} ${val} flex-1`} dir="ltr">
            {!cash && values.chequeNumber ? values.chequeNumber : ''}
          </span>
        </div>
        <div>وذلك بعنوان اشتراك لفائدة نادي التنس بصيادة</div>
        <div className="flex flex-col items-center gap-[3mm]">
          <div className="flex items-end gap-[2mm]">
            <span className="whitespace-nowrap">الموسم الرياضي</span>
            <span className={`${dotted} ${val} w-[38mm] text-center`} dir="ltr">
              {seasonText(values.seasonLabel)}
            </span>
          </div>
          <div className="flex items-end gap-[2mm]">
            <span className="whitespace-nowrap">صيادة في</span>
            <span className={`${dotted} ${val} w-[38mm] text-center`} dir="ltr">
              {dateFr(values.issuedOn)}
            </span>
          </div>
        </div>
      </div>

      {/* Signatures : place laissée pour le cachet et la signature */}
      <div dir="rtl" className="mt-[3mm] grid flex-1 grid-cols-2 px-[8mm]">
        <div className="text-start">رئيس النادي</div>
        <div className="text-end">أمين المال</div>
      </div>

      <footer className="border-t-[0.4mm] border-black pt-[2mm] text-center text-[8pt] leading-snug">
        {layout.footer.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </footer>
    </div>
  );
}
