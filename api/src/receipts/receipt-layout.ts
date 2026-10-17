/**
 * Position des champs sur le carnet de reçus pré-imprimé (à l'italienne, 210 × 147 mm mesurés à la règle), en
 * millimètres depuis le coin haut-gauche de la feuille. `y` = ligne d'écriture (bas du texte). Lignes mesurées à la
 * règle sur un reçu du club, colonnes d'après les photos ; l'admin les ajuste au millimètre depuis l'écran Reçus.
 */
export type ReceiptBox = { x: number; y: number; w: number };

export const RECEIPT_FIELDS = [
  'label',
  'payerName',
  'amountWords',
  'amountDigits',
  'barCheque',
  'barCash',
  'chequeNumber',
  'season',
  'date',
] as const;

export type ReceiptField = (typeof RECEIPT_FIELDS)[number];

export type ReceiptLayout = {
  /** Format de la feuille (mm). */
  pageWidth: number;
  pageHeight: number;
  /** Décalage de toute l'impression (mm) : marge de l'imprimante, feuille mal calée. */
  offsetX: number;
  offsetY: number;
  /** Taille du texte imprimé (pt). */
  fontSize: number;
  fields: Record<ReceiptField, ReceiptBox>;
  /** Pied du reçu PDF (coordonnées bancaires du club, imprimées sur le carnet). */
  footer: string[];
};

export const DEFAULT_RECEIPT_LAYOUT: ReceiptLayout = {
  pageWidth: 210,
  pageHeight: 147,
  offsetX: 0,
  offsetY: 0,
  fontSize: 12,
  fields: {
    label: { x: 124, y: 34, w: 46 }, // « 1ère tranche », sous « وصل إشتراك »
    payerName: { x: 90, y: 63.5, w: 62 }, // après « توصلت من السيد: » (ligne à 6,4 cm du haut)
    amountWords: { x: 18, y: 63.5, w: 58 }, // après « ما قدره: »
    amountDigits: { x: 155, y: 75, w: 26 }, // montant en chiffres, avant « نقدا » (ligne à 7,5 cm)
    barCheque: { x: 111, y: 72.5, w: 33 }, // espèces : on barre « صكا . عدد الصك »
    barCash: { x: 146, y: 72.5, w: 8 }, // chèque : on barre « نقدا »
    chequeNumber: { x: 22, y: 75, w: 86 }, // n° du chèque, après « عدد الصك »
    season: { x: 74, y: 101.5, w: 66 }, // après « الموسم الرياضي » (ligne à 10 cm)
    date: { x: 85, y: 117, w: 34 }, // après « صيادة في »
  },
  footer: [
    'Compte Bancaire : BIAT - Ksar Hellal · الحساب البنكي : بنك تونس العربي الدولي',
    'RIB : 08 504 0002420051916 36 - IBAN : TN 59 0850 40002420 0519 1636',
  ],
};

export const RECEIPT_LAYOUT_KEY = 'receipt.layout';

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : fallback;
};

/** Fusionne une configuration enregistrée (ou envoyée) avec les valeurs par défaut, bornes comprises. */
export function normalizeLayout(raw: unknown): ReceiptLayout {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReceiptLayout>;
  const d = DEFAULT_RECEIPT_LAYOUT;
  const pageWidth = clamp(src.pageWidth, 90, 300, d.pageWidth);
  const pageHeight = clamp(src.pageHeight, 90, 300, d.pageHeight);
  const fields = {} as Record<ReceiptField, ReceiptBox>;
  for (const key of RECEIPT_FIELDS) {
    const f = (src.fields as Record<string, Partial<ReceiptBox>> | undefined)?.[key] ?? {};
    fields[key] = {
      x: clamp(f.x, 0, pageWidth, d.fields[key].x),
      y: clamp(f.y, 0, pageHeight, d.fields[key].y),
      w: clamp(f.w, 2, pageWidth, d.fields[key].w),
    };
  }
  const footer = Array.isArray(src.footer) ? src.footer.map((l) => String(l).slice(0, 160)).slice(0, 3) : d.footer;
  return {
    pageWidth,
    pageHeight,
    offsetX: clamp(src.offsetX, -30, 30, d.offsetX),
    offsetY: clamp(src.offsetY, -30, 30, d.offsetY),
    fontSize: clamp(src.fontSize, 7, 18, d.fontSize),
    fields,
    footer,
  };
}
