import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardSubtitle, EmptyState } from '../../components/ui/Card';
import { FilterSelect, Filters, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { ReceiptActions, ReceiptSummary, METHOD_LABEL } from '../../features/receipts/ReceiptModal';
import { receiptTestUrl, saveLayoutDraft } from '../../features/receipts/receiptPrint';
import { FIELD_LABEL, ReceiptSheet } from '../../features/receipts/ReceiptSheet';
import { api } from '../../lib/api';
import { DT, fullName, todayIso } from '../../lib/format';
import type { Receipt, ReceiptField, ReceiptLayout } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const FIELDS = Object.keys(FIELD_LABEL) as ReceiptField[];

/** Champ numérique en mm (pas de 0,5). */
function MmField({ label, value, onChange, step = 0.5 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <TextField
      label={label}
      type="number"
      step={step}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
    />
  );
}

/**
 * Réglage de l'impression sur le carnet : décalage global (marge de l'imprimante), taille du texte,
 * position de chaque champ (mm), aperçu à l'échelle et page de test avec repères.
 */
function LayoutEditor({ saved }: { saved: ReceiptLayout }) {
  const [layout, setLayout] = useState(saved);
  useEffect(() => setLayout(saved), [saved]);
  const dirty = JSON.stringify(layout) !== JSON.stringify(saved);
  const save = useAction(() => api.put<ReceiptLayout>('/receipts/layout', { layout }), {
    invalidate: [['receipt-layout'], ['audit']],
    success: 'Réglage du carnet enregistré.',
    onSuccess: () => saveLayoutDraft(null),
  });
  const setField = (key: ReceiptField, prop: 'x' | 'y' | 'w', v: number) =>
    setLayout((l) => ({ ...l, fields: { ...l.fields, [key]: { ...l.fields[key], [prop]: v } } }));
  const test = () => {
    saveLayoutDraft(layout);
    window.open(receiptTestUrl('carnet'), '_blank');
  };
  const sample = {
    numberText: '0000000',
    payerName: 'Nom Prénom',
    amount: 300,
    amountWords: 'ثلاثمائة دينار',
    label: '1ère tranche',
    method: 'CASH' as const,
    chequeNumber: null,
    seasonLabel: '2026-2027',
    issuedOn: todayIso(),
  };
  // Aperçu : feuille A5 réduite pour tenir dans l'écran (mm → px ≈ 3,78).
  const scale = 0.62;

  return (
    <>
      <CardGrid>
        <Card>
          <CardSubtitle>Toute l’impression</CardSubtitle>
          <div className="grid grid-cols-2 gap-2.5">
            <MmField label="Décalage horizontal (mm)" value={layout.offsetX} onChange={(v) => setLayout({ ...layout, offsetX: v })} />
            <MmField label="Décalage vertical (mm)" value={layout.offsetY} onChange={(v) => setLayout({ ...layout, offsetY: v })} />
            <MmField label="Taille du texte (pt)" step={1} value={layout.fontSize} onChange={(v) => setLayout({ ...layout, fontSize: v })} />
          </div>
          <Pills>
            <Pill tone="s">
              Feuille {layout.pageWidth} × {layout.pageHeight} mm
            </Pill>
          </Pills>
        </Card>
        {FIELDS.map((key) => (
          <Card key={key}>
            <CardSubtitle>{FIELD_LABEL[key]}</CardSubtitle>
            <div className="grid grid-cols-3 gap-2">
              <MmField label="Gauche" value={layout.fields[key].x} onChange={(v) => setField(key, 'x', v)} />
              <MmField label="Ligne" value={layout.fields[key].y} onChange={(v) => setField(key, 'y', v)} />
              <MmField label="Largeur" value={layout.fields[key].w} onChange={(v) => setField(key, 'w', v)} />
            </div>
          </Card>
        ))}
      </CardGrid>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          Enregistrer le réglage
        </Button>
        <Button onClick={test}>Imprimer une page de test</Button>
        {dirty && <Button onClick={() => setLayout(saved)}>Annuler les modifications</Button>}
      </div>
      <div className="mt-4 overflow-auto rounded-[24px] border-[1.5px] border-line bg-fld p-4" aria-label="Aperçu de l’impression sur le carnet">
        <div style={{ width: `${layout.pageWidth * 3.78 * scale}px`, height: `${layout.pageHeight * 3.78 * scale}px` }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <ReceiptSheet mode="carnet" layout={layout} values={sample} guides />
          </div>
        </div>
      </div>
    </>
  );
}

/** Reçus : historique par n° du carnet (valides et annulés), impression et réglage du carnet. */
export function ReceiptsPage() {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'VOIDED'>('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const q = useQuery({
    queryKey: ['receipts', term, status],
    queryFn: () => api.get<Receipt[]>('/receipts', { q: term || undefined, status: status || undefined }),
  });
  const layout = useQuery({ queryKey: ['receipt-layout'], queryFn: () => api.get<ReceiptLayout>('/receipts/layout') });
  const rows = q.data ?? [];
  const valid = rows.filter((r) => !r.voidedAt);

  return (
    <>
      <PageHeader title="Reçus" subtitle="Découvrez les reçus émis, leur n° de carnet et leurs impressions." />
      <Filters>
        <input
          className="fld w-[260px] text-fg"
          placeholder="N° de reçu, joueur ou payeur"
          aria-label="Rechercher un reçu"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FilterSelect label="Filtrer par état" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">Tous les reçus</option>
          <option value="ACTIVE">Valides</option>
          <option value="VOIDED">Annulés</option>
        </FilterSelect>
        <Link to="/admin/paiements" className="inline-flex items-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg">
          Émettre depuis Paiements
        </Link>
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        <Pills className="my-[18px]">
          <Pill tone="b">{rows.length} reçu(s)</Pill>
          <Pill tone="g">Valides {DT(valid.reduce((s, r) => s + r.amount, 0))}</Pill>
          {rows.length > valid.length && <Pill tone="r">{rows.length - valid.length} annulé(s)</Pill>}
        </Pills>
        {rows.length ? (
          <CardGrid>
            {rows.map((r) => (
              <Card key={r.id}>
                <CardRow>
                  <h3>{fullName(r.player)}</h3>
                  <Pill tone="g">{DT(r.amount)}</Pill>
                </CardRow>
                <Pills>
                  <Pill tone="s">{r.label}</Pill>
                  <Pill tone="s">{METHOD_LABEL[r.method]}</Pill>
                  <Pill tone="s">Saison {r.seasonLabel}</Pill>
                </Pills>
                <ReceiptSummary receipt={r} />
                {!r.voidedAt && (
                  <CardActions>
                    <ReceiptActions receipt={r} />
                  </CardActions>
                )}
              </Card>
            ))}
          </CardGrid>
        ) : (
          <EmptyState>Aucun reçu. Émettez-les depuis l’écran Paiements, après l’encaissement.</EmptyState>
        )}
      </QueryState>

      <Section title="Réglage de l’impression sur le carnet">
        <QueryState isPending={layout.isPending} error={layout.error} refetch={layout.refetch}>
          {layout.data && <LayoutEditor saved={layout.data} />}
        </QueryState>
      </Section>
      <Note>
        Réglage : imprimez la page de test sur une feuille blanche A5, superposez-la à un reçu du carnet devant une fenêtre,
        puis corrigez le décalage (mm, + vers la droite ou vers le bas). Un reçu n’est jamais supprimé : un reçu raté est
        annulé avec motif et son n° ne se réutilise pas.
      </Note>
    </>
  );
}
