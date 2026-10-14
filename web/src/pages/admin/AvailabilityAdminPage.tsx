import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AvailabilityGrid, type AvailGrid, type BusySlot } from '../../components/AvailabilityGrid';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, EmptyState } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { fD } from '../../lib/format';
import type { Group } from '../../lib/types';
import { useAction } from '../../lib/useAction';

type Coaches = {
  hours: number[];
  days: number[];
  coaches: { id: string; name: string; grid: AvailGrid; filled: boolean; exceptions: { id: string; from: string; to: string; reason: string }[]; slots: BusySlot[] }[];
};
type Suggestion = {
  coach: string;
  coachFilled: boolean;
  players: { total: number; known: number };
  slots: { day: number; dayLabel: string; startTime: string; endTime: string; preferred: boolean; coachFilled: boolean; courtId: string; court: string; night: boolean; playersAvailable: number | null; score: number }[];
};

/** Direction : disponibilités des entraîneurs et assistant de créneau pour placer un groupe sans conflit (R5). */
export function AvailabilityAdminPage() {
  const q = useQuery({ queryKey: ['availability-coaches'], queryFn: () => api.get<Coaches>('/availability/coaches') });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<Group[]>('/groups') });
  const [coachId, setCoachId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [duration, setDuration] = useState(90);
  const coach = q.data?.coaches.find((c) => c.id === coachId) ?? q.data?.coaches[0];
  const suggest = useAction(() => api.post<Suggestion>('/availability/suggest', { coachId: coach!.id, groupId: groupId || undefined, duration }), {});
  const apply = useAction(
    (s: Suggestion['slots'][number]) => api.post('/availability/apply', { groupId, coachId: coach!.id, courtId: s.courtId, day: s.day, startTime: s.startTime, endTime: s.endTime }),
    { invalidate: [['groups'], ['availability-coaches']], success: 'Créneau ajouté au groupe : familles et entraîneur le voient dans leurs séances.', onSuccess: () => suggest.mutate() },
  );

  return (
    <>
      <PageHeader title="Disponibilités" subtitle="Découvrez les disponibilités des entraîneurs et trouvez un créneau sans conflit pour un groupe." />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {q.data && coach && (
          <>
            <Filters>
              <FilterSelect label="Entraîneur" value={coach.id} onChange={(e) => (setCoachId(e.target.value), suggest.reset())}>
                {q.data.coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.filled ? '' : ' (non renseigné)'}
                  </option>
                ))}
              </FilterSelect>
              <Pill tone={coach.filled ? 'g' : 's'}>{coach.filled ? 'Semaine type renseignée' : 'Semaine type non renseignée'}</Pill>
              <Pill tone="b">{coach.slots.length} créneau(x) cette saison</Pill>
              {coach.exceptions.map((e) => (
                <Pill key={e.id} tone="r">
                  {e.reason} : {fD(e.from, { day: 'numeric', month: 'short' })}
                  {e.to !== e.from ? ` → ${fD(e.to, { day: 'numeric', month: 'short' })}` : ''}
                </Pill>
              ))}
            </Filters>
            <Card className="mt-4">
              <AvailabilityGrid hours={q.data.hours} days={q.data.days} grid={coach.grid} busy={coach.slots} />
            </Card>

            <Section title="Assistant de créneau">
              <Card>
                <div className="flex flex-wrap items-end gap-3">
                  <FilterSelect label="Groupe" value={groupId} onChange={(e) => (setGroupId(e.target.value), suggest.reset())}>
                    <option value="">Groupe (pour les joueurs et l’ajout)…</option>
                    {groups.data?.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </FilterSelect>
                  <FilterSelect label="Durée" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                    <option value={60}>Séance de 1 h</option>
                    <option value={90}>Séance de 1 h 30</option>
                    <option value={120}>Séance de 2 h</option>
                  </FilterSelect>
                  <Button variant="primary" onClick={() => suggest.mutate()} disabled={suggest.isPending}>
                    Proposer des créneaux
                  </Button>
                </div>
              </Card>
              {suggest.data && (
                <div className="mt-3">
                  <Pills className="mb-3">
                    <Pill tone="b">{suggest.data.coach}</Pill>
                    {groupId && (
                      <Pill tone={suggest.data.players.known ? 'g' : 's'}>
                        {suggest.data.players.known}/{suggest.data.players.total} joueur(s) ont donné leurs disponibilités
                      </Pill>
                    )}
                  </Pills>
                  {suggest.data.slots.length ? (
                    <CardGrid list>
                      {suggest.data.slots.map((s) => (
                        <Card key={`${s.day}-${s.startTime}`}>
                          <CardRow>
                            <h3 className="capitalize">
                              {s.dayLabel} {s.startTime} – {s.endTime}
                            </h3>
                          </CardRow>
                          <Pills>
                            <Pill tone={s.preferred ? 'b' : s.coachFilled ? 'g' : 's'}>{s.preferred ? 'Créneau préféré' : s.coachFilled ? 'Entraîneur disponible' : 'Entraîneur : non renseigné'}</Pill>
                            <Pill tone="g">{s.court} libre</Pill>
                            {s.playersAvailable !== null && <Pill tone={s.playersAvailable >= 80 ? 'g' : s.playersAvailable >= 50 ? 's' : 'r'}>{s.playersAvailable} % des joueurs disponibles</Pill>}
                            {s.night && <Pill tone="s">☾ éclairage</Pill>}
                          </Pills>
                          {groupId && (
                            <CardActions>
                              <Button onClick={() => apply.mutate(s)} disabled={apply.isPending}>
                                Ajouter au groupe
                              </Button>
                            </CardActions>
                          )}
                        </Card>
                      ))}
                    </CardGrid>
                  ) : (
                    <EmptyState>Aucun créneau libre pour cet entraîneur et cette durée.</EmptyState>
                  )}
                </div>
              )}
            </Section>
          </>
        )}
        {q.data && !q.data.coaches.length && <EmptyState>Aucun entraîneur actif.</EmptyState>}
      </QueryState>
      <Note>
        Les créneaux proposés évitent les heures où l’entraîneur est indisponible ou déjà pris, gardent un terrain libre (éclairé dès
        18h) et privilégient ses heures préférées et les heures où le plus de joueurs du groupe sont disponibles. L’ajout vérifie de
        nouveau les conflits (R5).
      </Note>
    </>
  );
}
