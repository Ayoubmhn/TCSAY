export type AlbumKind = 'TOURNAMENT' | 'MATCH' | 'GROUP' | 'EVENT' | 'FREE';
export type AlbumAudience = 'CONTEXT' | 'EVERYONE' | 'CUSTOM';

export type AlbumSummary = {
  id: string;
  title: string;
  kind: AlbumKind;
  kindLabel: string;
  audience: AlbumAudience;
  audienceLabel: string;
  context: string | null;
  date: string;
  photos: number;
  cover: string | null;
  archived: boolean;
  canManage: boolean;
};

export type AlbumPhoto = {
  id: string;
  thumbUrl: string;
  fullUrl: string;
  width: number;
  height: number;
  caption: string | null;
  tags: { id: string; name: string }[];
  /** Un de mes enfants (ou moi) est identifié : je peux demander le retrait. */
  mine: boolean;
  /** Direction : motif du retrait. */
  hidden: string | null;
  /** Direction : joueurs identifiés sans autorisation photo (photo visible de leur seule famille). */
  withoutConsent: string[];
  createdAt: string;
};

export type AlbumDetail = Omit<AlbumSummary, 'photos' | 'cover'> & {
  description: string | null;
  contextId: string | null;
  notifiedAt: string | null;
  version: number;
  mode: 'OPT_IN' | 'OPT_OUT';
  members: { kind: 'user' | 'player'; id: string; name: string }[];
  candidates: { id: string; name: string; allowed: boolean }[];
  photos: AlbumPhoto[];
};

export type ContextOption = { id: string; label: string; date: string | null };
export type Contexts = { tournaments: ContextOption[]; matches: ContextOption[]; groups: ContextOption[]; events: ContextOption[] };

export const KINDS: { value: AlbumKind; label: string; manager?: boolean }[] = [
  { value: 'TOURNAMENT', label: 'Tournoi', manager: true },
  { value: 'EVENT', label: 'Événement', manager: true },
  { value: 'MATCH', label: 'Match' },
  { value: 'GROUP', label: 'Groupe d’entraînement' },
  { value: 'FREE', label: 'Sans contexte' },
];

export const AUDIENCE_HINT: Record<AlbumKind, string> = {
  TOURNAMENT: 'Inscrits au tournoi, leurs parents, arbitres et direction.',
  MATCH: 'Les deux joueurs, leurs parents, l’arbitre et la direction.',
  GROUP: 'Joueurs du groupe, leurs parents, entraîneurs du groupe.',
  EVENT: 'Tout le club.',
  FREE: 'Seulement les personnes ajoutées.',
};
