import type { ExerciseKind } from '../../lib/types';

/** Libellé et icône de chaque type d'exercice (ordre d'affichage). */
export const KINDS: { value: ExerciseKind; label: string; icon: string }[] = [
  { value: 'WARMUP', label: 'Échauffement', icon: '🔥' },
  { value: 'TECHNIQUE', label: 'Technique', icon: '🎾' },
  { value: 'PHYSICAL', label: 'Physique', icon: '💪' },
  { value: 'RECOVERY', label: 'Récupération', icon: '🧘' },
];

export const kindOf = (k: ExerciseKind) => KINDS.find((x) => x.value === k) ?? KINDS[0];
