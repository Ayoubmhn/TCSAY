import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardRow, CardSubtitle } from '../../components/ui/Card';
import { SelectField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import type { Settings } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const h = (n: number) => `${String(n).padStart(2, '0')}:00`;
const HOURS = Array.from({ length: 25 }, (_, i) => i);

/**
 * Horaires du club : ouverture et fermeture (grille de l'emploi du temps, planning, réservations), début de la nuit
 * (terrain éclairé obligatoire, tarif de nuit) et délai d'annulation des réservations.
 */
export function ClubHoursPage() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
  const [f, setF] = useState<Settings>();
  useEffect(() => {
    if (q.data) setF(q.data);
  }, [q.data]);

  const save = useAction(() => api.put<Settings>('/settings/hours', f), {
    invalidate: [['settings'], ['timetable'], ['planning']],
    success: 'Horaires du club enregistrés.',
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f) return;
    if (f.closingHour <= f.openingHour) return toast('La fermeture doit suivre l’ouverture.');
    if (f.nightStartHour < f.openingHour || f.nightStartHour > f.closingHour) return toast('Le début de la nuit doit être entre l’ouverture et la fermeture.');
    save.mutate();
  };
  const changed = Boolean(f && q.data && (Object.keys(f) as (keyof Settings)[]).some((k) => f[k] !== q.data[k]));
  const day = f ? f.nightStartHour - f.openingHour : 0;
  const night = f ? f.closingHour - f.nightStartHour : 0;
  const total = day + night || 1;

  return (
    <>
      <PageHeader title="Horaires du club" subtitle="Découvrez et réglez les heures d’ouverture des terrains." />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {f && (
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <Card>
              <CardRow>
                <h3>Ouverture et fermeture</h3>
                <Pill tone="b">{`${h(f.openingHour)} – ${h(f.closingHour)}`}</Pill>
              </CardRow>
              <div className="grid grid-cols-1 gap-3 min-[521px]:grid-cols-3">
                <SelectField label="Ouverture (premier créneau)" value={f.openingHour} onChange={(e) => setF({ ...f, openingHour: Number(e.target.value) })}>
                  {HOURS.slice(0, 24).map((x) => (
                    <option key={x} value={x}>
                      {h(x)}
                    </option>
                  ))}
                </SelectField>
                <SelectField label="Fermeture (fin du dernier créneau)" value={f.closingHour} onChange={(e) => setF({ ...f, closingHour: Number(e.target.value) })}>
                  {HOURS.slice(1).map((x) => (
                    <option key={x} value={x}>
                      {h(x)}
                    </option>
                  ))}
                </SelectField>
                <SelectField label="Début de la nuit (éclairage)" value={f.nightStartHour} onChange={(e) => setF({ ...f, nightStartHour: Number(e.target.value) })}>
                  {HOURS.map((x) => (
                    <option key={x} value={x}>
                      {h(x)}
                    </option>
                  ))}
                </SelectField>
              </div>
              {/* Aperçu de la journée : jour puis nuit */}
              <div className="mt-1">
                <CardSubtitle>Journée du club</CardSubtitle>
                <div className="mt-2 flex h-9 overflow-hidden rounded-full text-[12.5px] font-medium text-[#111]">
                  {day > 0 && (
                    <div className="flex items-center justify-center bg-[#dff3a8]" style={{ width: `${(day / total) * 100}%` }}>
                      ☀ {h(f.openingHour)} – {h(f.nightStartHour)}
                    </div>
                  )}
                  {night > 0 && (
                    <div className="flex items-center justify-center bg-[#f0d9a8]" style={{ width: `${(night / total) * 100}%` }}>
                      ☾ {h(f.nightStartHour)} – {h(f.closingHour)}
                    </div>
                  )}
                </div>
              </div>
            </Card>

            <Card>
              <CardRow>
                <h3>Annulation des réservations</h3>
              </CardRow>
              <div className="grid grid-cols-1 gap-3 min-[521px]:grid-cols-3">
                <SelectField
                  label="Délai d’annulation (familles, entraîneurs)"
                  value={f.cancelDelayHours}
                  onChange={(e) => setF({ ...f, cancelDelayHours: Number(e.target.value) })}
                >
                  {[0, 2, 6, 12, 24, 48, 72].map((x) => (
                    <option key={x} value={x}>
                      {x ? `${x} h avant` : 'Jusqu’au début'}
                    </option>
                  ))}
                </SelectField>
              </div>
            </Card>

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" type="submit" disabled={!changed || save.isPending}>
                Enregistrer
              </Button>
              {changed && <Button onClick={() => setF(q.data)}>Annuler les changements</Button>}
            </div>
          </form>
        )}
      </QueryState>
      <Note>
        Ces horaires règlent la grille de l’emploi du temps, le planning des terrains et les réservations. Dès le début de la nuit, seul un terrain
        éclairé est utilisable (tarif de nuit). Refusé si des séances ou des réservations à venir tombent en dehors : déplacez-les d’abord.
      </Note>
    </>
  );
}
