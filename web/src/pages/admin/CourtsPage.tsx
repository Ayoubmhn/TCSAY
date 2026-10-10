import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { FormGrid, SelectField, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { SURFACE_LABEL, type Court, type CourtSurface } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const KEYS = [['courts'], ['grid']];

function CourtFormModal({ open, court, onClose }: { open: boolean; court?: Court; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [surface, setSurface] = useState<CourtSurface>('CLAY');
  const [lit, setLit] = useState('1');
  const courtRef = useRef(court);
  courtRef.current = court;
  useEffect(() => {
    if (!open) return;
    const c = courtRef.current;
    setName(c?.name ?? '');
    setSurface(c?.surface ?? 'CLAY');
    setLit(c ? (c.lit ? '1' : '0') : '1');
  }, [open]);

  const save = useAction(
    () => {
      const body = { name, surface, lit: lit === '1' };
      return court ? api.patch(`/courts/${court.id}`, { ...body, version: court.version }) : api.post('/courts', body);
    },
    { invalidate: KEYS, success: court ? 'Terrain enregistré.' : 'Terrain créé.', onSuccess: onClose },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast('Le nom est obligatoire.');
    save.mutate();
  };

  return (
    <Modal
      open={open}
      title={court ? 'Modifier le terrain' : 'Nouveau terrain'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="court-form" disabled={save.isPending}>
            {court ? 'Enregistrer' : 'Créer le terrain'}
          </Button>
        </>
      }
    >
      <FormGrid id="court-form" onSubmit={submit}>
        <TextField label="Nom" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Court 5" />
        <SelectField label="Surface" value={surface} onChange={(e) => setSurface(e.target.value as CourtSurface)}>
          {(Object.keys(SURFACE_LABEL) as CourtSurface[]).map((k) => (
            <option key={k} value={k}>
              {SURFACE_LABEL[k]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Éclairage" full value={lit} onChange={(e) => setLit(e.target.value)}>
          <option value="1">☀ Éclairé : réservable la nuit</option>
          <option value="0">Sans éclairage : jour seulement</option>
        </SelectField>
      </FormGrid>
    </Modal>
  );
}

/** Terrains (vCourts) : entretien, désactivation (R11). */
export function CourtsPage() {
  const q = useQuery({ queryKey: ['courts'], queryFn: () => api.get<Court[]>('/courts') });
  const [form, setForm] = useState<{ open: boolean; court?: Court }>({ open: false });
  const [toDisable, setToDisable] = useState<Court>();

  const maint = useAction((c: Court) => api.post(`/courts/${c.id}/maintenance`, { maintenance: !c.maintenance }), {
    invalidate: KEYS,
    success: (_r, c) => (c.maintenance ? `${c.name} de nouveau disponible.` : `${c.name} en entretien.`),
  });
  const toggle = useAction((c: Court) => api.post(`/courts/${c.id}/${c.active ? 'deactivate' : 'activate'}`), {
    invalidate: KEYS,
    success: (_r, c) => (c.active ? 'Terrain désactivé.' : 'Terrain réactivé.'),
    onSuccess: () => setToDisable(undefined),
  });

  return (
    <>
      <PageHeader
        title="Terrains"
        subtitle="Découvrez les terrains et leur disponibilité."
        action={
          <Button variant="primary" onClick={() => setForm({ open: true })}>
            + Nouveau terrain
          </Button>
        }
      />
      <div className="mt-5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid>
              {q.data.map((c) => (
                <Card key={c.id}>
                  <CardRow>
                    <h3>{c.name}</h3>
                    <Pill tone={!c.active ? 'r' : c.maintenance ? 's' : 'g'}>
                      {!c.active ? 'Désactivé' : c.maintenance ? 'Entretien' : 'Actif'}
                    </Pill>
                  </CardRow>
                  <Pills>
                    <Pill tone="b">{SURFACE_LABEL[c.surface]}</Pill>
                    <Pill tone={c.lit ? 'g' : 's'}>{c.lit ? '☀ Éclairé' : 'Sans éclairage'}</Pill>
                  </Pills>
                  <CardText>
                    {c.futureReservations} réservation{c.futureReservations > 1 ? 's' : ''} à venir
                  </CardText>
                  <CardActions>
                    {c.active && (
                      <Button onClick={() => maint.mutate(c)} disabled={maint.isPending}>
                        {c.maintenance ? 'Fin d’entretien' : 'Mettre en entretien'}
                      </Button>
                    )}
                    <Button onClick={() => setForm({ open: true, court: c })}>Modifier</Button>
                    {c.active ? (
                      <Button variant="danger" onClick={() => setToDisable(c)}>
                        Désactiver
                      </Button>
                    ) : (
                      <Button onClick={() => toggle.mutate(c)}>Réactiver</Button>
                    )}
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun terrain.</EmptyState>
          )}
        </QueryState>
      </div>
      <Note>Un terrain avec des réservations futures ne peut pas être désactivé (R11).</Note>

      <CourtFormModal open={form.open} court={form.court} onClose={() => setForm({ open: false })} />
      <ConfirmModal
        open={Boolean(toDisable)}
        title="Désactiver ce terrain ?"
        text={`${toDisable?.name ?? ''} ne sera plus réservable.`}
        cta="Désactiver"
        pending={toggle.isPending}
        onConfirm={() => toDisable && toggle.mutate(toDisable)}
        onClose={() => setToDisable(undefined)}
      />
    </>
  );
}
