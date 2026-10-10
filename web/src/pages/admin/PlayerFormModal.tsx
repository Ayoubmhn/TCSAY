import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { CredentialsModal } from '../../components/CredentialsModal';
import { FormGrid, SelectField, TextField } from '../../components/ui/Field';
import { KeyValue } from '../../components/ui/KeyValue';
import { Modal } from '../../components/ui/Modal';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { DT, fD, isPlaceholderEmail, savedMessage, toDateInput } from '../../lib/format';
import type { Category, Credentials, Parent, PaymentPlan, Player, Suggestion } from '../../lib/types';
import { useAction } from '../../lib/useAction';

type Form = {
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: '' | 'M' | 'F';
  email: string;
  phone: string;
  cin: string;
  /** Parent existant, « new » pour le créer dans ce formulaire, ou vide. */
  parentId: string;
  np: { firstName: string; lastName: string; phone: string; email: string; cin: string };
  paymentPlan: '' | PaymentPlan;
  categoryId: string;
  derogationReason: string;
};

const NO_PARENT = { firstName: '', lastName: '', phone: '', email: '', cin: '' };
const EMPTY: Form = {
  firstName: '',
  lastName: '',
  birthDate: '',
  gender: '',
  email: '',
  phone: '',
  cin: '',
  parentId: '',
  np: NO_PARENT,
  paymentPlan: '',
  categoryId: '',
  derogationReason: '',
};
const CIN = /^[0-9A-Za-z]{6,12}$/;
const EMAIL = /^\S+@\S+\.\S+$/;

export const PLAN_LABEL: Record<PaymentPlan, string> = { FULL: 'Comptant', SEMESTER: 'Par semestre', MONTHLY: 'Par mois' };

type Created = Player & {
  sentTo: string | null;
  temporaryPasswords: Credentials[];
  membership: { plan: PaymentPlan; installments: { dueDate: string; amount: number }[] } | null;
};

