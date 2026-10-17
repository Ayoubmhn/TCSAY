import { useQuery } from '@tanstack/react-query';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { ActionIcon } from '../../components/ui/ActionIcon';
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
import { categoryPairs, pairName } from '../../lib/categories';
import { DT } from '../../lib/format';
import type { Category, Fee, Group, SeasonLite } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const LOCKED = ['CLOSED', 'HISTORICAL'];

/** Une carte par paire (garçons et filles) quand les deux tarifs sont identiques, sinon une carte par catégorie. */
function feeCards(fees: Fee[], categories: Category[]) {
  const groups = new Map<string, Fee[]>();
  for (const f of fees) {
    const k = `${f.category.pairCode}|${f.group?.id ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const same = (a: Fee, b: Fee) => a.amount === b.amount && a.depositAmount === b.depositAmount && a.physicalIncluded === b.physicalIncluded;
  return [...groups.values()].flatMap((list) => {
    if (list.length > 1 && list.every((f) => same(f, list[0]))) {
      const cats = categories.filter((c) => list.some((f) => f.category.id === c.id));
      return [{ fee: list[0], title: cats.length > 1 ? pairName(cats) : list[0].category.name, pair: true }];
    }
    // Tarifs différents (ou un seul de la paire) : chaque catégorie se modifie seule ; « + Nouveau tarif » les réunit.
    return list.map((f) => ({ fee: f, title: f.category.name, pair: false }));
  });
}

function FeeFormModal({
  open,
  fee,
  title,
  pair: pairFee = true,
  season,
  onClose,
}: {
  open: boolean;
  fee?: Fee;
  /** Nom affiché (paire ou catégorie seule). */
  title?: string;
  /** Modification appliquée à toute la paire. */
  pair?: boolean;
  season?: SeasonLite;
  onClose: () => void;
}) {
  const toast = useToast();
  const [categoryId, setCategoryId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [amount, setAmount] = useState('');
  const [deposit, setDeposit] = useState('0');
  const [physical, setPhysical] = useState(false);
  const [reason, setReason] = useState('');
  const [pair, setPair] = useState(true);
  const feeRef = useRef(fee);
  feeRef.current = fee;
  useEffect(() => {
    if (!open) return;
    const f = feeRef.current;
    setCategoryId(f?.category.id ?? '');
    setGroupId(f?.group?.id ?? '');
    setAmount(f ? String(f.amount) : '');
    setDeposit(f ? String(f.depositAmount) : '0');
    setPhysical(f?.physicalIncluded ?? false);
    setReason('');
    setPair(true);
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
        ? api.patch(`/fees/${fee.id}`, { version: fee.version, amount: Number(amount), depositAmount: Number(deposit), physicalIncluded: physical, pair: pairFee, reason: reason || undefined })
        : api.post('/fees', {
            seasonId: season?.id,
            categoryId,
            groupId: groupId || undefined,
            amount: Number(amount),
            depositAmount: Number(deposit),
            physicalIncluded: physical,
            pair,
          }),
    { invalidate: [['fees']], success: fee ? (locked ? 'Tarif modifié. Motif enregistré.' : 'Tarif enregistré.') : 'Tarif créé.', onSuccess: onClose },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!fee && !categoryId) return toast('Catégorie obligatoire.');
    if (!(Number(amount) >= 0) || amount === '') return toast('Montant invalide.');
    if (deposit === '' || !(Number(deposit) >= 0)) return toast('Acompte invalide.');
    if (Number(deposit) > Number(amount)) return toast('L’acompte ne peut pas dépasser le montant de la saison.');
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
              <Pill tone="s">{title ?? fee.category.name}</Pill>
              {fee.group && <Pill tone="s">{fee.group.name}</Pill>}
              <Pill tone="b">Saison {fee.season.label}</Pill>
            </Pills>
          </div>
        ) : (
          <>
            <SelectField label="Catégorie" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— Choisir —</option>
              {categoryPairs(categories.data ?? []).map((p) =>
                pair ? (
                  <option key={p.code} value={p.categories[0].id}>
                    {p.name}
                  </option>
                ) : (
                  p.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                ),
              )}
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
        {!fee && (
          <label className="col-span-full flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={pair}
              onChange={(e) => {
                setPair(e.target.checked);
                setCategoryId('');
              }}
              className="h-[18px] w-[18px] accent-pri"
            />
            Tarif commun aux garçons et aux filles de la catégorie
          </label>
        )}
        <TextField label="Montant de la saison (DT)" type="number" min={0} step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <TextField label="Acompte à l’inscription (DT)" type="number" min={0} step="0.001" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        <label className="col-span-full flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={physical} onChange={(e) => setPhysical(e.target.checked)} className="h-[18px] w-[18px] accent-pri" />
          Séance physique incluse dans ce tarif
        </label>
        <p className="col-span-full m-0 text-[13px] text-mut">
          Le mode de paiement est choisi à l’inscription du joueur : comptant (une tranche), par semestre (acompte + 2 tranches) ou par mois (acompte + une tranche le 5 de chaque mois).
        </p>
        {locked && <TextArea label="Motif (obligatoire)" full value={reason} onChange={(e) => setReason(e.target.value)} />}
      </FormGrid>
    </Modal>
  );
}

/** Tarifs d'entraînement (vFees) : par catégorie et par groupe ; R6 sur saison clôturée. */
export function FeesPage() {
  const [view, setView] = useViewMode('tarifs');
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
  const [form, setForm] = useState<{ open: boolean; fee?: Fee; title?: string; pair?: boolean }>({ open: false });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories') });
  const cards = feeCards(q.data ?? [], categories.data ?? []);

  return (
    <>
      <PageHeader
        title="Tarifs d’entraînement"
        subtitle="Découvrez les tarifs par catégorie et par groupe."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            {season && !LOCKED.includes(season.status) && (
              <Button variant="primary" onClick={() => setForm({ open: true })}>
                + Nouveau tarif
              </Button>
            )}
          </div>
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
          {cards.length ? (
            <CardGrid list={view === 'list'}>
              {cards.map(({ fee: f, title, pair }) => (
                <Card key={f.id}>
                  <CardRow>
                    <h3>{title}</h3>
                    <Pill tone="s">{f.group?.name ?? 'Tous groupes'}</Pill>
                  </CardRow>
                  <Kpi>{DT(f.amount)}</Kpi>
                  <Pills>
                    <Pill tone="b">Acompte {DT(f.depositAmount)}</Pill>
                    <Pill tone={f.physicalIncluded ? 'g' : 's'}>{f.physicalIncluded ? 'Séance physique incluse' : 'Sans séance physique'}</Pill>
                  </Pills>
                  <CardActions>
                    <ActionIcon kind="edit" onClick={() => setForm({ open: true, fee: f, title, pair })} />
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
        Tarifs 2026-2027 du club : Lutins 800 DT, autres catégories 1000 DT. Acomptes et réductions famille : <b>à confirmer avec le bureau</b>. Sur une saison clôturée, motif
        obligatoire et anciennes valeurs conservées (R6).
      </Note>
      <FeeFormModal open={form.open} fee={form.fee} title={form.title} pair={form.pair} season={season} onClose={() => setForm({ open: false })} />
    </>
  );
}
