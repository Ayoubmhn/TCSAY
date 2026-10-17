import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useMe } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { api } from '../../lib/api';
import type { BookingRules } from '../../lib/types';
import { useAction } from '../../lib/useAction';

type NumKey = Exclude<keyof BookingRules, 'noArrears'>;

const ROWS: { key: NumKey; label: string; hint?: string; unit?: string; min: number; max: number }[] = [
  { key: 'maxUpcomingAccount', label: 'Réservations à venir par compte', hint: '0 = sans limite', min: 0, max: 20 },
  { key: 'maxUpcomingFamily', label: 'Réservations à venir par famille', hint: 'tous les comptes de la famille', min: 0, max: 30 },
  { key: 'maxHoursWeek', label: 'Heures par semaine et par famille', unit: 'h', min: 0, max: 60 },
  { key: 'maxPerDayPlayer', label: 'Réservations par jour et par joueur', min: 0, max: 10 },
  { key: 'advanceDays', label: 'Réserver jusqu’à', unit: 'jours à l’avance', min: 1, max: 60 },
  { key: 'peakPerWeek', label: 'Soir et week-end, par famille et par semaine', hint: 'heures les plus demandées', min: 0, max: 14 },
  { key: 'cancelsPerMonth', label: 'Annulations sur 30 jours', hint: 'au-delà : blocage automatique', min: 0, max: 30 },
  { key: 'noShowLimit', label: 'Absences sans annuler (90 jours)', hint: 'à ce nombre : blocage automatique', min: 0, max: 10 },
  { key: 'blockDays', label: 'Durée d’un blocage automatique', unit: 'jours', min: 1, max: 180 },
  { key: 'attemptsPerHour', label: 'Tentatives par heure, par appareil et par adresse IP', hint: 'filet de sécurité contre les robots', min: 0, max: 200 },
];

/** Règles de réservation (président) : limites anti-abus vérifiées par l'API pour les familles et les entraîneurs. */
export function BookingRulesPage() {
  const me = useMe();
  const canEdit = me.permissions.includes('permissions.manage');
  const q = useQuery({ queryKey: ['reservations', 'rules'], queryFn: () => api.get<BookingRules>('/reservations/rules') });
  const [rules, setRules] = useState<BookingRules>();
  useEffect(() => {
    if (q.data) setRules(q.data);
  }, [q.data]);
  const save = useAction(() => api.put('/reservations/rules', rules), { invalidate: [['reservations']], success: 'Règles de réservation enregistrées.' });

  return (
    <>
      <PageHeader title="Règles de réservation" subtitle="Découvrez les limites qui évitent les abus de réservation." />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {rules && (
          <div className="mt-4 flex max-w-[720px] flex-col gap-3">
            <Card className="gap-0 py-1">
              {ROWS.map((r) => (
                <label key={r.key} className="flex items-center justify-between gap-3 border-b-[1.5px] border-line py-3 last:border-0">
                  <span className="text-[14.5px]">
                    {r.label}
                    {r.hint && <small className="block text-[12px] text-mut">{r.hint}</small>}
                  </span>
                  <span className="flex flex-none items-center gap-2">
                    <input
                      type="number"
                      min={r.min}
                      max={r.max}
                      disabled={!canEdit}
                      value={rules[r.key]}
                      onChange={(e) => setRules({ ...rules, [r.key]: Math.max(r.min, Math.min(r.max, Number(e.target.value) || 0)) })}
                      className="w-[72px] rounded-[14px] bg-fld px-3 py-2 text-center font-semibold"
                      aria-label={r.label}
                    />
                    {r.unit && <span className="text-[13px] text-mut">{r.unit}</span>}
                  </span>
                </label>
              ))}
              <label className="flex items-center justify-between gap-3 py-3">
                <span className="text-[14.5px]">
                  Cotisation en retard = pas de réservation
                  <small className="block text-[12px] text-mut">tranche échue non payée</small>
                </span>
                <input type="checkbox" className="h-5 w-5 accent-[var(--pri)]" disabled={!canEdit} checked={rules.noArrears} onChange={(e) => setRules({ ...rules, noArrears: e.target.checked })} />
              </label>
            </Card>
            {canEdit && (
              <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
                Enregistrer les règles
              </Button>
            )}
            <Note>
              Les règles s’appliquent aux familles et aux entraîneurs (la direction n’est pas limitée), et sont vérifiées par le serveur. L’adresse IP ne sert que de filet
              de sécurité (plusieurs familles peuvent partager la même) ; elle est effacée après 30 jours. Les terrains ouverts à la réservation se règlent dans Terrains ›
              Modifier.
            </Note>
          </div>
        )}
      </QueryState>
    </>
  );
}
