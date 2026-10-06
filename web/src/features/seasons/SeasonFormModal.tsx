import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/Button';
import { FormGrid, SelectField, TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../lib/api';
import { toDateInput } from '../../lib/format';
import { useCreateSeason, useUpdateSeason, type Season } from './api';

const schema = z
  .object({
    label: z.string().trim().min(1, 'Le libellé est obligatoire.').max(40, 'Libellé : 40 caractères maximum.'),
    startDate: z.string().min(1, 'La date de début est obligatoire.'),
    endDate: z.string().min(1, 'La date de fin est obligatoire.'),
    status: z.enum(['DRAFT', 'HISTORICAL']),
  })
  .refine((v) => v.endDate > v.startDate, {
    path: ['endDate'],
    message: 'La date de fin doit être postérieure à la date de début.',
  });

type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = { label: '', startDate: '', endDate: '', status: 'DRAFT' };
const FORM_ID = 'season-form';

/** Création (season absent) ou modification d'une saison. Erreurs de saisie en toast, comme le prototype. */
export function SeasonFormModal({ open, season, onClose }: { open: boolean; season?: Season; onClose: () => void }) {
  const toast = useToast();
  const create = useCreateSeason();
  const update = useUpdateSeason();
  const editing = Boolean(season);

  const { register, handleSubmit, reset } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    if (!open) return;
    reset(
      season
        ? { label: season.label, startDate: toDateInput(season.startDate), endDate: toDateInput(season.endDate), status: 'DRAFT' }
        : EMPTY,
    );
  }, [open, season, reset]);

  const pending = create.isPending || update.isPending;

  const onSubmit = handleSubmit(
    async ({ status, ...fields }) => {
      try {
        if (season) {
          await update.mutateAsync({ id: season.id, version: season.version, ...fields });
          toast('Saison enregistrée.');
        } else {
          await create.mutateAsync({ ...fields, status });
          toast(`Saison ${fields.label.trim()} créée.`);
        }
        onClose();
      } catch (error) {
        toast(errorMessage(error));
      }
    },
    (errors) => {
      const first = Object.values(errors)[0]?.message;
      if (first) toast(first);
    },
  );

  return (
    <Modal
      open={open}
      title={editing ? 'Modifier la saison' : 'Nouvelle saison'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form={FORM_ID} disabled={pending}>
            {editing ? 'Enregistrer' : 'Créer la saison'}
          </Button>
        </>
      }
    >
      <FormGrid id={FORM_ID} onSubmit={onSubmit}>
        <TextField label="Libellé" placeholder="2027-2028" full {...register('label')} />
        <TextField label="Date de début" type="date" {...register('startDate')} />
        <TextField label="Date de fin" type="date" {...register('endDate')} />
        {!editing && (
          <SelectField label="Statut initial" full {...register('status')}>
            <option value="DRAFT">Brouillon (préparation)</option>
            <option value="HISTORICAL">Historique (saison passée, pour l’import des cahiers)</option>
          </SelectField>
        )}
      </FormGrid>
    </Modal>
  );
}
