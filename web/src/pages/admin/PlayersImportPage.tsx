import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Card, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills, type PillTone } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { ImportPreview, ImportReport, ImportRow, ImportStatus } from '../../lib/types';
import { useAction } from '../../lib/useAction';

const STATUS: Record<ImportStatus, { tone: PillTone; label: string }> = {
  ok: { tone: 'g', label: 'Prêt' },
  warning: { tone: 's', label: 'À vérifier' },
  error: { tone: 'r', label: 'Ignoré' },
};

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

function birth(r: ImportRow) {
  if (!r.birthDate) return 'Naissance inconnue';
  return r.birthYearOnly ? `Né(e) en ${r.birthDate.slice(0, 4)}` : formatDate(r.birthDate);
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

  const analyze = useAction((f: File) => api.upload<ImportPreview>('/players/import/preview', f), {
    onSuccess: (r) => {
      setPreview(r);
      setReport(undefined);
      setFilter('all');
    },
  });
  const commit = useAction(() => api.upload<ImportReport>('/players/import/commit', file!), {
    invalidate: [['players'], ['parents'], ['groups'], ['dashboard'], ['categories']],
    success: (r) => `${r.imported.length} joueur(s) importé(s), ${r.parentsCreated} parent(s) créé(s).`,
    onSuccess: (r) => {
      setReport(r);
      setPreview(undefined);
    },
  });

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f);
    setPreview(undefined);
    setReport(undefined);
    analyze.mutate(f);
  };

  const rows = useMemo(() => (preview?.rows ?? []).filter((r) => filter === 'all' || r.status === filter), [preview, filter]);
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
          Colonnes reconnues : <b>N°, Genre (H/F), Nom et prénom, Nom en arabe, Date de naissance, Téléphone, Parent, Groupe, Ville,
          Remarque</b>. L’aperçu n’enregistre rien. Chaque joueur reçoit un code provisoire « {String(new Date().getFullYear() % 100)}TCSAY001 ».
          Les parents sont créés avec le prénom du cahier, le nom « Exemple » et un email provisoire : aucun email n’est envoyé avant
          que vous saisissiez la vraie adresse.
        </Note>
      )}

      {preview && (
        <>
          <Section title="Aperçu">
            <Pills>
              <Pill tone="b">Saison {preview.season}</Pill>
              <Pill tone="b">{preview.total} ligne(s)</Pill>
              <Pill tone="g">{preview.ok} prête(s)</Pill>
              <Pill tone="s">{preview.warnings} à vérifier</Pill>
              <Pill tone="r">{preview.errors} ignorée(s)</Pill>
              <Pill tone="b">{preview.newParents} parent(s) à créer</Pill>
              <Pill tone="b">{preview.withGroup} avec groupe</Pill>
            </Pills>
            <Filters>
              <FilterSelect label="Filtrer par état" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">Toutes les lignes</option>
                <option value="ok">Prêtes</option>
                <option value="warning">À vérifier</option>
                <option value="error">Ignorées</option>
              </FilterSelect>
              <Button variant="primary" disabled={!importable || commit.isPending} onClick={() => commit.mutate()}>
                {commit.isPending ? 'Enregistrement…' : `Confirmer l’import (${importable})`}
              </Button>
            </Filters>
          </Section>
          <div className="mt-2.5">
            {rows.length ? (
              <CardGrid>
                {rows.map((r) => (
                  <Card key={r.line}>
                    <CardRow>
                      <div className="min-w-0">
                        <h3>{r.name || '—'}</h3>
                        <CardText>
                          Ligne {r.line}
                          {r.n ? ` · n° ${r.n}` : ''}
                          {r.nameAr ? (
                            <>
                              {' · '}
                              <span dir="rtl">{r.nameAr}</span>
                            </>
                          ) : null}
                        </CardText>
                      </div>
                      <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                    </CardRow>
                    <Pills>
                      <Pill tone="b">{birth(r)}</Pill>
                      {r.age !== null && <Pill tone="b">{r.age} ans</Pill>}
                      {r.gender && <Pill tone="s">{r.gender === 'M' ? 'Garçon' : 'Fille'}</Pill>}
                      {r.category && <Pill tone="s">{r.category.name}</Pill>}
                      {r.group ? (
                        <Pill tone="g">{r.group.name}</Pill>
                      ) : (
                        <Pill tone="r">{r.groupLabel ? `Sans groupe (« ${r.groupLabel} »)` : 'Sans groupe'}</Pill>
                      )}
                    </Pills>
                    <CardText>
                      {r.parents.length
                        ? `Parent : ${r.parents.map((p) => `${p.name}${p.existingId ? ' (déjà enregistré)' : ' Exemple'}${p.phone ? ` · ${p.phone}` : ''}`).join(', ')}`
                        : r.phone
                          ? `Téléphone : ${r.phone}`
                          : 'Pas de parent ni de téléphone'}
                    </CardText>
                    {r.messages.length > 0 && (
                      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
                        {r.messages.map((m) => (
                          <li key={m} className={r.status === 'error' ? 'text-fg' : 'text-mut'}>
                            • {m}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucune ligne pour ce filtre.</EmptyState>
            )}
          </div>
          <Note>
            <b>Prêt</b> : importé tel quel. <b>À vérifier</b> : importé, à contrôler ensuite (groupe inconnu, année seule, homonyme…).{' '}
            <b>Ignoré</b> : non importé (corrigez le fichier puis relancez : les joueurs déjà importés sont reconnus).
            Groupes connus : {preview.groups.join(', ') || '—'}.
          </Note>
        </>
      )}

      {report && (
        <Section title="Import terminé">
          <Pills>
            <Pill tone="g">{report.imported.length} joueur(s) importé(s)</Pill>
            <Pill tone="b">{report.parentsCreated} parent(s) créé(s)</Pill>
            <Pill tone={report.skipped.length ? 'r' : 'g'}>{report.skipped.length} ignoré(s)</Pill>
          </Pills>
          <Filters>
            <Button onClick={() => downloadReport(report, file?.name ?? 'joueurs')}>Télécharger le rapport (CSV)</Button>
            <Link className="inline-flex items-center justify-center rounded-full bg-pri px-4 py-[9px] text-sm font-medium text-white" to="/admin/joueurs">
              Voir les joueurs
            </Link>
          </Filters>
          <CardGrid>
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
