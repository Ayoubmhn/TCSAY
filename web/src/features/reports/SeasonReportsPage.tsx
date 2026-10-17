import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardRow, CardSubtitle, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { Segmented } from '../../components/ui/Segmented';
import { api, blobUrl } from '../../lib/api';
import { fD } from '../../lib/format';
import type { Season } from '../seasons/api';
import { useAction } from '../../lib/useAction';
import { ReportDocument, TEXT_FIELDS, textsFor, type ReportKind, type SeasonReports } from './ReportDocument';

const KIND_LABEL: Record<ReportKind, string> = { MORAL: 'Rapport moral', FINANCIAL: 'Rapport financier' };

/**
 * Rapports de fin de saison (assemblée générale) : rapport moral (التقرير الأدبي) et rapport financier (التقرير المالي)
 * préparés en arabe avec les chiffres de la saison, textes du bureau à compléter (repris de la saison précédente),
 * impression A4 / PDF ; archive des anciens rapports déposés (Word, PDF, photo).
 */
export function SeasonReportsPage() {
  const { me } = useAuth();
  const canEdit = Boolean(me?.permissions.includes('seasons.manage'));
  const [params, setParams] = useSearchParams();
  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.get<Season[]>('/seasons') });
  const list = useMemo(() => [...(seasons.data ?? [])].sort((a, b) => b.label.localeCompare(a.label)), [seasons.data]);
  const seasonId = params.get('saison') ?? list.find((s) => s.status === 'ACTIVE')?.id ?? list[0]?.id;
  const [kind, setKind] = useState<ReportKind>('MORAL');
  const q = useQuery({ queryKey: ['season-reports', seasonId], queryFn: () => api.get<SeasonReports>(`/seasons/${seasonId}/reports`), enabled: Boolean(seasonId) });
  const d = q.data;

  // Textes en cours de saisie (repartent des textes enregistrés à chaque changement de saison ou de rapport).
  const [texts, setTexts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (d) setTexts(textsFor(kind, d));
  }, [d, kind]);
  const draft = d?.drafts[kind];
  const dirty = d ? JSON.stringify(texts) !== JSON.stringify(textsFor(kind, d)) || draft?.from !== 'season' : false;

  const save = useAction(() => api.put<{ version: number }>(`/seasons/${seasonId}/reports/drafts/${kind}`, { texts, version: draft?.from === 'season' ? draft.version : undefined }), {
    invalidate: [['season-reports', seasonId ?? '']],
    success: `${KIND_LABEL[kind]} enregistré.`,
  });
  const upload = useAction((f: File) => api.upload(`/seasons/${seasonId}/reports/files`, f, { kind }), {
    invalidate: [['season-reports', seasonId ?? '']],
    success: 'Rapport ajouté à l’archive de la saison.',
  });
  const [toArchive, setToArchive] = useState<SeasonReports['files'][number]>();
  const archive = useAction((reason: string) => api.post(`/seasons/${seasonId}/reports/files/${toArchive!.id}/archive`, { reason }), {
    invalidate: [['season-reports', seasonId ?? '']],
    success: 'Rapport retiré de l’archive.',
    onSuccess: () => setToArchive(undefined),
  });
  const download = async (f: SeasonReports['files'][number], from = seasonId) => {
    const url = await blobUrl(`/seasons/${from}/reports/files/${f.id}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) upload.mutate(f);
  };
  const files = (d?.files ?? []).filter((f) => f.kind === kind);
  const previousFiles = (d?.previousFiles ?? []).filter((f) => f.kind === kind);
  // Texte d'un ancien rapport Word, affiché pour le relire et en reprendre des passages.
  const [reading, setReading] = useState<{ fileName: string; paragraphs: string[] }>();
  const readText = useAction((f: SeasonReports['files'][number]) => api.get<{ fileName: string; paragraphs: string[] }>(`/seasons/${d!.previous!.id}/reports/files/${f.id}/text`), {
    onSuccess: setReading,
  });

  return (
    <>
      <PageHeader title="Rapports de fin de saison" subtitle="Découvrez le rapport moral et le rapport financier de chaque saison, préparés pour l’assemblée générale." />
      <Filters>
        <FilterSelect label="Saison" value={seasonId ?? ''} onChange={(e) => setParams({ saison: e.target.value })}>
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              Saison {s.label}
              {s.status === 'ACTIVE' ? ' (active)' : ''}
            </option>
          ))}
        </FilterSelect>
        <Segmented<ReportKind>
          label="Rapport"
          options={[
            { value: 'MORAL', label: 'Rapport moral · التقرير الأدبي' },
            { value: 'FINANCIAL', label: 'Rapport financier · التقرير المالي' },
          ]}
          value={kind}
          onChange={setKind}
        />
      </Filters>

      <div className="mt-4">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {d && (
            <>
              <Section title={`Anciens rapports · ${KIND_LABEL[kind].toLowerCase()} ${d.season.label}`}>
                <Card>
                  {files.length ? (
                    <ul className="m-0 list-none p-0">
                      {files.map((f) => (
                        <li key={f.id} className="flex items-center gap-3 border-t-[1.5px] border-line py-2.5 first:border-t-0">
                          <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
                          <Pill tone="b">{fD(f.createdAt.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}</Pill>
                          <Pill tone="s">{Math.max(1, Math.round(f.size / 1024))} Ko</Pill>
                          <Button onClick={() => void download(f)}>Télécharger</Button>
                          {canEdit && <ActionIcon kind="archive" label="Retirer de l’archive" onClick={() => setToArchive(f)} />}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState>Aucun rapport déposé pour cette saison.</EmptyState>
                  )}
                  {canEdit && (
                    <div className="mt-3 flex justify-end">
                      <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg focus-within:outline-2 focus-within:outline-pri">
                        {upload.isPending ? 'Envoi…' : '+ Déposer un rapport (Word, PDF ou photo)'}
                        <input type="file" accept=".pdf,.doc,.docx,image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} />
                      </label>
                    </div>
                  )}
                </Card>
              </Section>

              {d.previous && (
                <Section title={`Rapport de la saison précédente · ${d.previous.label}`}>
                  <Card>
                    {previousFiles.length ? (
                      <ul className="m-0 list-none p-0">
                        {previousFiles.map((f) => (
                          <li key={f.id} className="flex flex-wrap items-center gap-3 border-t-[1.5px] border-line py-2.5 first:border-t-0">
                            <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
                            {f.mimeType.includes('wordprocessingml') && (
                              <Button disabled={readText.isPending} onClick={() => readText.mutate(f)}>
                                Lire le texte
                              </Button>
                            )}
                            <Button onClick={() => void download(f, d.previous!.id)}>Télécharger</Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState>
                        Aucun {KIND_LABEL[kind].toLowerCase()} déposé pour {d.previous.label}. Déposez les anciens rapports dans leur saison (ou depuis
                        « Import historique ») : ils servent de modèle pour rédiger celui-ci.
                      </EmptyState>
                    )}
                  </Card>
                </Section>
              )}

              <Section title="Textes du bureau">
                <Card>
                  <CardRow>
                    <CardSubtitle>Les chiffres viennent de l’application ; ces textes sont rédigés par le bureau, en arabe.</CardSubtitle>
                    {draft?.from === 'previous' && <Pill tone="s">Repris de la saison {d.previous?.label} : à relire</Pill>}
                    {draft?.from === 'default' && <Pill tone="s">Texte proposé : à compléter</Pill>}
                    {draft?.from === 'season' && draft.updatedAt && <Pill tone="g">Enregistré le {fD(draft.updatedAt.slice(0, 10), { day: 'numeric', month: 'short' })}</Pill>}
                  </CardRow>
                  <div className="mt-3 grid gap-3 min-[900px]:grid-cols-2">
                    {TEXT_FIELDS[kind].map((f) => (
                      <label key={f.key} className="flex flex-col gap-1">
                        <span className="text-[12px] text-mut">
                          {f.hint} · <span dir="rtl">{f.title}</span>
                        </span>
                        <textarea
                          dir="rtl"
                          lang="ar"
                          rows={4}
                          disabled={!canEdit}
                          className="fld resize-y text-[15px] leading-relaxed text-fg"
                          value={texts[f.key] ?? ''}
                          onChange={(e) => setTexts({ ...texts, [f.key]: e.target.value })}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <a
                      className="inline-flex items-center justify-center rounded-full bg-btn px-4 py-[9px] text-sm font-medium text-fg"
                      href={`/impression/rapport/${d.season.id}/${kind}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Imprimer / PDF
                    </a>
                    {canEdit && (
                      <Button variant="primary" disabled={save.isPending || !dirty} onClick={() => save.mutate()}>
                        {save.isPending ? 'Enregistrement…' : 'Enregistrer les textes'}
                      </Button>
                    )}
                  </div>
                </Card>
              </Section>

              <Section title="Aperçu">
                <div className="overflow-x-auto rounded-[24px] border-[1.5px] border-line bg-[#e9e9ee] p-4">
                  <div className="mx-auto w-max shadow-none">
                    <ReportDocument data={d} kind={kind} texts={texts} />
                  </div>
                </div>
                <Note>
                  Les chiffres sont calculés pour la saison {d.season.label} (inscriptions, paiements, réservations, dépenses payées, salaires versés).
                  Avant l’impression, enregistrez les textes : la page imprimée reprend les textes enregistrés. Les saisons anciennes
                  (joueurs, recettes, dépenses) s’importent dans « Import historique » : leurs chiffres servent de comparaison.
                </Note>
              </Section>
            </>
          )}
        </QueryState>
      </div>

      <Modal open={Boolean(reading)} title={reading?.fileName ?? ''} size="lg" onClose={() => setReading(undefined)} footer={<Button onClick={() => setReading(undefined)}>Fermer</Button>}>
        <div dir="auto" className="flex max-h-[60vh] flex-col gap-2 overflow-auto text-[15px] leading-relaxed">
          {reading?.paragraphs.length ? reading.paragraphs.map((p, i) => <p key={i} dir="auto" className="m-0">{p}</p>) : <EmptyState>Document sans texte.</EmptyState>}
        </div>
        <Note>Sélectionnez un passage pour le copier dans les textes du bureau.</Note>
      </Modal>

      <ConfirmModal
        open={Boolean(toArchive)}
        title="Retirer ce rapport de l’archive ?"
        text="Le fichier est gardé dans l’historique (R8) mais n’apparaît plus dans la liste."
        cta="Retirer"
        withMotif
        pending={archive.isPending}
        onConfirm={(motif) => archive.mutate(motif)}
        onClose={() => setToArchive(undefined)}
      />
    </>
  );
}

