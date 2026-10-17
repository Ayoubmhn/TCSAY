import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardRow, CardSubtitle, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { FilterSelect, Filters, FormGrid, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { Segmented } from '../../components/ui/Segmented';
import { PhotoPanel } from '../ai/AiPhotoReader';
import { EditableTable, type Col, type Result } from '../players/ImportTable';
import { api } from '../../lib/api';
import { DT, fD } from '../../lib/format';
import { useAction } from '../../lib/useAction';

type Register = 'PLAYERS' | 'INCOME' | 'EXPENSE';
type Source = 'EXCEL' | 'WORD' | 'MANUAL';
type Raw = Record<string, string>;
type Status = 'ok' | 'warning' | 'error';

type Batch = { id: string; label: string; register: Register; source: Source | null; fileName: string | null; rowCount: number; createdAt: string; cancelledAt: string | null; cancelReason: string | null };
type HistorySeason = {
  id: string;
  label: string;
  status: 'HISTORICAL' | 'CLOSED';
  startDate: string;
  endDate: string;
  players: number;
  importedPlayers: number;
  returning: number;
  income: number;
  expenses: number;
  result: number;
  reports: { MORAL: number; FINANCIAL: number; drafts: ('MORAL' | 'FINANCIAL')[] };
  batches: Batch[];
};
type PlayerRow = Result & {
  name: string;
  category: { id: string; code: string; name: string } | null;
  age: number | null;
  player: { id: string; name: string; memberCode: string | null; seasons: string[] } | null;
  candidates: { id: string; name: string; memberCode: string | null; birth: string | null; seasons: string[] }[];
};
type MoneyRow = Result & { category: string; date: string | null; amount: number | null; label: string; player: { id: string; name: string; memberCode: string | null } | null };
type Preview = { total: number; ok: number; warnings: number; errors: number; amount: number; found: number; categories: string[]; rows: (PlayerRow | MoneyRow)[] };

const REGISTER: Record<Register, string> = { PLAYERS: 'Joueurs', INCOME: 'Recettes', EXPENSE: 'Dépenses' };
export const INCOME_LABEL: Record<string, string> = { FEES: 'Cotisation', DONATION: 'Don', RENTAL: 'Location', TOURNAMENT: 'Tournoi', GRANT: 'Subvention', OTHER: 'Autre' };
export const EXPENSE_LABEL: Record<string, string> = {
  SALARY: 'Salaire d’entraîneur',
  UTILITIES: 'Factures (STEG, SONEDE…)',
  EQUIPMENT: 'Matériel',
  MAINTENANCE: 'Entretien',
  TAX: 'Déclarations fiscales',
  SOCIAL: 'CNSS',
  INSURANCE: 'Assurances',
  FEDERATION: 'Fédération',
  TRAVEL: 'Déplacements',
  SERVICES: 'Prestataires',
  OTHER: 'Autre',
};
const choices = (m: Record<string, string>): [string, string][] => [['', 'Selon le libellé'], ...Object.entries(m)];

const COLS: Record<Register, Col<string>[]> = {
  PLAYERS: [
    { key: 'name', label: 'Nom et prénom', w: 190 },
    { key: 'nameAr', label: 'Nom en arabe', w: 160, dir: 'rtl' },
    { key: 'gender', label: 'Genre', w: 92, choices: [['', '—'], ['h', 'Garçon'], ['f', 'Fille']] },
    { key: 'birth', label: 'Naissance', w: 116, placeholder: 'AAAA ou JJ/MM/AAAA' },
    { key: 'category', label: 'Catégorie', w: 170, list: 'history-cats', placeholder: 'selon l’âge' },
    { key: 'phone', label: 'Téléphone', w: 130, mode: 'tel' },
    { key: 'parent', label: 'Parent', w: 130 },
    { key: 'remark', label: 'Remarque', w: 180 },
  ],
  INCOME: [
    { key: 'date', label: 'Date', w: 116, placeholder: 'JJ/MM/AAAA' },
    { key: 'label', label: 'Libellé', w: 200 },
    { key: 'category', label: 'Nature', w: 150, choices: choices(INCOME_LABEL) },
    { key: 'person', label: 'Joueur / payeur', w: 170 },
    { key: 'amount', label: 'Montant (DT)', w: 106, mode: 'decimal' },
    { key: 'reference', label: 'N° reçu', w: 90, mode: 'tel' },
    { key: 'remark', label: 'Remarque', w: 160 },
  ],
  EXPENSE: [
    { key: 'date', label: 'Date', w: 116, placeholder: 'JJ/MM/AAAA' },
    { key: 'label', label: 'Libellé', w: 200 },
    { key: 'category', label: 'Nature', w: 180, choices: choices(EXPENSE_LABEL) },
    { key: 'person', label: 'Bénéficiaire', w: 170, placeholder: 'entraîneur, fournisseur' },
    { key: 'amount', label: 'Montant (DT)', w: 106, mode: 'decimal' },
    { key: 'reference', label: 'N° facture', w: 100 },
    { key: 'remark', label: 'Remarque', w: 160 },
  ],
};
const KEYS: Record<Register, string[]> = {
  PLAYERS: ['name', 'nameAr', 'gender', 'birth', 'category', 'phone', 'parent', 'remark', 'match'],
  INCOME: ['date', 'label', 'category', 'person', 'amount', 'reference', 'remark'],
  EXPENSE: ['date', 'label', 'category', 'person', 'amount', 'reference', 'remark'],
};
const empty = (r: Register): Raw => Object.fromEntries(KEYS[r].map((k) => [k, '']));
const SOURCE_LABEL: Record<Source, string> = { EXCEL: 'Excel', WORD: 'Word', MANUAL: 'Saisie à la main' };

/**
 * Import historique : saisons passées du club (cahiers depuis 2010, fichiers Excel et Word). Trois registres
 * (Joueurs, Recettes, Dépenses dont salaires) ; chaque source donne le même tableau modifiable, analysé par l'API,
 * puis enregistré en un lot (origine IMPORT, R14), annulable avec motif. Bilan des saisons et rapports déposés.
 */
export function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['history'], queryFn: () => api.get<HistorySeason[]>('/history') });
  const seasons = q.data ?? [];
  const selected = seasons.find((s) => s.id === params.get('saison')) ?? null;
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Import historique"
        subtitle="Découvrez les saisons passées du club : joueurs, recettes et dépenses repris des cahiers, d’Excel et de Word, avec leurs rapports."
      />
      <Filters>
        {seasons.length > 0 && (
          <FilterSelect label="Saison" value={selected?.id ?? ''} onChange={(e) => setParams(e.target.value ? { saison: e.target.value } : {})}>
            <option value="">Bilan des saisons</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                Saison {s.label}
                {s.status === 'CLOSED' ? ' (clôturée)' : ''}
              </option>
            ))}
          </FilterSelect>
        )}
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Saison passée
        </Button>
      </Filters>

      <div className="mt-4">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {selected ? <SeasonImport season={selected} onBack={() => setParams({})} /> : <Overview seasons={seasons} onOpen={(id) => setParams({ saison: id })} />}
        </QueryState>
      </div>
      <NewSeasonModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => setParams({ saison: id })} />
    </>
  );
}

