import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Card, CardGrid, CardRow, CardText } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { PlanOptions } from '../../lib/payment-config';
import { api } from '../../lib/api';
import { EMPTY_RAW, ImportTable } from '../../features/players/ImportTable';
import type { ImportPreview, ImportRawRow, ImportReport, ImportStatus, PaymentPlan } from '../../lib/types';
import { useAction } from '../../lib/useAction';

/** Rapport d'import en CSV (séparateur « ; », lisible par Excel) : codes attribués et lignes ignorées. */
function downloadReport(report: ImportReport, fileName: string) {
  const cell = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['Ligne', 'N°', 'Joueur', 'Code TCSAY', 'Catégorie', 'Groupe', 'Parents', 'Remarques'].map(cell).join(';'),
    ...report.imported.map((r) => [r.line, r.n, r.name, r.memberCode, r.category, r.group ?? 'Sans groupe', r.parents.join(', '), r.messages.join(' · ')].map(cell).join(';')),
    ...report.skipped.map((r) => [r.line, r.n, r.name, 'NON IMPORTÉ', '', '', '', r.messages.join(' · ')].map(cell).join(';')),
  ];
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rapport-import-${fileName.replace(/\.xlsx$/i, '')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Import des joueurs depuis le fichier Excel du cahier : aperçu ligne par ligne (rien n'est enregistré),
 * puis confirmation. Les lignes en erreur sont ignorées ; un groupe inconnu laisse le joueur sans groupe.
 */
export function PlayersImportPage() {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<ImportPreview>();
  const [report, setReport] = useState<ImportReport>();
  const [filter, setFilter] = useState<'all' | ImportStatus>('all');
  // Tableau modifiable (valeurs du fichier, corrigées à l'écran) ; l'aperçu est refait après chaque modification.
  const [table, setTable] = useState<ImportRawRow[]>();
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);

  const analyze = useAction((f: File) => api.upload<ImportPreview>('/players/import/preview', f), {
    onSuccess: (r) => {
      setTable(r.rows.map((row) => row.raw));
      setReport(undefined);
      setFilter('all');
    },
  });
  useEffect(() => {
    if (!table || !file) return;
    const id = ++seq.current;
    setChecking(true);
    const t = setTimeout(() => {
      api
        .post<ImportPreview>('/players/import/preview-table', { fileName: file.name, rows: table })
        .then((r) => id === seq.current && setPreview(r))
        .catch(() => undefined)
        .finally(() => id === seq.current && setChecking(false));
    }, 500);
    return () => clearTimeout(t);
  }, [table, file]);
  const [plan, setPlan] = useState<PaymentPlan>('FULL');
  const commit = useAction(() => api.post<ImportReport>('/players/import/commit-table', { fileName: file!.name, rows: table, plan }), {
    invalidate: [['players'], ['parents'], ['groups'], ['dashboard'], ['categories']],
    success: (r) => `${r.imported.length} joueur(s) importé(s) avec leur cotisation, ${r.parentsCreated} parent(s) créé(s).`,
    onSuccess: (r) => {
      setReport(r);
      setPreview(undefined);
      setTable(undefined);
    },
  });

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f);
    setPreview(undefined);
    setTable(undefined);
    setReport(undefined);
    analyze.mutate(f);
  };

  const importable = preview ? preview.ok + preview.warnings : 0;

  return (
    <>
      <PageHeader
        title="Importer des joueurs"
        subtitle="Découvrez l’aperçu de votre fichier Excel avant de l’enregistrer."
        action={
          <Link className="inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg" to="/admin/joueurs">
            ← Joueurs
          </Link>
        }
      />

      <Filters>
        <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg focus-within:outline-2 focus-within:outline-pri">
          {file ? 'Choisir un autre fichier' : 'Choisir le fichier (.xlsx)'}
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={pick} />
        </label>
        {file && <Pill tone="b">{file.name}</Pill>}
        {analyze.isPending && <Pill tone="s">Analyse…</Pill>}
      </Filters>

      {!preview && !report && !analyze.isPending && (
        <Note>
          Colonnes reconnues : <b>N°, Genre (H/F), Nom et prénom, Nom en arabe, Date de naissance, Téléphone, Email du joueur, Parent,
          Email du parent, Groupe, Ville, Remarque</b>. L’aperçu s’affiche en tableau modifiable, comme dans Excel. L’aperçu n’enregistre rien. Chaque joueur inscrit reçoit sa cotisation (mode de paiement choisi avant de confirmer, modifiable ensuite dans sa fiche) et un code provisoire « {String(new Date().getFullYear() % 100)}TCSAY001 ».
          Les parents sont créés avec le prénom du cahier, le nom « Exemple » et un email provisoire : aucun email n’est envoyé avant
          que vous saisissiez la vraie adresse.
        </Note>
      )}

      {table && preview && (
        <>
          <Section title="Aperçu modifiable">
            <Pills>
              <Pill tone="b">Saison {preview.season}</Pill>
              <Pill tone="b">{preview.total} ligne(s)</Pill>
              <Pill tone="g">{preview.ok} prête(s)</Pill>
              <Pill tone="s">{preview.warnings} à vérifier</Pill>
              <Pill tone="r">{preview.errors} ignorée(s)</Pill>
              <Pill tone="b">{preview.newParents} parent(s) à créer</Pill>
              <Pill tone="b">{preview.withGroup} avec groupe</Pill>
              {checking && <Pill tone="s">Vérification…</Pill>}
            </Pills>
            <Filters>
              <FilterSelect label="Filtrer par état" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">Toutes les lignes</option>
                <option value="ok">Prêtes</option>
                <option value="warning">À vérifier</option>
                <option value="error">Ignorées</option>
              </FilterSelect>
              <FilterSelect label="Mode de paiement des cotisations" value={plan} onChange={(e) => setPlan(e.target.value as PaymentPlan)}>
                <PlanOptions prefix="Cotisation : " short />
              </FilterSelect>
              <Button onClick={() => setTable([...table, { ...EMPTY_RAW }])}>+ Ajouter une ligne</Button>
              <Button variant="primary" disabled={!importable || commit.isPending || checking} onClick={() => commit.mutate()}>
                {commit.isPending ? 'Enregistrement…' : `Confirmer l’import (${importable})`}
              </Button>
            </Filters>
          </Section>
          <div className="mt-2.5">
            <ImportTable table={table} preview={preview} filter={filter} onChange={setTable} />
          </div>
          <Note>
            Corrigez directement dans le tableau (nom, nom en arabe, naissance, genre, téléphone, emails, parent, groupe…) : l’analyse
            est refaite à chaque modification et <b>rien n’est enregistré</b> avant « Confirmer l’import ». <b>Prêt</b> : importé tel
            quel. <b>À vérifier</b> : importé, à contrôler ensuite. <b>Ignoré</b> : non importé tant que la ligne n’est pas corrigée.
            L’email du parent remplace l’email provisoire (aucun email n’est envoyé à l’import).
            Groupes connus : {preview.groups.join(', ') || '—'}.
          </Note>
        </>
      )}

      {report && (
        <Section title="Import terminé">
          <Pills>
            <Pill tone="g">{report.imported.length} joueur(s) importé(s)</Pill>
            <Pill tone="g">{report.imported.filter((r) => r.membership).length} cotisation(s) créée(s)</Pill>
            {report.withoutFee > 0 && <Pill tone="r">{report.withoutFee} sans tarif (cotisation à créer)</Pill>}
            <Pill tone="b">{report.parentsCreated} parent(s) créé(s)</Pill>
            <Pill tone={report.skipped.length ? 'r' : 'g'}>{report.skipped.length} ignoré(s)</Pill>
          </Pills>
          <Filters>
            <Button onClick={() => downloadReport(report, file?.name ?? 'joueurs')}>Télécharger le rapport (CSV)</Button>
            <Link className="inline-flex items-center justify-center rounded-full bg-pri px-4 py-[9px] text-sm font-medium text-white" to="/admin/joueurs">
              Voir les joueurs
            </Link>
          </Filters>
          <CardGrid list>
            {report.imported.map((r) => (
              <Card key={r.line}>
                <CardRow>
                  <h3>{r.name}</h3>
                  <Pill tone="b">{r.memberCode}</Pill>
                </CardRow>
                <Pills>
                  {r.category && <Pill tone="s">{r.category}</Pill>}
                  {r.group ? <Pill tone="g">{r.group}</Pill> : <Pill tone="r">Sans groupe</Pill>}
                </Pills>
                {r.parents.length > 0 && <CardText>Parent : {r.parents.join(', ')}</CardText>}
              </Card>
            ))}
            {report.skipped.map((r) => (
              <Card key={`skip-${r.line}`}>
                <CardRow>
                  <h3>{r.name || `Ligne ${r.line}`}</h3>
                  <Pill tone="r">Non importé</Pill>
                </CardRow>
                <CardText>
                  Ligne {r.line}
                  {r.n ? ` · n° ${r.n}` : ''} : {r.messages.join(' · ')}
                </CardText>
              </Card>
            ))}
          </CardGrid>
        </Section>
      )}
    </>
  );
}
