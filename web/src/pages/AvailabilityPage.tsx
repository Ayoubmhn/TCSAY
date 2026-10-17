import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth, useMe } from '../auth/AuthContext';
import { AvailabilityGrid, type AvailGrid } from '../components/AvailabilityGrid';
import { KidSelect } from '../components/KidSelect';
import { ActionIcon } from '../components/ui/ActionIcon';
import { Button } from '../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, EmptyState } from '../components/ui/Card';
import { Filters, TextField } from '../components/ui/Field';
import { QueryState } from '../components/ui/Loading';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill, Pills } from '../components/ui/Pill';
import { Section } from '../components/ui/Section';
import { useToast } from '../components/ui/Toast';
import { api } from '../lib/api';
import { fD } from '../lib/format';
import { useAction } from '../lib/useAction';

type Mine = { hours: number[]; days: number[]; grid: AvailGrid; updatedAt: string | null; exceptions: { id: string; from: string; to: string; reason: string }[] };

/**
 * Mes disponibilités : semaine type (entraîneur, ou joueur choisi par le parent) et indisponibilités datées.
 * La direction s'en sert pour placer les groupes et proposer des remplaçants.
 */
export function AvailabilityPage() {
  const me = useMe();
  const toast = useToast();
  const { playerId } = useAuth();
  const coach = me.role === 'COACH';
  const pid = coach ? undefined : playerId || undefined;
  const q = useQuery({ queryKey: ['availability', pid ?? 'me'], queryFn: () => api.get<Mine>('/availability/me', { playerId: pid }), enabled: coach || Boolean(pid) || me.role === 'PLAYER' });
  const [grid, setGrid] = useState<AvailGrid>({});
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (q.data) setGrid(q.data.grid);
  }, [q.data]);
  const dirty = q.data && JSON.stringify(grid) !== JSON.stringify(q.data.grid);
  const save = useAction(() => api.put('/availability/me', { grid, playerId: pid }), { invalidate: [['availability']], success: 'Disponibilités enregistrées.' });
  const add = useAction(() => api.post('/availability/me/exceptions', { from, to: to || from, reason: reason.trim(), playerId: pid }), {
    invalidate: [['availability']],
    success: 'Indisponibilité ajoutée.',
    onSuccess: () => (setFrom(''), setTo(''), setReason('')),
  });
  const remove = useAction((id: string) => api.delete(`/availability/me/exceptions/${id}`, { playerId: pid }), { invalidate: [['availability']], success: 'Indisponibilité retirée.' });
  const fillAll = (state: 'D' | 'I') => q.data && setGrid(Object.fromEntries(q.data.days.flatMap((d) => q.data!.hours.map((h) => [`${d}-${h}`, state]))));

  return (
    <>
      <PageHeader
        title="Mes disponibilités"
        subtitle={coach ? 'Découvrez votre semaine type : la direction place les groupes sur vos créneaux disponibles.' : 'Découvrez la semaine type du joueur : indiquez les heures impossibles (école, études).'}
        action={
          <Button variant="primary" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            Enregistrer
          </Button>
        }
      />
      <Filters>
        <KidSelect />
        <Button onClick={() => fillAll('D')}>Tout disponible</Button>
        <Button onClick={() => setGrid({})}>Tout effacer</Button>
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {q.data && (
          <Card className="mt-4">
            <AvailabilityGrid hours={q.data.hours} days={q.data.days} grid={grid} onChange={setGrid} />
            {q.data.updatedAt && <Pills><Pill tone="s">Mis à jour le {fD(q.data.updatedAt.slice(0, 10), { day: 'numeric', month: 'short' })}</Pill></Pills>}
          </Card>
        )}
        <Section title="Indisponibilités datées">
          <Card className="max-w-[760px]">
            <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-3">
              <TextField label="Du" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <TextField label="Au (facultatif)" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              <TextField label="Motif" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="ex. examens, congé" />
            </div>
            <CardActions>
              <Button onClick={() => (!from || !reason.trim() ? toast('Date et motif obligatoires.') : add.mutate())} disabled={add.isPending}>
                Ajouter
              </Button>
            </CardActions>
          </Card>
          <div className="mt-3">
            {q.data?.exceptions.length ? (
              <CardGrid list>
                {q.data.exceptions.map((e) => (
                  <Card key={e.id}>
                    <CardRow>
                      <h3>{e.reason}</h3>
                    </CardRow>
                    <Pills>
                      <Pill tone="r">
                        {e.from === e.to ? fD(e.from, { weekday: 'short', day: 'numeric', month: 'short' }) : `du ${fD(e.from, { day: 'numeric', month: 'short' })} au ${fD(e.to, { day: 'numeric', month: 'short' })}`}
                      </Pill>
                    </Pills>
                    <CardActions>
                      <ActionIcon kind="delete" onClick={() => remove.mutate(e.id)} />
                    </CardActions>
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucune indisponibilité à venir.</EmptyState>
            )}
          </div>
        </Section>
      </QueryState>
      <Note>Cliquez sur une case pour passer de « non renseigné » à Disponible, Préféré puis Indisponible. Pensez à enregistrer.</Note>
    </>
  );
}
