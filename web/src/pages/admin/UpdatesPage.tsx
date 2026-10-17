import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills, type PillTone } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { Segmented } from '../../components/ui/Segmented';
import { PlanOptions } from '../../lib/payment-config';
import { api } from '../../lib/api';
import { DT, formatDate } from '../../lib/format';
import { AiPhotoReader, PhotoPanel, type AiPages } from '../../features/ai/AiPhotoReader';
import { EMPTY_PAYMENT, PaymentTable, type Doubts } from '../../features/players/ImportTable';
import type { GroupUpdatePreview, PaymentPlan, PaymentRawRow, PaymentUpdatePreview } from '../../lib/types';
import { useAction } from '../../lib/useAction';

type Mode = 'groups' | 'payments';
type Status = 'ok' | 'warning' | 'error';
const STATUS: Record<Status, { tone: PillTone; label: string }> = {
  ok: { tone: 'g', label: 'Prêt' },
  warning: { tone: 's', label: 'À vérifier' },
  error: { tone: 'r', label: 'Ignoré' },
};

function Messages({ items, status }: { items: string[]; status: Status }) {
  if (!items.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
      {items.map((m) => (
        <li key={m} className={status === 'error' ? 'text-fg' : 'text-mut'}>
          • {m}
        </li>
      ))}
    </ul>
  );
}

/**
 * Mises à jour par fichier Excel, sur les joueurs déjà enregistrés : affectation aux groupes (listes de convocation,
 * noms corrigés d'après la liste) et paiements déjà faits (cahier : montant, payé, n° de reçu). Aperçu puis confirmation.
 */
