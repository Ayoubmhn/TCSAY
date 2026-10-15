import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';
import { fD } from '../../lib/format';
import { useAction } from '../../lib/useAction';
import { KidSelect } from '../KidSelect';
import { useToast } from '../Toast';
import { Button, Card, CardRow, CardTitle, Confirm, EmptyState, Field, IconButton, Note, PageHeader, Pill, Pills, QueryState, Screen, Section, T } from '../ui';
import { AvailabilityGrid, type AvailGrid } from './AvailabilityGrid';
import { DateField, isIsoDay } from './DateField';

type Mine = { hours: number[]; days: number[]; grid: AvailGrid; updatedAt: string | null; exceptions: { id: string; from: string; to: string; reason: string }[] };

const period = (e: { from: string; to: string }) => (e.from === e.to ? fD(e.from) : `du ${fD(e.from)} au ${fD(e.to)}`);

/**
 * Mes disponibilités (web : AvailabilityPage) : semaine type de l'entraîneur, ou du joueur choisi par le parent,
 * et indisponibilités datées. La direction s'en sert pour placer les groupes et proposer des remplaçants.
 */
export function AvailabilityScreen({ coach }: { coach: boolean }) {
  const toast = useToast();
  const { playerId } = useAuth();
  const pid = coach ? undefined : playerId;
  const q = useQuery({
    queryKey: ['availability', pid ?? 'me'],
    queryFn: () => api.get<Mine>('/availability/me', { playerId: pid }),
    enabled: coach || Boolean(pid),
  });
  const [grid, setGrid] = useState<AvailGrid>({});
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [removing, setRemoving] = useState<string>();
  useEffect(() => {
    if (q.data) setGrid(q.data.grid);
  }, [q.data]);
  const dirty = Boolean(q.data) && JSON.stringify(grid) !== JSON.stringify(q.data?.grid);

  const save = useAction(() => api.put('/availability/me', { grid, playerId: pid }), { invalidate: [['availability']], success: 'Disponibilités enregistrées.' });
  const add = useAction(() => api.post('/availability/me/exceptions', { from, to: to || from, reason: reason.trim(), playerId: pid }), {
    invalidate: [['availability']],
    success: 'Indisponibilité ajoutée.',
    onSuccess: () => {
      setFrom('');
      setTo('');
      setReason('');
    },
  });
  const remove = useAction((id: string) => api.delete(`/availability/me/exceptions/${id}`, { playerId: pid }), { invalidate: [['availability']], success: 'Indisponibilité retirée.' });

  const fillAll = () => q.data && setGrid(Object.fromEntries(q.data.days.flatMap((d) => q.data!.hours.map((h) => [`${d}-${h}`, 'D' as const]))));
  const submitException = () => {
    if (!from || !isIsoDay(from) || !reason.trim()) return toast('Date et motif obligatoires.');
    if (to && to < from) return toast('La date de fin suit la date de début.');
    add.mutate();
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <PageHeader
        title="Mes disponibilités"
        subtitle={
          coach
            ? 'Découvrez votre semaine type : la direction place les groupes sur vos créneaux disponibles.'
            : 'Découvrez la semaine type du joueur : indiquez les heures impossibles (école, études).'
        }
      />
      {!coach && <KidSelect />}
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {q.data && (
          <>
            <Pills>
              <Button onPress={fillAll}>Tout disponible</Button>
              <Button onPress={() => setGrid({})}>Tout effacer</Button>
            </Pills>
            <Card style={{ padding: 12 }}>
              <AvailabilityGrid hours={q.data.hours} days={q.data.days} grid={grid} onChange={setGrid} />
              {q.data.updatedAt ? (
                <Pills>
                  <Pill tone="s">{`Mis à jour le ${fD(q.data.updatedAt.slice(0, 10))}`}</Pill>
                </Pills>
              ) : null}
            </Card>
            <Button variant="primary" full onPress={() => save.mutate()} disabled={!dirty} loading={save.isPending}>
              Enregistrer
            </Button>
          </>
        )}
        <Section title="Indisponibilités datées">
          <Card>
            <DateField label="Du *" value={from} onChange={setFrom} />
            <DateField label="Au (facultatif)" value={to} onChange={setTo} min={from || undefined} optional />
            <Field label="Motif *" value={reason} maxLength={200} onChangeText={setReason} placeholder="ex. examens, congé" />
            <Button onPress={submitException} loading={add.isPending}>
              Ajouter
            </Button>
          </Card>
          {q.data?.exceptions.length ? (
            q.data.exceptions.map((e) => (
              <Card key={e.id}>
                <CardRow>
                  <CardTitle>{e.reason}</CardTitle>
                  <IconButton label="Supprimer l’indisponibilité" tone="danger" onPress={() => setRemoving(e.id)}>
                    <T size={16} color="#111">
                      ✕
                    </T>
                  </IconButton>
                </CardRow>
                <Pills>
                  <Pill tone="r">{period(e)}</Pill>
                </Pills>
              </Card>
            ))
          ) : (
            <EmptyState>Aucune indisponibilité à venir.</EmptyState>
          )}
        </Section>
      </QueryState>
      <View>
        <Note>Touchez une case pour passer de « non renseigné » à Disponible, Préféré puis Indisponible. Pensez à enregistrer.</Note>
      </View>
      <Confirm
        open={Boolean(removing)}
        title="Supprimer cette indisponibilité ?"
        message="La date redevient disponible selon votre semaine type."
        confirmLabel="Supprimer"
        danger
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(undefined)}
      />
    </Screen>
  );
}