/** Bilan des saisons passées : une ligne par saison, du plus récent au plus ancien. */
function Overview({ seasons, onOpen }: { seasons: HistorySeason[]; onOpen: (id: string) => void }) {
  const max = Math.max(1, ...seasons.map((s) => Math.max(s.income, s.expenses)));
  if (!seasons.length) {
    return (
      <EmptyState>
        Aucune saison passée. Créez d’abord la saison (bouton « + Saison passée », ex. 2015-2016), puis importez ses joueurs, ses recettes et ses
        dépenses.
      </EmptyState>
    );
  }
  return (
    <Section title="Bilan des saisons">
      <div className="flex flex-col gap-3">
        {seasons.map((s) => (
          <Card key={s.id}>
            <CardRow>
              <button type="button" className="cursor-pointer text-start text-[16px] font-medium text-fg hover:underline" onClick={() => onOpen(s.id)}>
                Saison {s.label}
              </button>
              <Pills>
                <Pill tone={s.status === 'HISTORICAL' ? 's' : 'b'}>{s.status === 'HISTORICAL' ? 'Historique' : 'Clôturée'}</Pill>
                <Pill tone={s.reports.MORAL || s.reports.drafts.includes('MORAL') ? 'g' : 'r'}>Rapport moral {s.reports.MORAL || s.reports.drafts.includes('MORAL') ? '✓' : 'à déposer'}</Pill>
                <Pill tone={s.reports.FINANCIAL || s.reports.drafts.includes('FINANCIAL') ? 'g' : 'r'}>Rapport financier {s.reports.FINANCIAL || s.reports.drafts.includes('FINANCIAL') ? '✓' : 'à déposer'}</Pill>
              </Pills>
            </CardRow>
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[14px] min-[700px]:grid-cols-4">
              <span>
                <b className="font-semibold tabular-nums">{s.players}</b> joueurs
                {s.returning ? <span className="text-mut"> · {s.returning} déjà venus</span> : null}
              </span>
              <span>
                Recettes <b className="font-semibold tabular-nums">{DT(s.income)}</b>
              </span>
              <span>
                Dépenses <b className="font-semibold tabular-nums">{DT(s.expenses)}</b>
              </span>
              <span>
                Résultat <b className={`font-semibold tabular-nums ${s.result < 0 ? 'text-[#b42318]' : ''}`}>{DT(s.result)}</b>
              </span>
            </div>
            {/* Barres faites main : recettes (vert) et dépenses (rose), à la même échelle pour toutes les saisons. */}
            <div className="mt-2 flex flex-col gap-1" aria-hidden>
              <span className="block h-2 rounded-full bg-[#9fd36b]" style={{ width: `${(s.income / max) * 100}%` }} />
              <span className="block h-2 rounded-full bg-[#fdb3b0]" style={{ width: `${(s.expenses / max) * 100}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Link className="inline-flex items-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg" to={`/admin/rapports?saison=${s.id}`}>
                Rapports
              </Link>
              {s.status === 'HISTORICAL' && (
                <Button variant="primary" onClick={() => onOpen(s.id)}>
                  Importer
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
      <Note>
        Les saisons passées sont verrouillées (R1) : leurs montants ne sont jamais relancés ni modifiés (R7). Un lot importé par erreur s’annule avec
        un motif, puis on le réimporte corrigé. À la clôture de la saison active, ses rapports se préparent dans « Rapports de fin de saison » à
        partir des textes et des rapports déposés de la saison précédente.
      </Note>
    </Section>
  );
}

function NewSeasonModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [start, setStart] = useState('2015');
  const y = Number(start) || 0;
  const label = y ? `${y}-${y + 1}` : '';
  const create = useAction(() => api.post<{ id: string }>('/seasons', { label, startDate: `${y}-09-01`, endDate: `${y + 1}-08-31`, status: 'HISTORICAL' }), {
    invalidate: [['history'], ['seasons']],
    success: `Saison ${label} créée.`,
    onSuccess: (s) => {
      onClose();
      onCreated(s.id);
    },
  });
  return (
    <Modal
      open={open}
      title="Nouvelle saison passée"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" disabled={!y || y < 1990 || y > new Date().getFullYear() || create.isPending} onClick={() => create.mutate()}>
            Créer la saison {label}
          </Button>
        </>
      }
    >
      <FormGrid onSubmit={(e) => e.preventDefault()}>
        <TextField label="Année de début" inputMode="numeric" maxLength={4} value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} />
        <TextField label="Saison" value={label} readOnly />
      </FormGrid>
      <Note>Du 1er septembre au 31 août, statut « Historique » (verrouillée). Les dates se corrigent dans l’écran Saisons si besoin.</Note>
    </Modal>
  );
}

/** Une saison : registres à importer, lots déjà importés, rapports déposés. */
function SeasonImport({ season, onBack }: { season: HistorySeason; onBack: () => void }) {
  const [register, setRegister] = useState<Register>('PLAYERS');
  const [table, setTable] = useState<Raw[]>();
  const [source, setSource] = useState<Source>('MANUAL');
  const [fileName, setFileName] = useState<string>();
  const [preview, setPreview] = useState<Preview>();
  const [checking, setChecking] = useState(false);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [photos, setPhotos] = useState<string[]>([]);
  const [readInfo, setReadInfo] = useState<string>();
  const [toCancel, setToCancel] = useState<Batch>();
  const seq = useRef(0);
  const locked = season.status !== 'HISTORICAL';

  const clear = () => {
    photos.forEach((u) => URL.revokeObjectURL(u));
    setPhotos([]);
    setTable(undefined);
    setPreview(undefined);
    setFileName(undefined);
    setReadInfo(undefined);
    setFilter('all');
  };
  useEffect(() => clear, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Analyse refaite par l'API après chaque modification du tableau (rien n'est enregistré).
  useEffect(() => {
    if (!table) return;
    const id = ++seq.current;
    setChecking(true);
    const t = setTimeout(() => {
      api
        .post<Preview>(`/history/${season.id}/preview/${register}`, { table })
        .then((r) => id === seq.current && setPreview(r))
        .catch(() => undefined)
        .finally(() => id === seq.current && setChecking(false));
    }, 450);
    return () => clearTimeout(t);
  }, [table, register, season.id]);

  const read = useAction((f: File) => api.upload<{ fileName: string; source: Source; table: Raw[]; parts: string[]; unknown: string[] }>(`/history/read/${register}`, f), {
    onSuccess: (r) => {
      clear();
      setSource(r.source);
      setFileName(r.fileName);
      setTable(r.table.map((x) => ({ ...empty(register), ...x })));
      setReadInfo(`Lu : ${r.parts.join(', ')}.${r.unknown.length ? ` Colonnes non reprises : ${r.unknown.join(', ')}.` : ''}`);
    },
  });
  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) read.mutate(f);
  };
  const manual = () => {
    clear();
    setSource('MANUAL');
    setTable(Array.from({ length: 10 }, () => empty(register)));
  };
  // Photo du cahier : affichée à côté du tableau pour recopier les lignes (rien n'est envoyé, rien n'est lu par une IA).
  const pickPhotos = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])].slice(0, 12);
    e.target.value = '';
    if (!files.length) return;
    photos.forEach((u) => URL.revokeObjectURL(u));
    setPhotos(files.map((f) => URL.createObjectURL(f)));
    if (!table) {
      setSource('MANUAL');
      setTable(Array.from({ length: 15 }, () => empty(register)));
    }
  };

  const commit = useAction(
    () =>
      api.post<{ created: number; linked: number; rows: number; skipped: number; amount: number }>(`/history/${season.id}/commit/${register}`, {
        table,
        source,
        fileName: fileName ?? (photos.length ? `Photos du cahier · ${new Date().toLocaleDateString('fr-FR')}` : undefined),
      }),
    {
      invalidate: [['history'], ['players'], ['season-reports']],
      success: (r) =>
        register === 'PLAYERS'
          ? `${r.created} nouveau(x) joueur(s), ${r.linked} retrouvé(s) d’une autre saison.${r.skipped ? ` ${r.skipped} ligne(s) ignorée(s).` : ''}`
          : `${r.rows} ligne(s) enregistrée(s) : ${DT(r.amount)}.${r.skipped ? ` ${r.skipped} ligne(s) ignorée(s).` : ''}`,
      onSuccess: clear,
    },
  );
  const cancel = useAction((reason: string) => api.post(`/history/batches/${toCancel!.id}/cancel`, { reason }), {
    invalidate: [['history'], ['players'], ['season-reports']],
    success: 'Lot annulé.',
    onSuccess: () => setToCancel(undefined),
  });

  const ready = preview ? preview.ok + preview.warnings : 0;
  const rows = (preview?.rows ?? []) as Result[];
  const setRow = (i: number, key: string, value: string) => setTable((t) => t?.map((r, k) => (k === i ? { ...r, [key]: value } : r)));

  const extra = useMemo(() => {
    if (register === 'PLAYERS') {
      return {
        label: 'Même joueur',
        w: 250,
        render: (r: Result | undefined, i: number) => {
          const p = r as PlayerRow | undefined;
          const value = table?.[i]?.match ?? '';
          return (
            <div className="flex flex-col gap-1">
              {p && (p.candidates.length > 0 || value) ? (
                <select aria-label={`Ligne ${i + 2} : même joueur`} className="fld !py-1 text-[13px]" value={value} onChange={(e) => setRow(i, 'match', e.target.value)}>
                  <option value="">{p.player && !value ? `Auto : ${p.player.name}` : 'Choisir…'}</option>
                  <option value="new">Nouveau joueur</option>
                  {p.candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.birth ? ` · ${c.birth.slice(0, 4)}` : ''}
                      {c.seasons.length ? ` · ${c.seasons.join(', ')}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-mut">{p ? 'Nouveau joueur' : ''}</span>
              )}
              {p?.category && (
                <span className="text-[12px] text-mut">
                  {p.category.name}
                  {p.age !== null ? ` · ${p.age} ans` : ''}
                </span>
              )}
            </div>
          );
        },
      };
    }
    return {
      label: 'Reconnu',
      w: 190,
      render: (r: Result | undefined) => {
        const m = r as MoneyRow | undefined;
        if (!m) return null;
        return (
          <>
            <b className="font-medium">{(register === 'INCOME' ? INCOME_LABEL : EXPENSE_LABEL)[m.category] ?? m.category}</b>
            {m.amount ? <span className="block text-mut">{DT(m.amount)}</span> : null}
            {m.player ? <span className="block text-mut">{m.player.name}</span> : null}
          </>
        );
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, table]);

  const batches = season.batches;
  return (
    <>
      <Section title={`Saison ${season.label}`}>
        <Card>
          <CardRow>
            <CardSubtitle>
              Du {fD(season.startDate, { day: 'numeric', month: 'long', year: 'numeric' })} au {fD(season.endDate, { day: 'numeric', month: 'long', year: 'numeric' })}
            </CardSubtitle>
            <Pills>
              <Pill tone="b">{season.players} joueurs</Pill>
              <Pill tone="g">Recettes {DT(season.income)}</Pill>
              <Pill tone="r">Dépenses {DT(season.expenses)}</Pill>
            </Pills>
          </CardRow>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button onClick={onBack}>← Bilan des saisons</Button>
            <Link className="inline-flex items-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg" to={`/admin/rapports?saison=${season.id}`}>
              Rapports de la saison ({season.reports.MORAL + season.reports.FINANCIAL} déposé{season.reports.MORAL + season.reports.FINANCIAL > 1 ? 's' : ''})
            </Link>
          </div>
        </Card>
      </Section>

      {locked ? (
        <Note>
          La saison {season.label} est gérée dans l’application (statut « Clôturée ») : ses joueurs, paiements et dépenses y sont déjà. L’import
          historique se fait dans les saisons « Historique ».
        </Note>
      ) : (
        <Section title="Importer">
          <Filters>
            <Segmented<Register>
              label="Registre"
              options={(['PLAYERS', 'INCOME', 'EXPENSE'] as Register[]).map((r) => ({ value: r, label: REGISTER[r] }))}
              value={register}
              onChange={(r) => {
                clear();
                setRegister(r);
              }}
            />
            <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg focus-within:outline-2 focus-within:outline-pri">
              {read.isPending ? 'Lecture…' : 'Fichier Excel ou Word'}
              <input type="file" accept=".xlsx,.docx" className="sr-only" onChange={pickFile} />
            </label>
            <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg focus-within:outline-2 focus-within:outline-pri">
              Photos du cahier
              <input type="file" accept="image/*" multiple className="sr-only" onChange={pickPhotos} />
            </label>
            <Button onClick={manual}>Saisie à la main</Button>
          </Filters>

          {!table ? (
            <Note>
              {register === 'PLAYERS' ? (
                <>
                  Colonnes reconnues : <b>Nom et prénom</b> (ou <b>الاسم واللقب</b>), nom en arabe, genre, naissance (année seule acceptée), catégorie,
                  téléphone, parent, remarque. Un joueur déjà connu (autre saison) est <b>retrouvé</b> : automatiquement si le nom et la naissance
                  sont identiques, sinon vous confirmez dans la colonne « Même joueur ». Sans naissance ni catégorie : compté en « Loisirs ».
                </>
              ) : register === 'INCOME' ? (
                <>
                  Colonnes reconnues : <b>Date</b>, <b>Libellé</b> (البيان), nature, joueur ou payeur, <b>Montant</b> (المبلغ), n° de reçu. Les
                  recettes sont surtout les cotisations des joueurs (joueur reconnu s’il est importé), puis dons, locations, subventions. Un journal
                  de caisse à deux colonnes (recettes, dépenses) donne ici les seules recettes.
                </>
              ) : (
                <>
                  Colonnes reconnues : <b>Date</b>, <b>Libellé</b>, nature, bénéficiaire, <b>Montant</b>, n° de facture. Toutes les dépenses, salaires
                  des entraîneurs compris (« salaire », « مدرب », « أجر » → Salaire d’entraîneur) ; la nature est déduite du libellé si elle manque.
                </>
              )}{' '}
              Ancien fichier .xls / .doc : enregistrez-le d’abord au format .xlsx / .docx. Cahier papier : « Photos du cahier » affiche la page à côté
              du tableau pour recopier les lignes (aucune lecture automatique).
            </Note>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Pill tone="b">{fileName ?? SOURCE_LABEL[source]}</Pill>
                {preview && (
                  <>
                    <Pill tone="g">{preview.ok} prêtes</Pill>
                    {preview.warnings > 0 && <Pill tone="s">{preview.warnings} à vérifier</Pill>}
                    {preview.errors > 0 && <Pill tone="r">{preview.errors} ignorées</Pill>}
                    {register === 'PLAYERS' ? <Pill tone="b">{preview.found} retrouvés</Pill> : <Pill tone="b">Total {DT(preview.amount)}</Pill>}
                  </>
                )}
                {checking && <Pill tone="s">Analyse…</Pill>}
                <span className="flex-1" />
                <FilterSelect label="Afficher" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | Status)}>
                  <option value="all">Toutes les lignes</option>
                  <option value="warning">À vérifier</option>
                  <option value="error">Ignorées</option>
                  <option value="ok">Prêtes</option>
                </FilterSelect>
              </div>
              {readInfo && <p className="mb-2 text-[13px] text-mut">{readInfo}</p>}
              <div className={photos.length ? 'grid gap-3 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]' : ''}>
                {photos.length > 0 && <PhotoPanel photos={photos} />}
                <div className="min-w-0">
                  <EditableTable<Raw, Result>
                    cols={COLS[register]}
                    stickyKey={register === 'PLAYERS' ? 'name' : 'label'}
                    table={table}
                    results={rows}
                    filter={filter}
                    onChange={setTable}
                    extra={extra}
                    footer={
                      <datalist id="history-cats">
                        {(preview?.categories ?? []).map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    }
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button onClick={() => setTable([...table, ...Array.from({ length: 5 }, () => empty(register))])}>+ 5 lignes</Button>
                <Button onClick={clear}>Abandonner</Button>
                <Button variant="primary" disabled={!ready || checking || commit.isPending} onClick={() => commit.mutate()}>
                  {commit.isPending ? 'Enregistrement…' : `Enregistrer ${ready} ligne${ready > 1 ? 's' : ''} dans ${season.label}`}
                </Button>
              </div>
            </>
          )}
        </Section>
      )}

      <Section title="Lots importés">
        {batches.length ? (
          <div className="flex flex-col gap-2">
            {batches.map((b) => (
              <Card key={b.id} className={b.cancelledAt ? 'opacity-60' : ''}>
                <CardRow>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{b.label}</span>
                  <Pills>
                    <Pill tone="s">{REGISTER[b.register]}</Pill>
                    <Pill tone="b">{b.rowCount} lignes</Pill>
                    <Pill tone="b">{fD(b.createdAt.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}</Pill>
                    {b.cancelledAt && <Pill tone="r">Annulé</Pill>}
                  </Pills>
                  {!b.cancelledAt && !locked && <ActionIcon kind="cancel" label="Annuler ce lot" onClick={() => setToCancel(b)} />}
                </CardRow>
                {b.cancelReason && <CardText keep>Motif : {b.cancelReason}</CardText>}
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState>Rien n’a encore été importé dans cette saison.</EmptyState>
        )}
      </Section>

      <ConfirmModal
        open={Boolean(toCancel)}
        title="Annuler ce lot ?"
        text="Les recettes et dépenses du lot sont retirées des chiffres (gardées dans l’historique), les inscriptions du lot sont retirées et les joueurs créés par ce lot sans autre saison sont archivés. Vous pourrez réimporter le fichier corrigé."
        cta="Annuler le lot"
        withMotif
        pending={cancel.isPending}
        onConfirm={(motif) => cancel.mutate(motif)}
        onClose={() => setToCancel(undefined)}
      />
    </>
  );
}
