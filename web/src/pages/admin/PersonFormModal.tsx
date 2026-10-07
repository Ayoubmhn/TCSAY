import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { FormGrid, TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';

export type PersonValues = { firstName: string; lastName: string; email: string; phone: string; payMode: string };

const EMPTY: PersonValues = { firstName: '', lastName: '', email: '', phone: '', payMode: '' };

/** Formulaire de compte (parent ou entraîneur) : création avec envoi des identifiants, ou modification. */
export function PersonFormModal({
  open,
  title,
  initial,
  editing,
  withPayMode = false,
  pending,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial?: Partial<PersonValues>;
  editing: boolean;
  withPayMode?: boolean;
  pending: boolean;
  onSubmit: (values: PersonValues) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [v, setV] = useState<PersonValues>(EMPTY);
  // Valeurs initiales lues à l'ouverture seulement (sinon chaque rendu du parent effacerait la saisie).
  const initialRef = useRef(initial);
  initialRef.current = initial;
  useEffect(() => {
    if (open) setV({ ...EMPTY, ...initialRef.current });
  }, [open]);
  const set = (k: keyof PersonValues) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!v.firstName.trim() || !v.lastName.trim()) return toast('Prénom et nom sont obligatoires.');
    if (!editing && !/^\S+@\S+\.\S+$/.test(v.email.trim())) return toast('Email invalide.');
    onSubmit(v);
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="person-form" disabled={pending}>
            {editing ? 'Enregistrer' : 'Créer et envoyer les identifiants'}
          </Button>
        </>
      }
    >
      <FormGrid id="person-form" onSubmit={submit}>
        <TextField label="Prénom" value={v.firstName} onChange={set('firstName')} />
        <TextField label="Nom" value={v.lastName} onChange={set('lastName')} />
        <TextField label="Email (identifiant)" type="email" value={v.email} onChange={set('email')} disabled={editing} />
        <TextField label="Téléphone" value={v.phone} onChange={set('phone')} />
        {withPayMode && (
          <TextField label="Rémunération (mensuel, horaire, forfait : à confirmer)" full value={v.payMode} onChange={set('payMode')} />
        )}
      </FormGrid>
    </Modal>
  );
}
