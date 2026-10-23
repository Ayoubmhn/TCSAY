import { moduleOn } from '../../lib/modules';
import type { Me, ModuleKey } from '../../lib/types';

/**
 * Étapes du guide de première utilisation, par espace. Une étape montre un vrai bouton de l'écran (`target` = adresse
 * d'un lien du menu, des onglets ou de la cloche, repéré par `data-guide`) ou s'affiche au centre (sans `target`).
 * - `extra` : étape d'un module activable, hors du premier parcours (court) ; marquée vue à la fin du parcours, elle ne
 *   s'affiche plus que si son module est rallumé plus tard (mini-guide « Nouveau »).
 * `target` sans « / » : élément d'écran marqué `data-guide` (ex. `enfant`, la liste des enfants).
 * Les identifiants sont gardés sur le compte (`User.guideSeen`) : ne jamais renommer une étape existante.
 */
export type GuideStep = {
  id: string;
  title: string;
  text: string;
  target?: string;
  perm?: string[];
  module?: ModuleKey | ModuleKey[];
  extra?: boolean;
  /** Étape d'accueil (logo, liste de ce qui sera montré). */
  welcome?: boolean;
  /** Parent seulement (le joueur n'a qu'un profil). */
  parentOnly?: boolean;
};

const BELL_TEXT = 'La cloche vous prévient : séance annulée, rappel de paiement, nouveau tournoi, photos. Revoir ce guide : Paramètres › Aide.';

const FAMILY: GuideStep[] = [
  {
    id: 'famille.bienvenue',
    welcome: true,
    title: 'Bienvenue au TCSAY',
    text: 'En 1 minute, on vous montre l’essentiel : paiements, séances, réservation et messages du club.',
  },
  {
    id: 'famille.enfants',
    parentOnly: true,
    target: 'enfant',
    title: 'Plusieurs enfants ?',
    text: 'Choisissez l’enfant dans la liste en haut de chaque écran : paiements, séances et absences suivent l’enfant choisi.',
  },
  {
    id: 'famille.paiements',
    target: '/paiements',
    title: 'Les paiements',
    text: 'Les tranches de la cotisation : payées en vert, à payer en rose, avec la date limite et le n° de vos reçus.',
  },
  {
    id: 'famille.seances',
    target: '/seances',
    title: 'Les séances',
    text: 'Les séances à venir et passées. Une séance annulée ou déplacée y est signalée, les absences sont dans « Mes absences ».',
  },
  {
    id: 'famille.reserver',
    target: '/reserver',
    title: 'Réserver un terrain',
    text: 'Choisissez le jour puis un créneau libre (en vert). Annulation possible jusqu’à 24 h avant.',
  },
  { id: 'famille.cloche', target: '/notifications', title: 'Les messages du club', text: BELL_TEXT },
  // Modules activables : mini-guide quand le module est rallumé.
  {
    id: 'famille.suivi',
    extra: true,
    target: '/suivi',
    module: ['evaluation-seances', 'bilans'],
    title: 'Suivi et progression',
    text: 'L’assiduité, les notes des séances et les bilans de l’entraîneur.',
  },
  { id: 'famille.exercices', extra: true, target: '/exercices', module: 'exercices', title: 'Exercices', text: 'Les exercices donnés par l’entraîneur : marquez-les faits.' },
  {
    id: 'famille.disponibilites',
    extra: true,
    target: '/disponibilites',
    module: 'disponibilites',
    title: 'Disponibilités',
    text: 'Indiquez vos jours et heures libres : le club s’en sert pour placer les groupes.',
  },
];

const COACH: GuideStep[] = [
  {
    id: 'coach.bienvenue',
    welcome: true,
    title: 'Bienvenue au TCSAY',
    text: 'En 1 minute, l’essentiel pour vos séances : planning, présences, absences et messages.',
  },
  { id: 'coach.seances', target: '/coach/seances', title: 'Mes séances', text: 'Vos séances de la semaine, avec le terrain et les remplacements.' },
  {
    id: 'coach.presences',
    target: '/coach/presences',
    title: 'Les présences',
    text: 'Pendant la séance, pointez présent, en retard ou absent. Sans réseau aussi : le pointage part tout seul au retour du réseau.',
  },
  {
    id: 'coach.absences',
    target: '/coach/absences',
    title: 'Mes absences',
    text: 'Prévenez d’une absence : la direction décide (remplaçant, séance physique ou annulation).',
  },
  { id: 'coach.cloche', target: '/notifications', title: 'Les messages du club', text: BELL_TEXT },
  { id: 'coach.bilans', extra: true, target: '/coach/bilans', module: 'bilans', title: 'Bilans des joueurs', text: 'Le bilan de chaque joueur par trimestre et son niveau.' },
  { id: 'coach.exercices', extra: true, target: '/coach/exercices', module: 'exercices', title: 'Exercices', text: 'Votre bibliothèque d’exercices, à donner à un groupe ou à un joueur.' },
  {
    id: 'coach.disponibilites',
    extra: true,
    target: '/coach/disponibilites',
    module: 'disponibilites',
    title: 'Mes disponibilités',
    text: 'Votre semaine type et vos indisponibilités.',
  },
];

