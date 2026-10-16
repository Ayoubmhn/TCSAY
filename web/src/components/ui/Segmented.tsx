import { useI18n } from '../../lib/i18n';
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
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t(label)} className="inline-flex max-w-full overflow-x-auto rounded-full bg-btn p-1 [scrollbar-width:none]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`flex-none whitespace-nowrap rounded-full px-4 py-[7px] text-sm font-medium ${o.value === value ? 'bg-toggle text-bg' : 'text-fg'}`}
        >
          {t(o.label)}
        </button>
      ))}
    </div>
  );
}
