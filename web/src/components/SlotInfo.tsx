import { DAY_NAMES, fullName } from '../lib/format';
import type { CoachRef, Slot } from '../lib/types';
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
        {slot.startTime}–{slot.endTime}
      </Pill>
      {slot.court && <Pill tone="g">{slot.court.name}</Pill>}
      {slot.coaches.length ? slot.coaches.map((c) => <CoachChip key={c.id} coach={c} />) : <Pill tone="s">Entraîneur à affecter</Pill>}
    </div>
  );
}
