import { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { IconGrid, IconList } from './Icons';

export type ViewMode = 'cards' | 'list';

/** Affichage en cases ou en liste, mémorisé par écran sur cet appareil (simple confort : rien d'indispensable). */
export function useViewMode(screen: string): [ViewMode, (v: ViewMode) => void] {
  const key = `tcsay-vue-${screen}`;
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(key) === 'list' ? 'list' : 'cards';
    } catch {
      return 'cards';
    }
  });
  const set = (v: ViewMode) => {
    setMode(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* stockage indisponible : choix gardé pour la session */
    }
  };
  return [mode, set];
}

/** Bascule « Cases / Liste » (capsule grise, option active foncée), icônes faites main. */
export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const { t } = useI18n();
  const options: { v: ViewMode; label: string; Icon: typeof IconGrid }[] = [
    { v: 'cards', label: 'Afficher en cases', Icon: IconGrid },
    { v: 'list', label: 'Afficher en liste', Icon: IconList },
  ];
  return (
    <div role="group" aria-label={t('Affichage')} className="inline-flex rounded-full bg-btn p-1">
      {options.map(({ v, label, Icon }) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          aria-label={t(label)}
          title={t(label)}
          onClick={() => onChange(v)}
          className={`grid h-[34px] w-[42px] place-items-center rounded-full ${value === v ? 'bg-toggle text-bg' : 'text-fg'}`}
        >
          <Icon size={18} />
        </button>
      ))}
    </div>
  );
}