/** Page d'impression A4 (rapport en arabe, textes enregistrés) : « Imprimer » ou « Enregistrer au format PDF » du navigateur. */
export function ReportPrintPage({ seasonId, kind }: { seasonId: string; kind: ReportKind }) {
  const q = useQuery({ queryKey: ['season-reports', seasonId], queryFn: () => api.get<SeasonReports>(`/seasons/${seasonId}/reports`) });
  const d = q.data;
  return (
    <div className="min-h-screen bg-[#e9e9ee] py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex w-[210mm] max-w-full items-center justify-between gap-2 px-2">
        <span className="text-[14px] text-[#333]">{d ? `${KIND_LABEL[kind]} · saison ${d.season.label}` : 'Chargement…'}</span>
        <Button variant="primary" onClick={() => window.print()}>
          Imprimer / Enregistrer en PDF
        </Button>
      </div>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {d && (
          <div className="print-area">
            <ReportDocument data={d} kind={kind} texts={textsFor(kind, d)} />
          </div>
        )}
      </QueryState>
    </div>
  );
}

/** Route /impression/rapport/:seasonId/:kind. */
export function ReportPrintRoute() {
  const { seasonId = '', kind = 'MORAL' } = useParams();
  return <ReportPrintPage seasonId={seasonId} kind={kind === 'FINANCIAL' ? 'FINANCIAL' : 'MORAL'} />;
}
