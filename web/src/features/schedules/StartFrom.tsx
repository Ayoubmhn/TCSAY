import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { TempScheduleList, Timetable } from '../../lib/types';

export type StartFrom = { from: 'EMPTY' | 'PUBLISHED' | 'DRAFT' | 'TEMP'; fromId: string; sessionsOwed: boolean };
export const START_DEFAULT: StartFrom = { from: 'PUBLISHED', fromId: '', sessionsOwed: false };

/** Message d'erreur si le point de départ est incomplet (brouillon ou vacances non choisis). */
export function startFromProblem(s: StartFrom): string | null {
  if ((s.from === 'DRAFT' || s.from === 'TEMP') && !s.fromId) return s.from === 'DRAFT' ? 'Choisissez le brouillon à reprendre.' : 'Choisissez les vacances à reprendre.';
  return null;
}

/** Corps de la requête de création (point de départ + séances dues). */
export const startFromBody = (s: StartFrom) => ({ from: s.from, ...(s.fromId && (s.from === 'DRAFT' || s.from === 'TEMP') ? { fromId: s.fromId } : {}), sessionsOwed: s.sessionsOwed });

/**
 * Nouvelles vacances ou stage : partir d'un emploi vide, de l'horaire publié, d'un brouillon de la grille ou d'autres
 * vacances ; et dire si les séances habituelles retirées restent dues (compteur des séances : « à rattraper »).
 */
export function StartFromField({ value, onChange }: { value: StartFrom; onChange: (v: StartFrom) => void }) {
  const t = useQuery({ queryKey: ['timetable', null], queryFn: () => api.get<Timetable>('/timetable') });
  // Toutes les vacances de la saison (passées comprises : reprendre le stage d'avant).
  const list = useQuery({ queryKey: ['temp-schedules'], queryFn: () => api.get<TempScheduleList>('/temp-schedules') });
  const drafts = t.data?.drafts ?? [];
  const temps = (list.data?.schedules ?? []).map((s) => ({ id: s.id, name: s.name, published: s.status === 'PUBLISHED' }));
  const options: { key: StartFrom['from']; title: string; help: string; list?: { id: string; label: string }[] }[] = [
    { key: 'EMPTY', title: 'Emploi vide', help: 'Aucun groupe : vous ajoutez les groupes et placez les séances.' },
    { key: 'PUBLISHED', title: 'Emploi publié (horaire habituel)', help: 'Les groupes qui s’entraînent ces jours-là sont recopiés : retirez ou déplacez ce qui change.' },
    { key: 'DRAFT', title: 'Un brouillon', help: 'Les séances du brouillon (et l’horaire publié des autres groupes) deviennent celles des vacances.', list: drafts.map((d) => ({ id: d.id, label: d.name })) },
    {
      key: 'TEMP',
      title: 'D’autres vacances',
      help: 'Reprendre un stage ou des vacances déjà préparés (jours compris dans les nouvelles dates).',
      list: temps.map((s) => ({ id: s.id, label: `${s.name}${s.published ? '' : ' (brouillon)'}` })),
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-mut">Partir de</span>
      <div role="radiogroup" aria-label="Partir de" className="flex flex-col gap-2">
        {options.map((o) => {
          const on = value.from === o.key;
          const empty = o.list && !o.list.length;
          return (
            <div
              key={o.key}
              className={`flex items-start gap-3 rounded-[20px] border-[1.5px] p-3 ${on ? 'border-pri' : 'border-line'} ${empty ? 'opacity-50' : ''}`}
            >
              <input
                type="radio"
                name="start-from"
                className="mt-1 h-4 w-4 accent-pri"
                checked={on}
                disabled={empty}
                onChange={() => onChange({ ...value, from: o.key, fromId: o.list?.[0]?.id ?? '' })}
                aria-label={o.title}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-[14.5px] font-semibold">{o.title}</b>
                  {o.list && on && o.list.length > 0 && (
                    <select
                      aria-label={o.title}
                      value={value.fromId}
                      onChange={(e) => onChange({ ...value, fromId: e.target.value })}
                      className="rounded-full border-0 bg-fld px-3 py-1.5 text-[13px]"
                    >
                      {o.list.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="mt-0.5 text-[12.5px] text-mut">{empty ? (o.key === 'DRAFT' ? 'Aucun brouillon pour le moment.' : 'Aucunes autres vacances pour le moment.') : o.help}</p>
              </div>
            </div>
          );
        })}
      </div>
      <label className="mt-1 flex items-start gap-2.5 text-[14px]">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-pri" checked={value.sessionsOwed} onChange={(e) => onChange({ ...value, sessionsOwed: e.target.checked })} />
        <span>
          Séances dues pendant ces dates
          <span className="block text-[12.5px] text-mut">
            Cochée : les séances habituelles retirées comptent « à rattraper » dans le compteur des séances. Décochée (vacances) : elles ne sont pas dues.
          </span>
        </span>
      </label>
    </div>
  );
}
