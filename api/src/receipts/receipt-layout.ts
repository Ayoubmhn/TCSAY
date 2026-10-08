/**
 * Position des champs sur le carnet de reçus pré-imprimé (A5 à l'italienne, 210 × 148 mm), en millimètres
 * depuis le coin haut-gauche de la feuille. `y` = ligne d'écriture (bas du texte). Mesures relevées sur la photo
 * d'un reçu du club (redressée au format A5) ; l'admin les ajuste au millimètre (décalage global ou champ par champ) depuis l'écran Reçus.
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
  pageHeight: 148,
  offsetX: 0,
  offsetY: 0,
  fontSize: 12,
  fields: {
    label: { x: 124, y: 32, w: 46 }, // « 1ère tranche », sous le nom arabe du club
    payerName: { x: 108, y: 61.5, w: 44 }, // après « توصلت من السيد: »
    amountWords: { x: 14, y: 61.5, w: 74 }, // après « ما قدره: »
    amountDigits: { x: 142, y: 72, w: 32 }, // montant en chiffres, avant « نقدا »
    barCheque: { x: 78, y: 70, w: 47 }, // espèces : on barre « صكا . عدد الصك »
    barCash: { x: 128.5, y: 70, w: 8 }, // chèque : on barre « نقدا »
    chequeNumber: { x: 12, y: 72, w: 62 }, // n° du chèque, après « عدد الصك »
    season: { x: 62, y: 101.5, w: 44 }, // après « الموسم الرياضي »
    date: { x: 64, y: 114, w: 42 }, // après « صيادة في »
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
