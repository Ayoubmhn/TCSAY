import { DAY_NAMES, fullName } from '../lib/format';
import type { AbsenceResolution, CoachRef, Slot } from '../lib/types';
import { Pill } from './ui/Pill';

/** Pastille d'entraîneur : point à sa couleur du planning + prénom. */
export function CoachChip({ coach }: { coach: CoachRef }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-fld px-[11px] py-[5px] text-[13px] font-medium text-fg">
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: coach.color }} />
      {fullName(coach).trim()}
    </span>
  );
}

/** Ligne d'un créneau : jour et horaire, terrain, entraîneurs (plusieurs possibles). */
export function SlotLine({ slot, showDay = true }: { slot: Slot; showDay?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill tone="b">
        {showDay ? `${DAY_NAMES[slot.day]} ` : ''}
        <span dir="ltr">
          {slot.startTime}–{slot.endTime}
        </span>
      </Pill>
      {slot.court && <Pill tone="g">{slot.court.name}</Pill>}
      {slot.coaches.length ? slot.coaches.map((c) => <CoachChip key={c.id} coach={c} />) : <Pill tone="s">Entraîneur à affecter</Pill>}
    </div>
  );
}

export const RESOLUTION_LABEL: Record<AbsenceResolution, string> = {
  REPLACED: 'Remplacement',
  PHYSICAL: 'Séance physique',
  CANCELLED: 'Séance annulée',
};

/** Séance touchée par l'absence d'un entraîneur : remplacement, séance physique ou annulation. */
export function ResolutionPill({ resolution, replacement }: { resolution: AbsenceResolution | null; replacement?: CoachRef | null }) {
  if (!resolution) return null;
  if (resolution === 'REPLACED') {
    return <Pill tone="s">{replacement ? `Remplacé par ${fullName(replacement).trim()}` : 'Entraîneur remplacé'}</Pill>;
  }
  return <Pill tone={resolution === 'CANCELLED' ? 'r' : 's'}>{RESOLUTION_LABEL[resolution]}</Pill>;
}
