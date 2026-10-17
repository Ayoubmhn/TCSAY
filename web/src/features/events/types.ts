export type EventAudience = 'EVERYONE' | 'GROUPS' | 'CATEGORIES' | 'CUSTOM';

export type EventSummary = {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  place: string;
  tag: string;
  description: string | null;
  audience: EventAudience;
  audienceLabel: string;
  /** Avec participation (« Je participe »), sinon affichage seulement. */
  rsvp: boolean;
  capacity: number | null;
  going: number;
  full: boolean;
  posterUrl: string | null;
  published: boolean;
  archived: boolean;
  canManage: boolean;
  myGoing?: boolean;
};

export type Option = { id: string; label: string };
export type Person = { kind: 'user' | 'player'; id: string; name: string };

export type EventDetail = EventSummary & {
  notGoing?: number;
  past: boolean;
  version: number;
  notifiedAt: string | null;
  groups: Option[];
  categories: Option[];
  members: Person[];
  /** Personnes pour qui je réponds (mes enfants concernés, ou moi). */
  respondents: { key: string; playerId: string | null; name: string; going: boolean | null }[];
  /** Direction : réponses reçues. */
  responses: { name: string; by: string | null; going: boolean; at: string }[];
  albums: { id: string; title: string; photos: number; archived: boolean }[];
  canCreateAlbum: boolean;
};

/** Types proposés (texte libre aussi possible). */
export const TAGS = ['Fête', 'Stage', 'Réunion', 'Sortie', 'Tournoi', 'Journée portes ouvertes', 'Assemblée générale', 'Autre'];

/** « samedi 20 décembre · 15:00 – 19:00 » */
export function when(e: { startTime: string | null; endTime: string | null }) {
  if (!e.startTime) return null;
  return e.endTime ? `${e.startTime} – ${e.endTime}` : e.startTime;
}
