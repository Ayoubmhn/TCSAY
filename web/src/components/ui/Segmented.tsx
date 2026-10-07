/** Bascule en capsule grise (.seg), option active en --toggle. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-btn p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-4 py-[7px] text-sm font-medium ${o.value === value ? 'bg-toggle text-bg' : 'text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
