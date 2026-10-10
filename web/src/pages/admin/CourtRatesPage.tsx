import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, Kpi } from '../../components/ui/Card';
import { TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { DT } from '../../lib/format';
import type { CourtRate, Settings } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const TYPE = { LEISURE: 'Loisir', PRIVATE: 'Séance privée' } as const;

/** Tarifs terrains (vCtar) : prix à l'heure par type et période. */
export function CourtRatesPage() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['court-rates'], queryFn: () => api.get<CourtRate[]>('/court-rates') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
  const [edit, setEdit] = useState<CourtRate>();
  const [price, setPrice] = useState('');
  useEffect(() => setPrice(edit ? String(edit.pricePerHour) : ''), [edit]);

  const save = useAction(() => api.patch(`/court-rates/${edit!.id}`, { version: edit!.version, pricePerHour: Number(price) }), {
    invalidate: [['court-rates']],
    success: 'Tarif enregistré.',
    onSuccess: () => setEdit(undefined),
  });

  return (
    <>
      <PageHeader title="Tarifs terrains" subtitle="Découvrez les tarifs horaires de réservation." />
      <div className="mt-5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          <CardGrid>
            {q.data?.map((t) => (
              <Card key={t.id}>
                <CardRow>
                  <h3>{TYPE[t.type]}</h3>
                  <Pill tone={t.period === 'NIGHT' ? 'b' : 'g'}>{t.period === 'NIGHT' ? '☾ Nuit' : '☀ Jour'}</Pill>
                </CardRow>
                <Kpi>
                  {DT(t.pricePerHour)} <span className="text-sm font-medium text-mut">/ heure</span>
                </Kpi>
                <CardActions>
                  <Button onClick={() => setEdit(t)}>Modifier</Button>
                </CardActions>
              </Card>
            ))}
          </CardGrid>
        </QueryState>
      </div>
      <Note>
        Nuit à partir de <b>{settings.data?.nightStartHour ?? 18}h</b> (début à confirmer). Délai d’annulation :{' '}
        <b>{settings.data?.cancelDelayHours ?? 24} h</b> (paramétrable).
      </Note>
      <Modal
        open={Boolean(edit)}
        title={edit ? `${TYPE[edit.type]} · ${edit.period === 'NIGHT' ? 'Nuit' : 'Jour'}` : ''}
        onClose={() => setEdit(undefined)}
        footer={
          <>
            <Button onClick={() => setEdit(undefined)}>Annuler</Button>
            <Button
              variant="primary"
              data-primary
              disabled={save.isPending}
              onClick={() => (price === '' || !(Number(price) >= 0) ? toast('Prix invalide.') : save.mutate())}
            >
              Enregistrer
            </Button>
          </>
        }
      >
        <TextField label="Prix à l’heure (DT)" type="number" min={0} step="0.001" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Modal>
    </>
  );
}