/** Formulaire joueur (playerForm du prototype) : catégorie proposée en direct, règles R3 / R9 rappelées en pastilles. */
export function PlayerFormModal({ open, player, onClose }: { open: boolean; player?: Player; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Form>(EMPTY);
  const set = (k: Exclude<keyof Form, 'np'>) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setNp = (k: keyof Form['np']) => (e: { target: { value: string } }) => setF((x) => ({ ...x, np: { ...x.np, [k]: e.target.value } }));
  const [created, setCreated] = useState<Created>();
  const [changedCreds, setChangedCreds] = useState<(Credentials & { name: string })[]>([]);

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
            birthDate: player.birthDate ? toDateInput(player.birthDate) : '',
            gender: player.gender,
            email: player.email ?? '',
            phone: player.phone ?? '',
            cin: player.cin ?? '',
            parentId: '',
            np: NO_PARENT,
            paymentPlan: '',
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
  const effectiveCategory = f.categoryId || (s && 'category' in s ? s.category.id : '');
  const fee = useQuery({
    queryKey: ['fee-for', effectiveCategory],
    queryFn: () => api.get<{ id: string; amount: number; depositAmount: number; season: string } | null>('/fees/for-category', { categoryId: effectiveCategory }),
    enabled: open && !player && Boolean(effectiveCategory),
  });

  const create = useAction(() => api.post<Created>('/players', body(f)), {
    invalidate: [['players'], ['dashboard'], ['emails'], ['parents'], ['categories'], ['installments']],
    success: (p) => (p.sentTo ? `Joueur créé. Identifiants et informations envoyés à ${p.sentTo}.` : 'Joueur créé.'),
    onSuccess: (p) => {
      onClose();
      setCreated(p);
    },
  });
  const update = useAction(
    async () => {
      const before = player!;
      // Date envoyée seulement si elle change (une « année seule » du cahier reste signalée tant qu'elle n'est pas précisée).
      const birthDate = f.birthDate && f.birthDate !== (before.birthDate ? toDateInput(before.birthDate) : '') ? f.birthDate : undefined;
      const saved = await api.patch<{ credentials: Credentials | null }>(`/players/${before.id}`, {
        version: before.version,
        firstName: f.firstName,
        lastName: f.lastName,
        birthDate,
        gender: f.gender || undefined,
        email: isPlaceholderEmail(before.email) && !f.email.trim() ? undefined : f.email,
        phone: f.phone,
        cin: f.cin,
      });
      if (f.categoryId && f.categoryId !== before.category?.id) {
        await api.post(`/players/${before.id}/category`, { categoryId: f.categoryId, derogationReason: f.derogationReason || undefined });
      }
      return saved;
    },
    {
      invalidate: [['players'], ['categories'], ['groups'], ['player-profile'], ['emails']],
      success: (r) => savedMessage('Joueur enregistré.', r.credentials),
      onSuccess: (r) => {
        onClose();
        if (r.credentials?.temporaryPassword) setChangedCreds([{ ...r.credentials, name: `${f.firstName} ${f.lastName}` }]);
      },
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.firstName.trim() || !f.lastName.trim()) return toast('Prénom et nom sont obligatoires.');
    if (!f.gender) return toast('Le genre est obligatoire.');
    // Joueur importé sans date : modifiable sans la saisir (à compléter plus tard).
    if (!f.birthDate && (!player || player.birthDate)) return toast('La date de naissance est obligatoire.');
    if (s && 'error' in s) return toast(s.error);
    if (f.cin.trim() && !CIN.test(f.cin.trim())) return toast('CIN invalide (6 à 12 caractères).');
    if (!player && s && 'minor' in s) {
      if (s.minor && !f.parentId) return toast('Un mineur doit avoir au moins un parent lié (R9).');
      if (!s.minor) {
        if (!EMAIL.test(f.email.trim())) return toast('L’email est obligatoire pour un joueur majeur.');
        if (!f.phone.trim()) return toast('Le téléphone est obligatoire pour un joueur majeur.');
        if (!f.cin.trim()) return toast('La CIN est obligatoire pour un joueur majeur.');
      }
    }
    if (!player && f.parentId === 'new') {
      const p = f.np;
      if (!p.firstName.trim() || !p.lastName.trim()) return toast('Parent : prénom et nom obligatoires.');
      if (!p.phone.trim()) return toast('Parent : téléphone obligatoire.');
      if (!EMAIL.test(p.email.trim())) return toast('Parent : email invalide.');
      if (!CIN.test(p.cin.trim())) return toast('Parent : CIN obligatoire (6 à 12 caractères).');
    }
    if (!player && !f.paymentPlan) return toast('Choisissez le mode de paiement : comptant, par semestre ou par mois.');
    if (player) update.mutate();
    else create.mutate();
  };

  const minor = s && 'minor' in s ? s.minor : undefined;
  const adult = minor === false;

  return (
    <>
    <Modal
      open={open}
      size="lg"
      title={player ? 'Modifier le joueur' : 'Nouveau joueur'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="player-form" disabled={create.isPending || update.isPending}>
            {player ? 'Enregistrer' : 'Inscrire le joueur'}
          </Button>
        </>
      }
    >
      <FormGrid id="player-form" onSubmit={submit}>
        <TextField label="Prénom" value={f.firstName} onChange={set('firstName')} />
        <TextField label="Nom" value={f.lastName} onChange={set('lastName')} />
        <TextField
          label={player?.birthYearOnly ? 'Date de naissance (année seule connue : à préciser)' : player && !player.birthDate ? 'Date de naissance (à compléter)' : 'Date de naissance'}
          type="date"
          value={f.birthDate}
          onChange={set('birthDate')}
        />
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
          label={adult ? 'Email *' : 'Email'}
          type="email"
          value={f.email}
          onChange={set('email')}
          placeholder={adult ? 'obligatoire pour un majeur' : 'facultatif pour un mineur'}
        />
        <TextField label={adult ? 'Téléphone *' : 'Téléphone'} value={f.phone} onChange={set('phone')} inputMode="tel" />
        <TextField label={adult ? 'CIN *' : 'CIN (adulte)'} value={f.cin} onChange={set('cin')} inputMode="numeric" />
        {!player && (
          <SelectField label={minor ? 'Parent lié *' : 'Parent lié (obligatoire pour un mineur)'} value={f.parentId} onChange={set('parentId')}>
            <option value="">— Aucun —</option>
            <option value="new">+ Nouveau parent (le créer ici)</option>
            {parents.data
              ?.filter((p) => p.isActive)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </option>
              ))}
          </SelectField>
        )}
        {!player && f.parentId === 'new' && (
          <fieldset className="col-span-full grid grid-cols-1 gap-3 rounded-[22px] border-[1.5px] border-line p-3.5 min-[521px]:grid-cols-2">
            <legend className="px-1.5 text-[13px] font-semibold text-mut">Nouveau parent : identifiants envoyés par email</legend>
            <TextField label="Prénom du parent *" value={f.np.firstName} onChange={setNp('firstName')} />
            <TextField label="Nom du parent *" value={f.np.lastName} onChange={setNp('lastName')} />
            <TextField label="Téléphone du parent *" value={f.np.phone} onChange={setNp('phone')} inputMode="tel" />
            <TextField label="CIN du parent *" value={f.np.cin} onChange={setNp('cin')} inputMode="numeric" />
            <TextField label="Email du parent *" full type="email" value={f.np.email} onChange={setNp('email')} />
          </fieldset>
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
        {!player && (
          <>
            <SelectField label="Mode de paiement *" full value={f.paymentPlan} onChange={set('paymentPlan')}>
              <option value="">Choisir…</option>
              <option value="FULL">Comptant (une seule tranche)</option>
              <option value="SEMESTER">Par semestre (acompte + 2 tranches)</option>
              <option value="MONTHLY">Par mois (acompte + une tranche par mois)</option>
            </SelectField>
            <div className="col-span-full">
              {fee.data ? (
                <Pills>
                  <Pill tone="b">Cotisation {DT(fee.data.amount)}</Pill>
                  <Pill tone="s">Acompte {DT(fee.data.depositAmount)}</Pill>
                  <Pill tone="s">Saison {fee.data.season}</Pill>
                </Pills>
              ) : effectiveCategory && fee.isSuccess ? (
                <Pill tone="r" className="whitespace-normal">
                  Aucun tarif d’entraînement pour cette catégorie : la cotisation sera créée plus tard.
                </Pill>
              ) : null}
            </div>
          </>
        )}
      </FormGrid>
    </Modal>
    <Modal
      open={Boolean(created) && !created?.temporaryPasswords.length}
      title="Joueur inscrit"
      onClose={() => setCreated(undefined)}
      footer={
        <Button variant="primary" onClick={() => setCreated(undefined)}>
          Fermer
        </Button>
      }
    >
      {created && <CreatedSummary created={created} />}
    </Modal>
    <CredentialsModal
      items={(created?.temporaryPasswords ?? []).map((c) => ({ ...c, name: c.login }))}
      onClose={() => setCreated((c) => (c ? { ...c, temporaryPasswords: [] } : c))}
    />
    <CredentialsModal items={changedCreds} onClose={() => setChangedCreds([])} />
    </>
  );
}

function CreatedSummary({ created }: { created: Created }) {
  return (
    <>
      <div className="rounded-[18px] bg-fld px-4 py-2">
        <KeyValue label="Joueur">
          {created.firstName} {created.lastName}
        </KeyValue>
        <KeyValue label="Catégorie">{created.category?.name ?? '—'}</KeyValue>
        {created.sentTo && <KeyValue label="Email envoyé à">{created.sentTo}</KeyValue>}
        {created.membership && <KeyValue label="Mode de paiement">{PLAN_LABEL[created.membership.plan]}</KeyValue>}
      </div>
      {created.membership ? (
        <Pills>
          {created.membership.installments.map((i, n) => (
            <Pill key={n} tone="b">
              Tranche {n + 1}/{created.membership!.installments.length} · {fD(i.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })} · {DT(i.amount)}
            </Pill>
          ))}
        </Pills>
      ) : (
        <Pill tone="s" className="whitespace-normal">
          Pas de cotisation créée (aucun tarif d’entraînement pour cette catégorie).
        </Pill>
      )}
    </>
  );
}

function body(f: Form) {
  return {
    firstName: f.firstName,
    lastName: f.lastName,
    birthDate: f.birthDate,
    gender: f.gender,
    email: f.email.trim() || undefined,
    phone: f.phone.trim() || undefined,
    cin: f.cin.trim() || undefined,
    parentId: f.parentId && f.parentId !== 'new' ? f.parentId : undefined,
    newParent: f.parentId === 'new' ? { ...f.np, email: f.np.email.trim(), cin: f.np.cin.trim() } : undefined,
    paymentPlan: f.paymentPlan || undefined,
    categoryId: f.categoryId || undefined,
    derogationReason: f.derogationReason || undefined,
  };
}
