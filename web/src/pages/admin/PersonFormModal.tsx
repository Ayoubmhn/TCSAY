import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { FormGrid, SelectField, TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { isPlaceholderEmail } from '../../lib/format';
import type { StaffFunction } from '../../lib/types';

const STAFF_FUNCTIONS: [StaffFunction, string][] = [
  ['ADMIN_AGENT', 'Agent administratif'],
  ['SUPERVISOR', 'Agent superviseur'],
  ['TECH_DIRECTOR', 'Directeur technique'],
];

export type PersonKind = 'parent' | 'coach' | 'staff';

export type PersonValues = {
  firstName: string;
  lastName: string;
  cin: string;
  email: string;
  phone: string;
  payMode: '' | 'HOURLY' | 'MONTHLY';
  payRate: string;
  color: string;
  functions: StaffFunction[];
};

const EMPTY: PersonValues = { firstName: '', lastName: '', cin: '', email: '', phone: '', payMode: '', payRate: '', color: '#00b050', functions: [] };

const CIN = /^[0-9A-Za-z]{6,12}$/;
const EMAIL = /^\S+@\S+\.\S+$/;

/** Champs envoyés à l'API (chaînes vides retirées, taux en nombre). */
export function personPayload(kind: PersonKind, v: PersonValues) {
  const base = { firstName: v.firstName.trim(), lastName: v.lastName.trim(), cin: v.cin.trim() || undefined, phone: v.phone.trim() || undefined };
  if (kind === 'parent') return { ...base, email: v.email.trim(), phone: v.phone.trim() };
  const pay = { payMode: v.payMode, payRate: Number(v.payRate) };
  if (kind === 'coach') return { ...base, ...pay, color: v.color };
  return { ...base, ...pay, functions: v.functions };
}

/**
 * Formulaire de compte (parent, entraîneur ou personnel administratif).
 * Obligatoire : parent = nom, prénom, téléphone, email, CIN ; entraîneur / personnel = nom, prénom, CIN, rémunération.
 */
export function PersonFormModal({
  open,
  kind,
  title,
  initial,
  editing,
  pending,
  onSubmit,
  onClose,
}: {
  open: boolean;
  kind: PersonKind;
  title: string;
  initial?: Partial<PersonValues>;
  editing: boolean;
  pending: boolean;
  onSubmit: (values: PersonValues) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [v, setV] = useState<PersonValues>(EMPTY);
  // Valeurs initiales lues à l'ouverture seulement (sinon chaque rendu du parent effacerait la saisie).
  const initialRef = useRef(initial);
  initialRef.current = initial;
  // Email provisoire d'un compte importé : champ vide à compléter (les identifiants partiront à la nouvelle adresse).
  const placeholder = editing && isPlaceholderEmail(initial?.email);
  useEffect(() => {
    if (!open) return;
    const init = { ...EMPTY, ...initialRef.current };
    setV(isPlaceholderEmail(init.email) ? { ...init, email: '' } : init);
  }, [open]);
  const set = (k: Exclude<keyof PersonValues, 'functions'>) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const paid = kind !== 'parent';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!v.firstName.trim() || !v.lastName.trim()) return toast('Prénom et nom sont obligatoires.');
    // Comptes importés du cahier : CIN et téléphone parfois inconnus, à compléter plus tard.
    if ((!editing || v.cin.trim()) && !CIN.test(v.cin.trim())) return toast('CIN obligatoire (6 à 12 caractères).');
    if (kind === 'parent' && !editing) {
      if (!v.phone.trim()) return toast('Téléphone obligatoire.');
      if (!EMAIL.test(v.email.trim())) return toast('Email invalide.');
    } else if (v.email.trim() && !EMAIL.test(v.email.trim())) {
      return toast('Email invalide.');
    }
    if (kind === 'staff' && !v.functions.length) return toast('Choisissez au moins une fonction.');
    if (paid && !v.payMode) return toast('Choisissez la rémunération : à l’heure ou au mois.');
    if (paid && (v.payRate === '' || Number(v.payRate) < 0 || Number.isNaN(Number(v.payRate)))) return toast('Taux de rémunération invalide.');
    onSubmit(v);
  };

  const emailLabel = placeholder
    ? 'Email à compléter (identifiants envoyés à cette adresse)'
    : kind === 'parent'
      ? 'Email (identifiant)'
      : 'Email (facultatif : sinon identifiant = CIN)';

  return (
    <Modal
      open={open}
      size="lg"
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="person-form" disabled={pending}>
            {editing ? 'Enregistrer' : 'Créer le compte'}
          </Button>
        </>
      }
    >
      <FormGrid id="person-form" onSubmit={submit}>
        <TextField label="Prénom *" value={v.firstName} onChange={set('firstName')} />
        <TextField label="Nom *" value={v.lastName} onChange={set('lastName')} />
        <TextField label={editing ? 'CIN' : 'CIN *'} value={v.cin} onChange={set('cin')} inputMode="numeric" />
        <TextField label={kind === 'parent' && !editing ? 'Téléphone *' : 'Téléphone'} value={v.phone} onChange={set('phone')} inputMode="tel" />
        <TextField label={kind === 'parent' && !editing ? `${emailLabel} *` : emailLabel} full type="email" value={v.email} onChange={set('email')} />
        {editing && (
          <p className="col-span-full m-0 text-xs text-mut">
            Changer l’email remplace l’identifiant : un nouveau mot de passe temporaire est envoyé à la nouvelle adresse (changement obligatoire à la connexion).
          </p>
        )}
        {kind === 'staff' && (
          <fieldset className="col-span-full m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1.5 text-xs font-medium text-mut">Fonctions * (cumulables)</legend>
            <div className="flex flex-wrap gap-1.5">
              {STAFF_FUNCTIONS.map(([key, label]) => {
                const on = v.functions.includes(key);
                return (
                  <label key={key} className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-[13px] py-[6px] text-[13px] font-medium ${on ? 'bg-pg text-ink' : 'bg-fld text-fg'}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      className="h-4 w-4 accent-pri"
                      onChange={() => setV((x) => ({ ...x, functions: on ? x.functions.filter((f) => f !== key) : [...x.functions, key] }))}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
        {paid && (
          <>
            <SelectField label="Rémunération *" value={v.payMode} onChange={set('payMode')}>
              <option value="">Choisir…</option>
              <option value="HOURLY">À l’heure</option>
              <option value="MONTHLY">Au mois</option>
            </SelectField>
            <TextField
              label={v.payMode === 'HOURLY' ? 'Taux horaire (DT) *' : v.payMode === 'MONTHLY' ? 'Salaire mensuel (DT) *' : 'Montant (DT) *'}
              type="number"
              min={0}
              step="0.5"
              value={v.payRate}
              onChange={set('payRate')}
            />
          </>
        )}
        {kind === 'coach' && (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-mut">
            Couleur au planning
            <span className="flex items-center gap-2.5">
              <input type="color" aria-label="Couleur au planning" value={v.color} onChange={set('color')} className="h-10 w-14 cursor-pointer rounded-[14px] border-[1.5px] border-line bg-fld p-1" />
              <span className="text-[15px] text-fg tabular-nums">{v.color}</span>
            </span>
          </label>
        )}
      </FormGrid>
    </Modal>
  );
}
