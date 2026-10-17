export type ComplaintKind = 'COMPLAINT' | 'SUGGESTION' | 'URGENT';
export type ComplaintCategory = 'PAYMENT' | 'RESERVATION' | 'TRAINING' | 'FACILITIES' | 'APP' | 'BEHAVIOR' | 'OTHER';
export type ComplaintStatus = 'NEW' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';

export type Complaint = {
  id: string;
  number: number;
  kind: ComplaintKind;
  kindLabel: string;
  category: ComplaintCategory;
  categoryLabel: string;
  subject: string;
  body: string;
  status: ComplaintStatus;
  statusLabel: string;
  /** Responsables seulement. */
  author: { id: string; name: string; space: string } | null;
  player: { id: string; name: string } | null;
  target: { id: string; name: string } | null;
  assignee: string | null;
  hasPhoto: boolean;
  satisfied: boolean | null;
  messages: number;
  late: boolean;
  createdAt: string;
  closedAt: string | null;
  lastActivityAt: string;
  version: number;
};

export type ComplaintDetail = Complaint & {
  canHandle: boolean;
  messages: { id: string; body: string; internal: boolean; mine: boolean; author: string; fromAuthor: boolean; createdAt: string }[];
};

export type ComplaintStats = {
  open: number;
  urgent: number;
  late: number;
  total90: number;
  averageHours: number | null;
  satisfaction: number | null;
  byCategory: { category: ComplaintCategory; label: string; count: number }[];
};

export const KINDS: { value: ComplaintKind; label: string; hint: string }[] = [
  { value: 'COMPLAINT', label: 'Réclamation', hint: 'Un problème à régler (paiement, terrain, séance…).' },
  { value: 'SUGGESTION', label: 'Suggestion', hint: 'Une idée pour améliorer le club ou l’application.' },
  { value: 'URGENT', label: 'Urgent', hint: 'Sécurité, blessure, comportement grave : le président est prévenu tout de suite.' },
];

export const CATEGORIES: { value: ComplaintCategory; label: string }[] = [
  { value: 'PAYMENT', label: 'Paiement, reçu' },
  { value: 'RESERVATION', label: 'Réservation, terrain' },
  { value: 'TRAINING', label: 'Entraînement' },
  { value: 'FACILITIES', label: 'Installations, matériel' },
  { value: 'APP', label: 'Application' },
  { value: 'BEHAVIOR', label: 'Comportement' },
  { value: 'OTHER', label: 'Autre' },
];

export const STATUS_TONE: Record<ComplaintStatus, 'b' | 'g' | 'r' | 's'> = { NEW: 'b', IN_PROGRESS: 's', RESOLVED: 'g', REJECTED: 'r' };
