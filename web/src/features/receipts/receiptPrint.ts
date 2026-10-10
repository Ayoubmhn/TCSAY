import type { ReceiptLayout } from '../../lib/types';

export type PrintMode = 'carnet' | 'pdf';

/** Adresse de la page d'impression d'un reçu (nouvel onglet, impression lancée automatiquement). */
export const receiptPrintUrl = (id: string, mode: PrintMode) => `/impression/recu/${id}?mode=${mode}&auto=1`;

/** Page de test du réglage (feuille blanche, avec repères). */
export const receiptTestUrl = (mode: PrintMode = 'carnet') => `/impression/recu-test?mode=${mode}&reperes=1`;

/**
 * Ouvre l'onglet d'impression tout de suite (dans le clic, sinon le navigateur bloque la fenêtre),
 * puis le dirige vers le reçu une fois enregistré. Renvoie de quoi le diriger ou le fermer.
 */
export function openPrintTab() {
  const tab = window.open('about:blank', '_blank');
  return {
    go: (url: string) => {
      if (tab && !tab.closed) tab.location.href = url;
      else window.open(url, '_blank');
    },
    close: () => tab?.close(),
  };
}

/** Réglage en cours de modification (non enregistré), transmis à la page de test. Simple confort local. */
const DRAFT_KEY = 'tcsay-receipt-layout-draft';

export function saveLayoutDraft(layout: ReceiptLayout | null) {
  try {
    if (layout) localStorage.setItem(DRAFT_KEY, JSON.stringify(layout));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // stockage indisponible : la page de test utilisera le réglage enregistré
  }
}

export function readLayoutDraft(): ReceiptLayout | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as ReceiptLayout) : null;
  } catch {
    return null;
  }
}
