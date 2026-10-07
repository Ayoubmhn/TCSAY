import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, EmptyState, Kpi } from '../../components/ui/Card';
import { FilterSelect, Filters, FormGrid, SelectField, TextArea, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { DT } from '../../lib/format';
import type { Category, Fee, Group, SeasonLite } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const LOCKED = ['CLOSED', 'HISTORICAL'];

function FeeFormModal({
  open,
  fee,
  season,
  onClose,
}: {
  open: boolean;
  fee?: Fee;
  season?: SeasonLite;
  onClose: () => void;
}) {
  const toast = useToast();
  const [categoryId, setCategoryId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState('2');
  const [reason, setReason] = useState('');
  const feeRef = useRef(fee);
  feeRef.current = fee;
  useEffect(() => {
    if (!open) return;
    const f = feeRef.current;
    setCategoryId(f?.category.id ?? '');
    setGroupId(f?.group?.id ?? '');
    setAmount(f ? String(f.amount) : '');
    setCount(f ? String(f.installmentsCount) : '2');
    setReason('');
  }, [open]);

  const locked = fee ? LOCKED.includes(fee.season.status) : false;
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories'), enabled: open && !fee });
  const groups = useQuery({
    queryKey: ['groups', season?.id],
    queryFn: () => api.get<Group[]>('/groups', { seasonId: season?.id }),
    enabled: open && !fee,
  });

  const save = useAction(
    () =>
      fee
        ? api.patch(`/fees/${fee.id}`, { version: fee.version, amount: Number(amount), installmentsCount: Number(count), reason: reason || undefined })
        : api.post('/fees', {
            seasonId: season?.id,
            categoryId,
            groupId: groupId || undefined,
            amount: Number(amount),
            installmentsCount: Number(count),
          }),
    { invalidate: [['fees']], success: fee ? (locked ? 'Tarif modifié. Motif enregistré.' : 'Tarif enregistré.') : 'Tarif créé.', onSuccess: onClose },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!fee && !categoryId) return toast('Catégorie obligatoire.');
    if (!(Number(amount) >= 0) || amount === '') return toast('Montant invalide.');
    if (locked && !reason.trim()) return toast('Le motif est obligatoire.');
    save.mutate();
  };

  return (
    <Modal
      open={open}
      title={fee ? (locked ? 'Modifier un tarif de saison clôturée' : 'Modifier le tarif') : 'Nouveau tarif'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form="fee-form" disabled={save.isPending}>
            {fee ? 'Enregistrer' : 'Créer le tarif'}
          </Button>
        </>
      }
    >
      {locked && <p className="m-0 text-mut">Les anciennes valeurs seront conservées dans le journal d’audit (R6).</p>}
      <FormGrid id="fee-form" onSubmit={submit}>
        {fee ? (
          <div className="col-span-full">
            <Pills>
              <Pill tone="s">{fee.category.name}</Pill>
              {fee.group && <Pill tone="s">{fee.group.name}</Pill>}
              <Pill tone="b">Saison {fee.season.label}</Pill>
            </Pills>
          </div>
        ) : (
          <>
            <SelectField label="Catégorie" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— Choisir —</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Groupe (facultatif)" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">— Tous les groupes —</option>
              {groups.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </SelectField>
          </>
        )}
        <TextField label="Montant de la saison (DT)" type="number" min={0} step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <TextField label="Nombre de tranches" type="number" min={1} max={12} value={count} onChange={(e) => setCount(e.target.value)} />
        {locked && <TextArea label="Motif (obligatoire)" full value={reason} onChange={(e) => setReason(e.target.value)} />}
      </FormGrid>
    </Modal>
  );
}

/** Tarifs d'entraînement (vFees) : par catégorie et par groupe ; R6 sur saison clôturée. */
export function FeesPage() {
  const seasons = useQuery({ queryKey: ['seasons', 'list'], queryFn: () => api.get<SeasonLite[]>('/seasons') });
  const options = (seasons.data ?? []).filter((s) => s.status !== 'HISTORICAL');
  const [seasonId, setSeasonId] = useState<string>();
  useEffect(() => {
    if (!seasonId && options.length) setSeasonId((options.find((s) => s.status === 'ACTIVE') ?? options[0]).id);
  }, [seasonId, options]);
  const season = options.find((s) => s.id === seasonId);
  const q = useQuery({
    queryKey: ['fees', seasonId],
    queryFn: () => api.get<Fee[]>('/fees', { seasonId }),
    enabled: Boolean(seasonId),
  });
  const [form, setForm] = useState<{ open: boolean; fee?: Fee }>({ open: false });

  return (
    <>
      <PageHeader
        title="Tarifs d’entraînement"
        subtitle="Découvrez les tarifs par catégorie et par groupe."
        action={
          season && !LOCKED.includes(season.status) ? (
            <Button variant="primary" onClick={() => setForm({ open: true })}>
              + Nouveau tarif
            </Button>
          ) : undefined
        }
      />
      <Filters>
        <FilterSelect label="Saison" value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              Saison {s.label}
              {LOCKED.includes(s.status) ? ' (clôturée)' : s.status === 'DRAFT' ? ' (brouillon)' : ''}
            </option>
          ))}
        </FilterSelect>
      </Filters>
      <div className="mt-2.5">
        <QueryState isPending={q.isPending && Boolean(seasonId)} error={q.error} refetch={q.refetch}>
          {q.data?.length ? (
            <CardGrid>
              {q.data.map((f) => (
                <Card key={f.id}>
                  <CardRow>
                    <h3>{f.category.name}</h3>
                    <Pill tone="s">{f.group?.name ?? 'Tous groupes'}</Pill>
                  </CardRow>
                  <Kpi>{DT(f.amount)}</Kpi>
                  <Pills>
                    <Pill tone="b">
                      {f.installmentsCount} tranche{f.installmentsCount > 1 ? 's' : ''} de {DT(Math.round((f.amount / f.installmentsCount) * 1000) / 1000)}
                    </Pill>
                  </Pills>
                  <CardActions>
                    <Button onClick={() => setForm({ open: true, fee: f })}>Modifier</Button>
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>Aucun tarif pour cette saison.</EmptyState>
          )}
        </QueryState>
      </div>
      <Note>
        Tarifs réels, tranches et réductions famille : <b>à confirmer avec le bureau</b>. Sur une saison clôturée, motif
        obligatoire et anciennes valeurs conservées (R6).
      </Note>
      <FeeFormModal open={form.open} fee={form.fee} season={season} onClose={() => setForm({ open: false })} />
    </>
  );
}