export function UpdatesPage() {
  const { me } = useAuth();
  const canGroups = Boolean(me?.permissions.includes('groups.manage'));
  const canPayments = Boolean(me?.permissions.includes('payments.collect'));
  const [mode, setMode] = useState<Mode>(canGroups ? 'groups' : 'payments');
  const [file, setFile] = useState<File>();
  const [groups, setGroups] = useState<GroupUpdatePreview>();
  const [payments, setPayments] = useState<PaymentUpdatePreview>();
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [correctNames, setCorrectNames] = useState(true);
  const [plan, setPlan] = useState<PaymentPlan>('FULL');
  const [done, setDone] = useState<string>();
  // Paiements lus sur des photos du cahier par l'IA : tableau modifiable, photos gardées sur l'appareil, cases douteuses.
  const [table, setTable] = useState<PaymentRawRow[]>();
  const [photos, setPhotos] = useState<string[]>([]);
  const [doubts, setDoubts] = useState<Doubts>(new Map());
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);
  const tableName = `Photos du cahier des paiements (IA) · ${new Date().toLocaleDateString('fr-FR')}`;

  const clearPhotos = () => {
    photos.forEach((u) => URL.revokeObjectURL(u));
    setPhotos([]);
    setDoubts(new Map());
    setFocusRow(null);
    setTable(undefined);
  };
  const reset = () => {
    clearPhotos();
    setFile(undefined);
    setGroups(undefined);
    setPayments(undefined);
    setDone(undefined);
    setFilter('all');
  };
  const analyze = useAction(
    (f: File) =>
      mode === 'groups'
        ? api.upload<GroupUpdatePreview>('/imports/groups/preview', f).then((r) => setGroups(r))
        : api.upload<PaymentUpdatePreview>('/imports/payments/preview', f).then((r) => setPayments(r)),
    {},
  );
  // Tableau corrigé à l'écran : analyse refaite après chaque modification (rien n'est enregistré).
  useEffect(() => {
    if (!table) return;
    const id = ++seq.current;
    setChecking(true);
    const t = setTimeout(() => {
      api
        .post<PaymentUpdatePreview>('/imports/payments/preview-table', { fileName: tableName, rows: table })
        .then((r) => id === seq.current && setPayments(r))
        .catch(() => undefined)
        .finally(() => id === seq.current && setChecking(false));
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);
  const fromPhotos = ({ result, photos: urls }: AiPages) => {
    clearPhotos();
    setFile(undefined);
    setGroups(undefined);
    setPayments(undefined);
    setDone(undefined);
    setFilter('all');
    setPhotos(urls);
    setTable(result.rows.map((r) => ({ ...EMPTY_PAYMENT, ...r }) as PaymentRawRow));
    const d: Doubts = new Map();
    for (const x of result.doubts) d.set(x.row, { ...d.get(x.row), [x.field]: x.reason });
    setDoubts(d);
  };

  const commit = useAction(
    () =>
      table
        ? api
            .post<{ imported: unknown[]; total: number; failed: { name: string; messages: string[] }[] }>('/imports/payments/commit-table', { fileName: tableName, rows: table, plan })
            .then(
              (r) =>
                `${r.imported.length} paiement(s) enregistré(s) (${DT(r.total)}).${r.failed.length ? ` Échec : ${r.failed.map((f) => `${f.name} (${f.messages.join(', ')})`).join(' ; ')}` : ''}`,
            )
        : mode === 'groups'
        ? api
            .upload<{ moved: number; renamed: number }>('/imports/groups/commit', file!, { correctNames: String(correctNames) })
            .then((r) => `${r.moved} affectation(s), ${r.renamed} nom(s) corrigé(s).`)
        : api
            .upload<{ imported: unknown[]; total: number; failed: { name: string; messages: string[] }[] }>('/imports/payments/commit', file!, { plan })
            .then(
              (r) =>
                `${r.imported.length} paiement(s) enregistré(s) (${DT(r.total)}).${r.failed.length ? ` Échec : ${r.failed.map((f) => `${f.name} (${f.messages.join(', ')})`).join(' ; ')}` : ''}`,
            ),
    {
      invalidate: [['groups'], ['players'], ['installments'], ['receipts'], ['memberships-missing'], ['dashboard']],
      success: (msg) => msg,
      onSuccess: (msg) => {
        setDone(msg);
        setGroups(undefined);
        setPayments(undefined);
        clearPhotos();
      },
    },
  );

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    clearPhotos();
    setFile(f);
    setGroups(undefined);
    setPayments(undefined);
    setDone(undefined);
    analyze.mutate(f);
  };

  const preview = mode === 'groups' ? groups : payments;
  const keep = <T extends { status: Status }>(rows: T[]) => rows.filter((r) => filter === 'all' || r.status === filter);
  const applicable = preview ? preview.ok + preview.warnings : 0;

  return (
    <>
      <PageHeader title="Mises à jour par fichier" subtitle="Découvrez l’aperçu de vos listes Excel avant de les appliquer aux joueurs enregistrés." />
      <Filters>
        <Segmented<Mode>
          label="Type de mise à jour"
          options={[
            ...(canGroups ? [{ value: 'groups' as Mode, label: 'Affectation aux groupes' }] : []),
            ...(canPayments ? [{ value: 'payments' as Mode, label: 'Paiements du cahier' }] : []),
          ]}
          value={mode}
          onChange={(m) => {
            setMode(m);
            reset();
          }}
        />
        <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg focus-within:outline-2 focus-within:outline-pri">
          {file ? 'Choisir un autre fichier' : 'Choisir le fichier (.xlsx)'}
          <input type="file" accept=".xlsx" className="sr-only" onChange={pick} />
        </label>
        {file && <Pill tone="b">{file.name}</Pill>}
        {analyze.isPending && <Pill tone="s">Analyse…</Pill>}
      </Filters>

      {mode === 'payments' && !table && <AiPhotoReader kind="payments" onRead={fromPhotos} />}

      {!preview && !done && (
        <Note>
          {mode === 'groups' ? (
            <>
              Colonnes : <b>Groupe, Joueur</b>. Le joueur est reconnu malgré les fautes, l’ordre nom / prénom ou les majuscules ; son nom est
              corrigé d’après la liste (le mot en MAJUSCULES = nom de famille). Le nom du groupe doit être exactement celui de l’écran Groupes.
              Un joueur déjà dans un autre groupe y est déplacé.
            </>
          ) : (
            <>
              Colonnes : <b>Joueur</b> et / ou <b>Nom en arabe</b>, <b>Montant</b> (dû après réduction), <b>Payé</b>, <b>Mode</b>, <b>N° reçu</b>,
              Date. Un montant inférieur au tarif enregistre la réduction ; chaque ligne crée le paiement et le reçu du carnet. Les n° de reçu
              déjà enregistrés sont ignorés (pas de doublon).
            </>
          )}
        </Note>
      )}
      {done && <Note>{done}</Note>}

      {preview && (
        <>
          <Section title="Aperçu">
            <Pills>
              <Pill tone="b">Saison {preview.season}</Pill>
              <Pill tone="b">{preview.total} ligne(s)</Pill>
              <Pill tone="g">{preview.ok} prête(s)</Pill>
              <Pill tone="s">{preview.warnings} à vérifier</Pill>
              <Pill tone="r">{preview.errors} ignorée(s)</Pill>
              {groups && <Pill tone="b">{groups.moves} affectation(s)</Pill>}
              {groups && <Pill tone="s">{groups.corrections} nom(s) à corriger</Pill>}
              {payments && <Pill tone="g">{DT(payments.amount)} à enregistrer</Pill>}
              {table && checking && <Pill tone="s">Vérification…</Pill>}
              {doubts.size > 0 && <Pill tone="s">✦ {[...doubts.values()].reduce((t, d) => t + Object.keys(d).length, 0)} case(s) douteuse(s) lue(s) par l’IA</Pill>}
            </Pills>
            <Filters>
              <FilterSelect label="Filtrer par état" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">Toutes les lignes</option>
                <option value="ok">Prêtes</option>
                <option value="warning">À vérifier</option>
                <option value="error">Ignorées</option>
              </FilterSelect>
              {groups && (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-fld px-4 py-[9px] text-sm text-fg">
                  <input type="checkbox" checked={correctNames} onChange={(e) => setCorrectNames(e.target.checked)} className="h-4 w-4 accent-pri" />
                  Corriger les noms d’après la liste
                </label>
              )}
              {payments && (
                <FilterSelect label="Mode de paiement des cotisations à créer" value={plan} onChange={(e) => setPlan(e.target.value as PaymentPlan)}>
                  <PlanOptions prefix="Cotisation à créer : " short />
                </FilterSelect>
              )}
              {table && <Button onClick={() => setTable([...table, { ...EMPTY_PAYMENT }])}>+ Ajouter une ligne</Button>}
              {table && <Button onClick={reset}>Abandonner</Button>}
              <Button variant="primary" disabled={!applicable || commit.isPending || checking} onClick={() => commit.mutate()}>
                {commit.isPending ? 'Enregistrement…' : `Appliquer (${applicable})`}
              </Button>
            </Filters>
          </Section>
          {table && (
            <div className={`mt-2.5 ${photos.length ? 'grid items-start gap-3 min-[1100px]:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]' : ''}`}>
              <PhotoPanel photos={photos} />
              <div className="min-w-0">
                <PaymentTable table={table} preview={payments} filter={filter} onChange={setTable} doubts={doubts} onDoubts={setDoubts} highlight={focusRow} onFocusRow={setFocusRow} />
              </div>
            </div>
          )}
          <div className={`mt-2.5 ${table ? 'hidden' : ''}`}>
            <CardGrid list>
              {groups &&
                keep(groups.rows).map((r) => (
                  <Card key={r.line}>
                    <CardRow>
                      <div className="min-w-0">
                        <h3>{r.player?.name ?? r.name}</h3>
                        <CardText>
                          Ligne {r.line} · liste : « {r.name} »{r.player?.memberCode ? ` · ${r.player.memberCode}` : ''}
                        </CardText>
                      </div>
                      <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                    </CardRow>
                    <Pills>
                      {r.group ? <Pill tone="g">{r.group.name}</Pill> : <Pill tone="r">{r.groupLabel ?? 'Groupe ?'}</Pill>}
                      {r.action === 'move' && <Pill tone="s">Déplacé depuis {r.from}</Pill>}
                      {r.correction && <Pill tone="b" className="whitespace-normal">Nom : {r.correction.from} → {r.correction.to}</Pill>}
                    </Pills>
                    <Messages items={r.messages} status={r.status} />
                  </Card>
                ))}
              {payments &&
                keep(payments.rows).map((r) => (
                  <Card key={r.line}>
                    <CardRow>
                      <div className="min-w-0">
                        <h3>{r.player?.name ?? r.name}</h3>
                        <CardText>
                          Ligne {r.line}
                          {r.nameAr ? (
                            <>
                              {' · '}
                              <span dir="rtl">{r.nameAr}</span>
                            </>
                          ) : null}
                          {r.player?.memberCode ? ` · ${r.player.memberCode}` : ''}
                        </CardText>
                      </div>
                      <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                    </CardRow>
                    <Pills>
                      {r.paid !== null && <Pill tone="g">Payé {DT(r.paid)}</Pill>}
                      {r.due !== null && <Pill tone="b">Dû {DT(r.due)}</Pill>}
                      {r.base !== null && r.due !== null && r.due < r.base && <Pill tone="s">Réduction {DT(r.base - r.due)}</Pill>}
                      {r.receipt && <Pill tone="b">Reçu n° {String(r.receipt).padStart(7, '0')}</Pill>}
                      <Pill tone="s">{r.method === 'CHEQUE' ? 'Chèque' : 'Espèces'}</Pill>
                      <Pill tone="b">{formatDate(r.date)}</Pill>
                    </Pills>
                    <Messages items={r.messages} status={r.status} />
                  </Card>
                ))}
            </CardGrid>
            {preview.total === 0 && <EmptyState>Aucune ligne dans ce fichier.</EmptyState>}
          </div>
          {groups && (
            <Note>
              Groupes de la saison : {groups.groups.join(', ')}. Un groupe absent de cette liste est à créer dans l’écran Groupes (ou à
              renommer dans le fichier), puis relancez.
            </Note>
          )}
        </>
      )}
    </>
  );
}
