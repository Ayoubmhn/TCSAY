import { useI18n } from '../lib/i18n';
import { Pill, Pills } from './ui/Pill';

export type AvailState = 'D' | 'P' | 'I';
export type AvailGrid = Record<string, AvailState>;
export type BusySlot = { day: number; startTime: string; endTime: string; group: string; court?: string | null };

const DAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const LABEL: Record<AvailState, string> = { D: 'Dispo', P: 'Préféré', I: 'Indispo' };
const CLS: Record<AvailState | 'none', string> = {
  D: 'bg-pg text-ink',
  P: 'bg-pb text-ink',
  I: 'bg-pr text-ink',
  none: 'bg-fld text-mut',
};
const NEXT: Record<AvailState | 'none', AvailState | undefined> = { none: 'D', D: 'P', P: 'I', I: undefined };
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Grille de la semaine type (jours × heures) : Disponible / Préféré / Indisponible / non renseigné.
 * Modifiable (clic = état suivant, clavier compris) ou en lecture seule avec les séances déjà prévues entourées.
 */
export function AvailabilityGrid({
  hours,
  days,
  grid,
  onChange,
  busy = [],
}: {
  hours: number[];
  days: number[];
  grid: AvailGrid;
  onChange?: (grid: AvailGrid) => void;
  busy?: BusySlot[];
}) {
  const { t } = useI18n();
  const busyAt = (day: number, h: number) => busy.find((s) => s.day === day && minutes(s.startTime) < (h + 1) * 60 && minutes(s.endTime) > h * 60);
  const cycle = (key: string) => {
    if (!onChange) return;
    const next = NEXT[grid[key] ?? 'none'];
    const copy = { ...grid };
    if (next) copy[key] = next;
    else delete copy[key];
    onChange(copy);
  };
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-separate border-spacing-1" role="grid">
          <thead>
            <tr>
              <th className="w-14" />
              {days.map((d) => (
                <th key={d} className="text-xs font-semibold text-mut">
                  {t(DAY_SHORT[d])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h}>
                <th className="text-xs font-semibold text-mut">{h}:00</th>
                {days.map((d) => {
                  const key = `${d}-${h}`;
                  const state = grid[key];
                  const b = busyAt(d, h);
                  const label = `${t(DAY_SHORT[d])} ${h}h : ${state ? t(LABEL[state]) : t('non renseigné')}${b ? ` · ${b.group}` : ''}`;
                  return (
                    <td key={d} className="p-0">
                      <button
                        type="button"
                        disabled={!onChange}
                        aria-label={label}
                        title={label}
                        onClick={() => cycle(key)}
                        className={`h-9 w-full rounded-[10px] text-[11.5px] font-medium disabled:cursor-default ${CLS[state ?? 'none']} ${b ? 'outline outline-2 -outline-offset-2 outline-pri' : ''}`}
                      >
                        {b ? `● ${b.group}` : state ? t(LABEL[state]) : '·'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pills className="mt-2">
        <Pill tone="g">Disponible</Pill>
        <Pill tone="b">Préféré</Pill>
        <Pill tone="r">Indisponible</Pill>
        <Pill tone="s">· non renseigné</Pill>
        {busy.length > 0 && <Pill tone="b">● séance prévue</Pill>}
      </Pills>
    </>
  );
}
