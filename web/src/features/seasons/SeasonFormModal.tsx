import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/Button';
import { SelectField, TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../lib/api';
import { toDateInput } from '../../lib/format';
import { useCreateSeason, useUpdateSeason, type Season } from './api';

const schema = z
  .object({
    label: z.string().trim().min(1, 'Libellé obligatoire').max(40, '40 caractères maximum'),
    startDate: z.string().min(1, 'Date de début obligatoire'),
    endDate: z.string().min(1, 'Date de fin obligatoire'),
    status: z.enum(['DRAFT', 'HISTORICAL']),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate > v.startDate, {
    path: ['endDate'],
    message: 'La fin doit suivre le début',
  });

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = { label: '', startDate: '', endDate: '', status: 'DRAFT' };

/** Création (season absent) ou modification d'une saison. */
export function SeasonFormModal({ open, season, onClose }: { open: boolean; season?: Season; onClose: () => void }) {
  const toast = useToast();
  const create = useCreateSeason();
  const update = useUpdateSeason();
  const editing = Boolean(season);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    if (!open) return;
    reset(
      season
        ? { label: season.label, startDate: toDateInput(season.startDate), endDate: toDateInput(season.endDate), status: 'DRAFT' }
        : EMPTY,
    );
  }, [open, season, reset]);

  const pending = create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (season) {
        const { status: _ignored, ...fields } = values;
        await update.mutateAsync({ id: season.id, version: season.version, ...fields });
        toast('Saison modifiée.');
      } else {
        await create.mutateAsync(values);
        toast('Saison créée.');
      }
      onClose();
    } catch (error) {
      toast(errorMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      title={editing ? 'Modifier la saison' : 'Nouvelle saison'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="season-form" disabled={pending}>
            {editing ? 'Enregistrer' : 'Créer'}
          </Button>
        </>
      }
    >
      <form id="season-form" noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField label="Libellé" placeholder="2026-2027" error={errors.label?.message} {...register('label')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Début" type="date" error={errors.startDate?.message} {...register('startDate')} />
          <TextField label="Fin" type="date" error={errors.endDate?.message} {...register('endDate')} />
        </div>
        {!editing && (
          <SelectField label="Statut initial" error={errors.status?.message} {...register('status')}>
            <option value="DRAFT">Brouillon</option>
            <option value="HISTORICAL">Historique (saison passée, avant import)</option>
          </SelectField>
        )}
      </form>
    </Modal>
  );
}
