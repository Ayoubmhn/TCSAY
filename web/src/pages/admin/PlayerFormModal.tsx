import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { FormGrid, SelectField, TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { toDateInput } from '../../lib/format';
import type { Category, Parent, Player, Suggestion } from '../../lib/types';
import { useAction } from '../../lib/useAction';

type Form = {
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: '' | 'M' | 'F';
  email: string;
  phone: string;
  parentId: string;
  categoryId: string;
  derogationReason: string;
};

const EMPTY: Form = { firstName: '', lastName: '', birthDate: '', gender: '', email: '', phone: '', parentId: '', categoryId: '', derogationReason: '' };

/** Formulaire joueur (playerForm du prototype) : catégorie proposée en direct, règles R3 / R9 rappelées en pastilles. */
export function PlayerFormModal({ open, player, onClose }: { open: boolean; player?: Player; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Form>(EMPTY);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  // Joueur lu à l'ouverture seulement : un rechargement de la liste n'efface pas la saisie.
  const playerRef = useRef(player);
  playerRef.current = player;
  useEffect(() => {
    if (!open) return;
    const player = playerRef.current;
    setF(
      player
        ? {
            firstName: player.firstName,
            lastName: player.lastName,
            birthDate: toDateInput(player.birthDate),
            gender: player.gender,
            email: player.email ?? '',
            phone: player.phone ?? '',
            parentId: '',
            categoryId: player.category?.id ?? '',
            derogationReason: player.derogationReason ?? '',
          }
        : EMPTY,
    );
  }, [open]);

  const parents = useQuery({ queryKey: ['parents'], queryFn: () => api.get<Parent[]>('/parents'), enabled: open && !player });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories'), enabled: open });
  const suggestion = useQuery({
    queryKey: ['suggest', f.birthDate, f.gender],
    queryFn: () => api.get<Suggestion>('/categories/suggest', { birthDate: f.birthDate, gender: f.gender }),
    enabled: open && /^\d{4}-\d{2}-\d{2}$/.test(f.birthDate) && Boolean(f.gender),
  });
  const s = suggestion.data;

  const create = useAction(() => api.post<Player & { sentTo: string | null }>('/players', body(f)), {
    invalidate: [['players'], ['dashboard'], ['emails'], ['parents'], ['categories']],
    success: (p) => (p.sentTo ? `Joueur créé. Identifiants et informations envoyés à ${p.sentTo}.` : 'Joueur créé.'),
    onSuccess: onClose,
  });
  const update = useAction(
    async () => {
      await api.patch(`/players/${player!.id}`, {
        version: player!.version,
        firstName: f.firstName,
        lastName: f.lastName,
        birthDate: f.birthDate,
        gender: f.gender || undefined,
        email: f.email,
        phone: f.phone,
      });
      if (f.categoryId && f.categoryId !== player!.category?.id) {
        await api.post(`/players/${player!.id}/category`, { categoryId: f.categoryId, derogationReason: f.derogationReason || undefined });
      }
    },
    { invalidate: [['players'], ['categories'], ['groups']], success: 'Joueur enregistré.', onSuccess: onClose },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.firstName.trim() || !f.lastName.trim()) return toast('Prénom et nom sont obligatoires.');
    if (!f.gender) return toast('Le genre est obligatoire.');
    if (!f.birthDate) return toast('La date de naissance est obligatoire.');
    if (s && 'error' in s) return toast(s.error);
    if (!player && s && 'minor' in s) {
      if (s.minor && !f.parentId) return toast('Un mineur doit avoir au moins un parent lié (R9).');
      if (!s.minor && !f.email.trim()) return toast('L’email est obligatoire pour un joueur majeur.');
    }
    if (player) update.mutate();
    else create.mutate();
  };

  const minor = s && 'minor' in s ? s.minor : undefined;

  return (
    <Modal
      open={open}
      title={player ? 'Modifier le joueur' : 'Nouveau joueur'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="player-form" disabled={create.isPending || update.isPending}>
            {player ? 'Enregistrer' : 'Créer et envoyer les identifiants'}
          </Button>
        </>
      }
    >
      <FormGrid id="player-form" onSubmit={submit}>
        <TextField label="Prénom" value={f.firstName} onChange={set('firstName')} />
        <TextField label="Nom" value={f.lastName} onChange={set('lastName')} />
        <TextField label="Date de naissance" type="date" value={f.birthDate} onChange={set('birthDate')} />
        <SelectField label="Genre (obligatoire)" value={f.gender} onChange={set('gender')}>
          <option value="">—</option>
          <option value="M">Garçon / Homme</option>
          <option value="F">Fille / Femme</option>
        </SelectField>

        <div className="col-span-full">
          {!s ? (
            <Pill tone="b" className="whitespace-normal">
              Saisissez la naissance et le genre : la catégorie est proposée automatiquement.
            </Pill>
          ) : 'error' in s ? (
            <Pill tone="r">{s.error}</Pill>
          ) : (
            <Pills>
              <Pill tone="g">Catégorie proposée : {s.category.name}</Pill>
              <Pill tone="b">
                {s.age} ans au 31/12/{s.referenceYear}
              </Pill>
              {s.alternative && <Pill tone="s">Possible aussi : {s.alternative.name}</Pill>}
              <Pill tone="s">{s.minor ? 'Mineur : parent obligatoire' : 'Majeur : email obligatoire'}</Pill>
            </Pills>
          )}
        </div>

        <TextField
          label="Email"
          type="email"
          value={f.email}
          onChange={set('email')}
          placeholder={minor === false ? 'obligatoire pour un majeur' : 'facultatif pour un mineur'}
        />
        <TextField label="Téléphone" value={f.phone} onChange={set('phone')} />
        {!player && (
          <SelectField label="Parent lié (obligatoire pour un mineur)" full value={f.parentId} onChange={set('parentId')}>
            <option value="">— Aucun —</option>
            {parents.data
              ?.filter((p) => p.isActive)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </option>
              ))}
          </SelectField>
        )}
        <SelectField label="Catégorie (sinon catégorie proposée)" full value={f.categoryId} onChange={set('categoryId')}>
          <option value="">{s && 'category' in s ? `Proposée : ${s.category.name}` : '— Proposée automatiquement —'}</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Dérogation de catégorie (motif, si catégorie hors norme)"
          full
          value={f.derogationReason}
          onChange={set('derogationReason')}
          placeholder="Ex. niveau adapté à un autre groupe"
        />
      </FormGrid>
    </Modal>
  );
}

function body(f: Form) {
  return {
    firstName: f.firstName,
    lastName: f.lastName,
    birthDate: f.birthDate,
    gender: f.gender,
    email: f.email || undefined,
    phone: f.phone || undefined,
    parentId: f.parentId || undefined,
    categoryId: f.categoryId || undefined,
    derogationReason: f.derogationReason || undefined,
  };
}