const ADMIN: GuideStep[] = [
  {
    id: 'admin.bienvenue',
    welcome: true,
    title: 'Bienvenue au TCSAY',
    text: 'En 1 minute, les écrans de votre travail au club. Le menu ne montre que ce que vos autorisations permettent.',
  },
  { id: 'admin.tableau', target: '/admin', perm: ['stats.view'], title: 'Le tableau de bord', text: 'Les chiffres clés, ce qui reste à traiter et les séances du jour.' },
  {
    id: 'admin.joueurs',
    target: '/admin/joueurs',
    perm: ['players.manage'],
    title: 'Les joueurs',
    text: 'Créer un joueur (un parent pour un mineur), son inscription et sa cotisation ; le profil s’ouvre d’un clic sur le nom.',
  },
  {
    id: 'admin.paiements',
    target: '/admin/paiements',
    perm: ['payments.collect'],
    title: 'Encaisser',
    text: 'Encaisser une tranche, saisir le n° du reçu du carnet et suivre les retards.',
  },
  {
    id: 'admin.planning',
    target: '/admin/planning',
    perm: ['planning.view', 'groups.manage'],
    title: 'Le planning',
    text: 'Les séances de la semaine par terrain et par entraîneur, avec les créneaux libres.',
  },
  {
    id: 'admin.notifications',
    target: '/admin/notifications',
    perm: ['notifications.send'],
    title: 'Envoyer un message',
    text: 'Un message aux parents, à un groupe ou à des personnes choisies, aussi par email.',
  },
  {
    id: 'admin.autorisations',
    perm: ['permissions.manage'],
    title: 'Les autorisations',
    text: 'Président : réglez les droits de chaque rôle dans Paramètres › Autorisations, protégées par un code. L’historique des actions garde qui a fait quoi.',
  },
  { id: 'admin.cloche', target: '/notifications', title: 'Les alertes', text: BELL_TEXT },
  { id: 'admin.budget', extra: true, target: '/admin/budget', perm: ['budget.manage', 'stats.view'], module: 'budget', title: 'Projets et budget', text: 'Les devis, la décision du bureau, le budget de la saison et la trésorerie.' },
  { id: 'admin.import', extra: true, target: '/admin/import', perm: ['import.manage'], module: 'import-historique', title: 'Import historique', text: 'Les saisons passées : joueurs, recettes et dépenses depuis Excel, Word ou les cahiers.' },
  { id: 'admin.bilans', extra: true, target: '/admin/bilans', perm: ['evaluations.manage'], module: 'bilans', title: 'Bilans des joueurs', text: 'Les bilans par trimestre, le niveau validé par la direction technique et le suivi technique.' },
];

/** Écrans de l'administration montrés au premier parcours : 3 au plus (le guide reste court). */
const ADMIN_SCREENS = 3;

/** Étapes possibles pour ce compte et cet espace (autorisations, modules allumés). */
export function stepsFor(me: Pick<Me, 'space' | 'permissions' | 'disabledModules'>): GuideStep[] {
  const list = me.space === 'coach' ? COACH : me.space === 'admin' ? ADMIN : FAMILY;
  const ok = list.filter(
    (s) =>
      (!s.perm || s.perm.some((p) => me.permissions.includes(p))) &&
      (!s.module || moduleOn(me, s.module)) &&
      (!s.parentOnly || me.space === 'parent'),
  );
  if (me.space !== 'admin') return ok;
  // Administration : seulement les premiers écrans autorisés (les autres restent dans le menu).
  let screens = 0;
  return ok.filter((s) => !s.target || s.extra || s.target === '/notifications' || ++screens <= ADMIN_SCREENS);
}
