import { useQuery } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { FormGrid, SelectField, TextArea, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api, blobUrl } from '../../lib/api';
import { DT, fD } from '../../lib/format';
import { useAction } from '../../lib/useAction';
import { ProjectForm, SpentBar } from './BudgetPage';
import { PRIORITY, STATUS_TONE, type ProjectDetail, type ProjectList, type ProjectStatus, type Quote } from './types';

const NEXT: Partial<Record<ProjectStatus, { to: ProjectStatus; label: string; reason?: boolean }[]>> = {
  IDEA: [{ to: 'CANCELLED', label: 'Abandonner', reason: true }],
  QUOTES: [{ to: 'CANCELLED', label: 'Abandonner', reason: true }],
  APPROVED: [
    { to: 'IN_PROGRESS', label: 'Démarrer les travaux' },
    { to: 'CANCELLED', label: 'Abandonner', reason: true },
  ],
  IN_PROGRESS: [
    { to: 'DONE', label: 'Marquer terminé' },
    { to: 'CANCELLED', label: 'Abandonner', reason: true },
  ],
  DONE: [{ to: 'IN_PROGRESS', label: 'Rouvrir', reason: true }],
  CANCELLED: [{ to: 'IDEA', label: 'Reprendre le projet', reason: true }],
};

/** Fiche d'un projet : devis comparés côte à côte, décision du bureau (motif), avancement, dépenses rattachées. */
export function ProjectPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const canEdit = Boolean(me?.permissions.includes('budget.manage'));
  const q = useQuery({ queryKey: ['project', id], queryFn: () => api.get<ProjectDetail>(`/projects/${id}`) });
  const list = useQuery({ queryKey: ['projects', 'active'], queryFn: () => api.get<ProjectList>('/projects?state=active') });
  const p = q.data;
  const inv = { invalidate: [['project', id], ['projects'], ['budget'], ['forecast'], ['expenses']] as string[][] };

  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [choosing, setChoosing] = useState<Quote>();
  const [discard, setDiscard] = useState<Quote>();
  const [move, setMove] = useState<{ to: ProjectStatus; label: string; reason?: boolean }>();
  const [archiving, setArchiving] = useState(false);
  const [linkId, setLinkId] = useState('');

  const choose = useAction((reason: string) => api.post(`/projects/${id}/choose`, { quoteId: choosing!.id, reason, version: p!.version }), {
    ...inv,
    success: 'Décision enregistrée : projet validé.',
    onSuccess: () => setChoosing(undefined),
  });
  const discardQ = useAction((reason: string) => api.post(`/projects/${id}/quotes/${discard!.id}/archive`, { reason }), { ...inv, success: 'Devis écarté.', onSuccess: () => setDiscard(undefined) });
  const status = useAction((reason?: string) => api.post(`/projects/${id}/status`, { status: move!.to, reason, version: p!.version }), { ...inv, success: 'Projet mis à jour.', onSuccess: () => setMove(undefined) });
  const link = useAction(() => api.post(`/projects/${id}/expenses`, { expenseId: linkId }), { ...inv, success: 'Dépense rattachée.', onSuccess: () => setLinkId('') });
  const unlink = useAction((eid: string) => api.post(`/projects/${id}/expenses/${eid}/unlink`, {}), { ...inv, success: 'Dépense détachée.' });
  const archive = useAction((reason: string) => api.post(`/projects/${id}/archive`, { reason }), { ...inv, success: 'Projet archivé.', onSuccess: () => navigate('/admin/budget') });
  const restore = useAction(() => api.post(`/projects/${id}/restore`, {}), { ...inv, success: 'Projet restauré.' });
  const openFile = async (quote: Quote) => {
    const url = await blobUrl(`/projects/${id}/quotes/${quote.id}/file`);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const quotes = p?.quotes.filter((x) => !x.archived) ?? [];
  const writable = canEdit && p && !p.archivedAt;
  return (
    <>
      <PageHeader title={p?.title ?? 'Projet'} subtitle="Découvrez les devis reçus, la décision du bureau et ce qui a déjà été payé." />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {p && (
          <>
            <Card>
              <CardRow>
                <Pills>
                  <Pill tone={STATUS_TONE[p.status]}>{p.statusLabel}</Pill>
                  <Pill tone="s">{p.categoryLabel}</Pill>
                  <Pill tone={p.priority === 1 ? 'r' : 'b'}>{PRIORITY[p.priority]}</Pill>
                  {p.targetDate && <Pill tone="b">Souhaité : {fD(p.targetDate, { day: 'numeric', month: 'long', year: 'numeric' })}</Pill>}
                  {p.seasonLabel && <Pill tone="b">Saison {p.seasonLabel}</Pill>}
                  {p.archivedAt && <Pill tone="r">Archivé</Pill>}
                </Pills>
              </CardRow>
              {p.description && <p className="my-2 whitespace-pre-line text-[14.5px]">{p.description}</p>}
              <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
                {p.estimatedAmount !== null && <span>Estimation : <b className="font-semibold">{DT(p.estimatedAmount)}</b></span>}
                {p.responsible && <span>Responsable : <b className="font-semibold">{p.responsible}</b></span>}
              </div>
              {p.chosenQuote && (
                <div className="mt-3 rounded-[18px] bg-paid p-3 text-[14px]">
                  <b className="font-semibold">Décision du bureau</b> : {p.chosenQuote.supplier} pour {DT(p.chosenQuote.amount)}
                  {p.decidedAt ? ` (${fD(p.decidedAt.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })})` : ''}
                  {p.decisionReason && <span className="block text-mut">Motif : {p.decisionReason}</span>}
                </div>
              )}
              {['APPROVED', 'IN_PROGRESS', 'DONE'].includes(p.status) && <SpentBar spent={p.spent} budget={p.budget} />}
              {p.archiveReason && <CardText keep>Archivé : {p.archiveReason}</CardText>}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button onClick={() => navigate('/admin/budget')}>← Projets</Button>
                {writable && (
                  <>
                    <Button onClick={() => setEditing(true)}>Modifier</Button>
                    {(NEXT[p.status] ?? []).map((n) => (
                      <Button key={n.to} variant={n.to === 'CANCELLED' ? 'danger' : 'secondary'} onClick={() => setMove(n)}>
                        {n.label}
                      </Button>
                    ))}
                    <ActionIcon kind="archive" label="Archiver le projet" onClick={() => setArchiving(true)} />
                  </>
                )}
                {canEdit && p.archivedAt && (
                  <Button variant="primary" onClick={() => restore.mutate()}>
                    Restaurer
                  </Button>
                )}
              </div>
            </Card>

            <Section title={`Devis (${quotes.length})`}>
              {quotes.length ? (
                <div className="grid grid-cols-1 gap-3 min-[700px]:grid-cols-2 min-[1100px]:grid-cols-3">
                  {quotes.map((x) => (
                    <Card key={x.id} className={x.chosen ? 'outline-2 -outline-offset-2 outline-pri' : ''}>
                      <CardRow>
                        <span className="min-w-0 flex-1 truncate text-[16px] font-medium">{x.supplier}</span>
                        {x.chosen && <Pill tone="g">Choisi</Pill>}
                      </CardRow>
                      <span className="text-[26px] font-semibold tabular-nums">{DT(x.amount)}</span>
                      <Pills>
                        {x.cheapest && <Pill tone="g">Le moins cher</Pill>}
                        {!x.cheapest && x.gap ? <Pill tone="s">+ {DT(x.gap)}</Pill> : null}
                        {x.fastest && <Pill tone="b">Le plus rapide</Pill>}
                        {x.delayDays !== null && <Pill tone="b">{x.delayDays} jours</Pill>}
                        {x.validUntil && <Pill tone={x.expired ? 'r' : 'b'}>{x.expired ? 'Expiré le' : 'Valable au'} {fD(x.validUntil, { day: 'numeric', month: 'short', year: 'numeric' })}</Pill>}
                      </Pills>
                      {x.note && <CardText keep>{x.note}</CardText>}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {x.fileName && <Button onClick={() => void openFile(x)}>Voir le devis</Button>}
                        {writable && !x.chosen && !['DONE', 'CANCELLED'].includes(p.status) && (
                          <>
                            <Button variant="primary" onClick={() => setChoosing(x)}>
                              Choisir ce devis
                            </Button>
                            <ActionIcon kind="remove" label="Écarter ce devis" onClick={() => setDiscard(x)} />
                          </>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <EmptyState>Aucun devis. Demandez au moins deux ou trois devis pour pouvoir comparer.</EmptyState>
              )}
              {writable && !['DONE', 'CANCELLED'].includes(p.status) && (
                <div className="mt-3 flex justify-end">
                  <Button variant="primary" onClick={() => setAdding(true)}>
                    + Ajouter un devis
                  </Button>
                </div>
              )}
            </Section>

            <Section title="Dépenses rattachées">
              <Card>
                {p.expenses.length ? (
                  <ul className="m-0 list-none p-0">
                    {p.expenses.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-3 border-t-[1.5px] border-line py-2 first:border-t-0">
                        <span className="min-w-0 basis-full truncate min-[600px]:basis-auto min-[600px]:flex-1">
                          {e.label}
                          {e.supplier && <span className="text-mut"> · {e.supplier}</span>}
                        </span>
                        <Pill tone="b">{fD(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</Pill>
                        <Pill tone={e.paidAt ? 'g' : 'r'}>{e.paidAt ? 'Payée' : 'À payer'}</Pill>
                        <b className="w-[110px] text-end font-semibold tabular-nums">{DT(e.amount)}</b>
                        {writable && <ActionIcon kind="remove" label="Détacher du projet" onClick={() => unlink.mutate(e.id)} />}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState>Aucune dépense rattachée. Les factures se saisissent dans Caisse › Dépenses, puis se rattachent ici.</EmptyState>
                )}
                {writable && p.candidates.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="min-w-[260px] flex-1">
                      <SelectField label="Rattacher une dépense" value={linkId} onChange={(e) => setLinkId(e.target.value)}>
                        <option value="">Choisir une dépense…</option>
                        {p.candidates.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.date} · {e.label} · {DT(e.amount)}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                    <Button variant="primary" disabled={!linkId || link.isPending} onClick={() => link.mutate()}>
                      Rattacher
                    </Button>
                  </div>
                )}
              </Card>
              <Note>
                Le choix d’un devis est une décision du bureau : le motif (réunion, vote, garantie…) est obligatoire et reste dans l’historique des
                actions. Un devis écarté est gardé, il n’apparaît plus dans la comparaison.
              </Note>
            </Section>

            {list.data && <ProjectForm open={editing} list={list.data} project={p} onClose={() => setEditing(false)} />}
            <QuoteForm open={adding} projectId={id} onClose={() => setAdding(false)} />
            <ConfirmModal
              open={Boolean(choosing)}
              title={`Choisir le devis de ${choosing?.supplier ?? ''} ?`}
              text={`Le projet est validé pour ${choosing ? DT(choosing.amount) : ''} et entre dans le budget et la trésorerie prévue. Indiquez la décision du bureau.`}
              cta="Valider le projet"
              withMotif
              pending={choose.isPending}
              onConfirm={(m) => choose.mutate(m)}
              onClose={() => setChoosing(undefined)}
            />
            <ConfirmModal
              open={Boolean(discard)}
              title="Écarter ce devis ?"
              text="Le devis reste dans l’historique mais n’est plus comparé."
              cta="Écarter"
              withMotif
              pending={discardQ.isPending}
              onConfirm={(m) => discardQ.mutate(m)}
              onClose={() => setDiscard(undefined)}
            />
            <ConfirmModal
              open={Boolean(move)}
              title={`${move?.label ?? ''} ?`}
              text={move?.to === 'CANCELLED' ? 'Le projet sort du budget et de la trésorerie prévue.' : move?.to === 'IDEA' ? 'Le devis choisi est libéré : une nouvelle décision sera nécessaire.' : 'Le changement est inscrit dans l’historique des actions.'}
              cta={move?.label ?? 'Confirmer'}
              withMotif={Boolean(move?.reason)}
              pending={status.isPending}
              onConfirm={(m) => status.mutate(m || undefined)}
              onClose={() => setMove(undefined)}
            />
            <ConfirmModal
              open={archiving}
              title="Archiver ce projet ?"
              text="Le projet et ses devis sont gardés (R8) ; il disparaît des listes et du budget."
              cta="Archiver"
              withMotif
              pending={archive.isPending}
              onConfirm={(m) => archive.mutate(m)}
              onClose={() => setArchiving(false)}
            />
          </>
        )}
      </QueryState>
    </>
  );
}

function QuoteForm({ open, projectId, onClose }: { open: boolean; projectId: string; onClose: () => void }) {
  const [f, setF] = useState({ supplier: '', amount: '', delayDays: '', validUntil: '', note: '' });
  const [file, setFile] = useState<File>();
  const save = useAction(
    () => {
      const fields: Record<string, string> = { supplier: f.supplier, amount: String(Number(f.amount.replace(',', '.'))) };
      if (f.delayDays) fields.delayDays = f.delayDays;
      if (f.validUntil) fields.validUntil = f.validUntil;
      if (f.note) fields.note = f.note;
      return file ? api.upload(`/projects/${projectId}/quotes`, file, fields) : api.post(`/projects/${projectId}/quotes`, fields);
    },
    {
      invalidate: [['project', projectId], ['projects']],
      success: 'Devis ajouté.',
      onSuccess: () => {
        setF({ supplier: '', amount: '', delayDays: '', validUntil: '', note: '' });
        setFile(undefined);
        onClose();
      },
    },
  );
  const pick = (e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0]);
  return (
    <Modal
      open={open}
      title="Ajouter un devis"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" disabled={!f.supplier.trim() || !(Number(f.amount.replace(',', '.')) > 0) || save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <FormGrid onSubmit={(e) => e.preventDefault()}>
        <TextField label="Fournisseur *" full value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
        <TextField label="Montant TTC (DT) *" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <TextField label="Délai annoncé (jours)" inputMode="numeric" value={f.delayDays} onChange={(e) => setF({ ...f, delayDays: e.target.value.replace(/\D/g, '') })} />
        <TextField label="Valable jusqu’au" type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />
        <label className="flex flex-col gap-1.5 text-xs font-medium text-mut">
          Fichier du devis (PDF ou photo, 5 Mo)
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="fld text-[14px] text-fg" onChange={pick} />
        </label>
        <TextArea label="Remarques" full value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Garantie, matériaux, conditions de paiement…" />
      </FormGrid>
    </Modal>
  );
}
