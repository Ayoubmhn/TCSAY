import { addDays, fD, todayIso } from '../../lib/format';

/** Puces de 14 jours (.days / .dchip), jour choisi en --sel. */
export function DayChips({ value, onChange, count = 14 }: { value: string; onChange: (day: string) => void; count?: number }) {
  const today = todayIso();
  const days = Array.from({ length: count }, (_, i) => addDays(today, i));
  return (
    <div role="listbox" aria-label="Jours" className="flex gap-2 overflow-x-auto pb-1.5 [scrollbar-width:thin]">
      {days.map((day) => {
        const on = day === value;
        return (
          <button
            key={day}
            type="button"
            role="option"
            aria-selected={on}
            aria-label={fD(day, { weekday: 'long', day: 'numeric', month: 'long' })}
            onClick={() => onChange(day)}
            className={`flex w-[62px] flex-none flex-col items-center gap-0.5 rounded-[22px] py-2.5 ${on ? 'bg-sel text-white' : 'bg-day'}`}
          >
            <small className={`text-xs ${on ? 'text-[#dfe0ff]' : 'text-mut'}`}>{fD(day, { weekday: 'short' })}</small>
            <b className="text-lg font-semibold">{Number(day.slice(8))}</b>
            <small className={`text-xs ${on ? 'text-[#dfe0ff]' : 'text-mut'}`}>{fD(day, { month: 'short' })}</small>
          </button>
        );
      })}
    </div>
  );
}
