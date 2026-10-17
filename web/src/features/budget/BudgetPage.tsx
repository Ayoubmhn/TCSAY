import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card, CardRow, CardSubtitle, CardText, EmptyState, Kpi } from '../../components/ui/Card';
import { FilterSelect, Filters, FormGrid, SelectField, TextArea, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { Segmented } from '../../components/ui/Segmented';
import { api } from '../../lib/api';
import { DT, fD } from '../../lib/format';
import { useAction } from '../../lib/useAction';
import type { Season } from '../seasons/api';
import { PRIORITY, POST_LABEL, STATUS_TONE, monthLabel, type Budget, type BudgetRow, type Forecast, type Project, type ProjectList } from './types';

type View = 'projets' | 'budget' | 'tresorerie';

/**
 * Projets et budget : projets du club avec devis et décision du bureau, budget prévu de la saison face au réel,
 * prévision de trésorerie sur 12 mois. Lecture : « budget.manage » ou « stats.view » ; modification : « budget.manage ».
 */
export function BudgetPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('vue') as View) || 'projets';
  return (
    <>
      <PageHeader title="Projets et budget" subtitle="Découvrez les projets du club, le budget de la saison et la trésorerie prévue mois par mois." />
      <Filters>
        <Segmented<View>
          label="Vue"
          options={[
            { value: 'projets', label: 'Projets' },
            { value: 'budget', label: 'Budget de la saison' },
            { value: 'tresorerie', label: 'Trésorerie' },
          ]}
          value={view}
          onChange={(v) => setParams(v === 'projets' ? {} : { vue: v })}
        />
      </Filters>
      <div className="mt-4">{view === 'projets' ? <ProjectsView /> : view === 'budget' ? <BudgetView /> : <TreasuryView />}</div>
    </>
  );
}

const useCanEdit = () => {
  const { me } = useAuth();
  return Boolean(me?.permissions.includes('budget.manage'));
};

/** Barre faite main : part payée (vert) du budget du projet. */
export function SpentBar({ spent, budget }: { spent: number; budget: number | null }) {
  if (!budget) return null;
  const pct = Math.min(100, Math.round((spent / budget) * 100));
  const over = spent > budget;
  return (
    <div className="mt-2" aria-label={`Payé ${pct} % du budget`}>
      <div className="h-2 overflow-hidden rounded-full bg-fld">
        <span className={`block h-full rounded-full ${over ? 'bg-[#fdb3b0]' : 'bg-[#9fd36b]'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="mt-1 block text-[12px] text-mut">
        Payé {DT(spent)} sur {DT(budget)} ({pct} %){over ? ' · dépassement' : ''}
      </span>
    </div>
  );
}

// ───────────────────────── Projets ─────────────────────────

function ProjectsView() {
  const canEdit = useCanEdit();
  const navigate = useNavigate();
  const [state, setState] = useState('active');
  const q = useQuery({ queryKey: ['projects', state], queryFn: () => api.get<ProjectList>(`/projects?state=${state}`) });
  const [creating, setCreating] = useState(false);
  const d = q.data;
  return (
    <>
      <Filters>
        <FilterSelect label="Projets" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="active">En cours et à décider</option>
          <option value="done">Terminés</option>
          <option value="cancelled">Abandonnés</option>
          <option value="all">Tous</option>
          <option value="archived">Archivés</option>
        </FilterSelect>
        {canEdit && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Nouveau projet
          </Button>
        )}
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {d && (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 min-[700px]:grid-cols-3">
              <Card>
                <CardSubtitle>Projets validés</CardSubtitle>
                <Kpi>{DT(d.totals.approved)}</Kpi>
                <CardText keep>Montant des devis choisis (validés et en cours)</CardText>
              </Card>
              <Card>
                <CardSubtitle>Déjà payé</CardSubtitle>
                <Kpi>{DT(d.totals.spent)}</Kpi>
                <CardText keep>Dépenses rattachées aux projets validés</CardText>
              </Card>
              <Card>
                <CardSubtitle>Idées et devis à décider</CardSubtitle>
                <Kpi>{DT(d.totals.ideas)}</Kpi>
                <CardText keep>Devis le moins cher, sinon estimation</CardText>
              </Card>
            </div>
            <Section title="Projets">
              {d.projects.length ? (
                <div className="flex flex-col gap-2">
                  {d.projects.map((p) => (
                    <ProjectCard key={p.id} p={p} onOpen={() => navigate(`/admin/projets/${p.id}`)} />
                  ))}
                </div>
              ) : (
                <EmptyState>Aucun projet ici. Notez une idée (nouveau terrain, éclairage, matériel…) puis ajoutez les devis reçus.</EmptyState>
              )}
              <Note>
                Un projet passe par : idée → devis → <b>décision du bureau</b> (devis choisi, motif obligatoire, inscrit dans l’historique des actions) →
                en cours → terminé. Les dépenses payées rattachées au projet montrent le réel face au devis ; les projets validés entrent dans le
                budget et dans la trésorerie prévue.
              </Note>
            </Section>
          </>
        )}
      </QueryState>
      {d && <ProjectForm open={creating} list={d} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/admin/projets/${id}`)} />}
    </>
  );
}

function ProjectCard({ p, onOpen }: { p: Project; onOpen: () => void }) {
  return (
    <Card className={p.archivedAt ? 'opacity-60' : ''}>
      <CardRow>
        <button type="button" className="min-w-0 flex-1 cursor-pointer truncate text-start text-[16px] font-medium text-fg hover:underline" onClick={onOpen}>
          {p.title}
        </button>
        <Pills>
          <Pill tone={STATUS_TONE[p.status]}>{p.statusLabel}</Pill>
          <Pill tone="s">{p.categoryLabel.split(' (')[0]}</Pill>
          {p.priority === 1 && <Pill tone="r">{PRIORITY[1]}</Pill>}
          {p.targetDate && <Pill tone="b">{fD(p.targetDate, { month: 'long', year: 'numeric' })}</Pill>}
        </Pills>
      </CardRow>
      <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
        {p.chosenQuote ? (
          <span>
            Devis choisi : <b className="font-semibold">{DT(p.chosenQuote.amount)}</b> · {p.chosenQuote.supplier}
          </span>
        ) : p.quotes ? (
          <span>
            {p.quotes} devis : <b className="font-semibold">{p.quotes > 1 ? `${DT(p.minQuote!)} à ${DT(p.maxQuote!)}` : DT(p.minQuote!)}</b>
          </span>
        ) : p.estimatedAmount !== null ? (
          <span>
            Estimation : <b className="font-semibold">{DT(p.estimatedAmount)}</b>
          </span>
        ) : (
          <span className="text-mut">Ni devis ni estimation</span>
        )}
        {p.responsible && <span className="text-mut">Responsable : {p.responsible}</span>}
      </div>
      {['APPROVED', 'IN_PROGRESS', 'DONE'].includes(p.status) && <SpentBar spent={p.spent} budget={p.budget} />}
    </Card>
  );
}

/** Formulaire projet (création ou modification). */
export function ProjectForm({ open, list, project, onClose, onSaved }: { open: boolean; list: Pick<ProjectList, 'categories' | 'people' | 'seasons'>; project?: Project; onClose: () => void; onSaved?: (id: string) => void }) {
  const empty = { title: '', description: '', category: 'COURT', priority: '2', estimatedAmount: '', targetDate: '', seasonId: '', responsibleId: '' };
  const [f, setF] = useState(empty);
  useEffect(() => {
    if (!open) return;
    setF(
      project
        ? {
            title: project.title,
            description: project.description ?? '',
            category: project.category,
            priority: String(project.priority),
            estimatedAmount: project.estimatedAmount !== null ? String(project.estimatedAmount) : '',
            targetDate: project.targetDate ?? '',
            seasonId: project.seasonId ?? '',
            responsibleId: project.responsibleId ?? '',
          }
        : empty,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project]);
  const body = () => ({
    title: f.title,
    description: f.description || null,
    category: f.category,
    priority: Number(f.priority),
    estimatedAmount: f.estimatedAmount ? Number(f.estimatedAmount.replace(',', '.')) : null,
    targetDate: f.targetDate || null,
    seasonId: f.seasonId || null,
    responsibleId: f.responsibleId || null,
    ...(project ? { version: project.version } : {}),
  });
  const save = useAction(() => (project ? api.patch<Project>(`/projects/${project.id}`, body()) : api.post<Project>('/projects', body())), {
    invalidate: [['projects'], ['project'], ['budget'], ['forecast']],
    success: project ? 'Projet modifié.' : 'Projet créé.',
    onSuccess: (p) => {
      onClose();
      onSaved?.(p.id);
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      open={open}
      title={project ? 'Modifier le projet' : 'Nouveau projet'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" disabled={!f.title.trim() || save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <FormGrid onSubmit={(e) => e.preventDefault()}>
        <TextField label="Titre *" full value={f.title} onChange={set('title')} placeholder="ex. Éclairage LED du terrain 4" maxLength={120} />
        <SelectField label="Type" value={f.category} onChange={set('category')}>
          {list.categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Priorité" value={f.priority} onChange={set('priority')}>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {PRIORITY[n]}
            </option>
          ))}
        </SelectField>
        <TextField label="Estimation (DT, avant devis)" inputMode="decimal" value={f.estimatedAmount} onChange={set('estimatedAmount')} />
        <TextField label="Réalisation souhaitée" type="date" value={f.targetDate} onChange={set('targetDate')} />
        <SelectField label="Saison du budget" value={f.seasonId} onChange={set('seasonId')}>
          <option value="">Selon la date de réalisation</option>
          {list.seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Responsable (bureau)" value={f.responsibleId} onChange={set('responsibleId')}>
          <option value="">—</option>
          {list.people.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>
        <TextArea label="Description" full rows={3} value={f.description} onChange={set('description')} placeholder="Besoin, contraintes, ce qui est attendu des fournisseurs…" />
      </FormGrid>
    </Modal>
  );
}

// ───────────────────────── Budget de la saison ─────────────────────────

function useSeasonChoice() {
  const [params, setParams] = useSearchParams();
  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => api.get<Season[]>('/seasons') });
  const list = useMemo(() => [...(seasons.data ?? [])].filter((s) => !s.archivedAt).sort((a, b) => b.label.localeCompare(a.label)), [seasons.data]);
  const seasonId = params.get('saison') ?? list.find((s) => s.status === 'ACTIVE')?.id ?? list[0]?.id;
  const select = (
    <FilterSelect label="Saison" value={seasonId ?? ''} onChange={(e) => setParams({ vue: 'budget', saison: e.target.value })}>
      {list.map((s) => (
        <option key={s.id} value={s.id}>
          Saison {s.label}
          {s.status === 'ACTIVE' ? ' (active)' : s.status === 'DRAFT' ? ' (à venir)' : ''}
        </option>
      ))}
    </FilterSelect>
  );
  return { seasonId, select };
}

function BudgetView() {
  const canEdit = useCanEdit();
  const { seasonId, select } = useSeasonChoice();
  const q = useQuery({ queryKey: ['budget', seasonId], queryFn: () => api.get<Budget>(`/budget/${seasonId}`), enabled: Boolean(seasonId) });
  const d = q.data;
  const [form, setForm] = useState<Record<string, string>>({});
  const key = (kind: string, c: string) => `${kind}:${c}`;
  useEffect(() => {
    if (!d) return;
    const f: Record<string, string> = {};
    for (const r of d.income) f[key('INCOME', r.category)] = r.planned !== null ? String(r.planned) : '';
    for (const r of d.expenses) f[key('EXPENSE', r.category)] = r.planned !== null ? String(r.planned) : '';
    setForm(f);
  }, [d]);
  const editable = canEdit && d && !d.locked;
  const amount = (v: string | undefined) => Number((v ?? '').replace(/\s/g, '').replace(',', '.')) || 0;
  const save = useAction(
    () =>
      api.put<Budget>(`/budget/${seasonId}`, {
        lines: Object.entries(form)
          .filter(([, v]) => amount(v) > 0)
          .map(([k, v]) => {
            const [kind, category] = k.split(':');
            return { kind, category, amount: amount(v) };
          }),
      }),
    { invalidate: [['budget', seasonId ?? '']], success: 'Budget enregistré.' },
  );
  const fromPrevious = () => {
    if (!d) return;
    const f = { ...form };
    for (const r of d.income) if (r.previous) f[key('INCOME', r.category)] = String(r.previous);
    for (const r of d.expenses) if (r.previous) f[key('EXPENSE', r.category)] = String(r.previous);
    setForm(f);
  };
  const plannedProjects = d ? d.projects.reduce((t, p) => t + p.planned, 0) : 0;
  const pIncome = d ? d.income.reduce((t, r) => t + amount(form[key('INCOME', r.category)]), 0) : 0;
  const pExpenses = d ? d.expenses.reduce((t, r) => t + amount(form[key('EXPENSE', r.category)]), 0) + plannedProjects : 0;

  // Fonction (et non composant) : les champs gardent le focus pendant la saisie.
  const table = (kind: 'INCOME' | 'EXPENSE', rows: BudgetRow[]) => (
    <Card>
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-x-3 gap-y-1 text-[14px]">
        <span className="text-[12px] font-semibold text-mut">Poste</span>
        <span className="text-[12px] font-semibold text-mut">Prévu</span>
        <span className="text-[12px] font-semibold text-mut">Réel</span>
        <span className="text-[12px] font-semibold text-mut">Écart</span>
        {rows.map((r) => {
          const planned = amount(form[key(kind, r.category)]);
          const gap = r.actual - planned;
          const good = kind === 'INCOME' ? gap >= 0 : gap <= 0;
          return (
            <div key={r.category} className="contents">
              <span className="min-w-0 truncate border-t-[1.5px] border-line pt-2">
                {POST_LABEL[r.category] ?? r.category}
                {r.previous !== null && r.previous > 0 && <span className="block text-[12px] text-mut">Saison préc. : {DT(r.previous)}</span>}
              </span>
              <span className="border-t-[1.5px] border-line pt-1.5">
                {editable ? (
                  <input
                    aria-label={`Prévu : ${POST_LABEL[r.category] ?? r.category}`}
                    className="fld !py-1.5 w-full text-[14px]"
                    inputMode="decimal"
                    value={form[key(kind, r.category)] ?? ''}
                    onChange={(e) => setForm({ ...form, [key(kind, r.category)]: e.target.value })}
                  />
                ) : planned ? (
                  DT(planned)
                ) : (
                  '—'
                )}
              </span>
              <span className="border-t-[1.5px] border-line pt-2 tabular-nums">{r.actual ? DT(r.actual) : '—'}</span>
              <span className="border-t-[1.5px] border-line pt-1.5">
                {planned > 0 ? (
                  <Pill tone={good ? 'g' : 'r'}>
                    {gap > 0 ? '+' : ''}
                    {DT(gap)}
                  </Pill>
                ) : (
                  <span className="text-mut">—</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );

  return (
    <>
      <Filters>
        {select}
        {editable && d?.previous && (
          <Button onClick={fromPrevious}>Reprendre le réel de {d.previous.label}</Button>
        )}
        {editable && (
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Enregistrement…' : 'Enregistrer le budget'}
          </Button>
        )}
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {d && (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 min-[700px]:grid-cols-3">
              <Card>
                <CardSubtitle>Recettes · prévu / réel</CardSubtitle>
                <Kpi>{DT(pIncome)}</Kpi>
                <CardText keep>Réel : {DT(d.totals.actualIncome)}</CardText>
              </Card>
              <Card>
                <CardSubtitle>Dépenses · prévu / réel</CardSubtitle>
                <Kpi>{DT(pExpenses)}</Kpi>
                <CardText keep>Réel : {DT(d.totals.actualExpenses)} (projets compris)</CardText>
              </Card>
              <Card>
                <CardSubtitle>Résultat prévu</CardSubtitle>
                <Kpi>
                  <span className={pIncome - pExpenses < 0 ? 'text-[#b42318]' : ''}>{DT(pIncome - pExpenses)}</span>
                </Kpi>
                <CardText keep>Réel à ce jour : {DT(d.totals.actualResult)}</CardText>
              </Card>
            </div>
            {d.locked && <Note>Saison {d.season.label} verrouillée (R1) : budget en lecture seule.</Note>}
            <Section title="Recettes">
              {table('INCOME', d.income)}
            </Section>
            <Section title="Dépenses">
              {table('EXPENSE', d.expenses)}
            </Section>
            <Section title="Projets de la saison">
              {d.projects.length ? (
                <Card>
                  {d.projects.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-3 border-t-[1.5px] border-line py-2 first:border-t-0">
                      <Link className="min-w-0 flex-1 truncate font-medium text-fg hover:underline" to={`/admin/projets/${p.id}`}>
                        {p.title}
                      </Link>
                      <Pill tone="b">Prévu {DT(p.planned)}</Pill>
                      <Pill tone={p.actual > p.planned ? 'r' : 'g'}>Payé {DT(p.actual)}</Pill>
                    </div>
                  ))}
                </Card>
              ) : (
                <EmptyState>Aucun projet validé pour cette saison.</EmptyState>
              )}
            </Section>
            <Note>
              Le réel vient de l’application : cotisations encaissées, réservations, inscriptions aux tournois, salaires versés et dépenses payées (les
              dépenses rattachées à un projet sont comptées avec le projet). Les projets validés entrent dans le budget d’après le devis choisi.
            </Note>
          </>
        )}
      </QueryState>
    </>
  );
}

// ───────────────────────── Trésorerie ─────────────────────────

function TreasuryView() {
  const canEdit = useCanEdit();
  const [late, setLate] = useState<'include' | 'half' | 'exclude'>('half');
  const q = useQuery({ queryKey: ['forecast', late], queryFn: () => api.get<Forecast>(`/budget/treasury/forecast?late=${late}`) });
  const d = q.data;
  const [editing, setEditing] = useState(false);
  const [bal, setBal] = useState({ amount: '', date: new Date().toISOString().slice(0, 10), note: '' });
  const saveBal = useAction(() => api.put('/budget/treasury/balance', { amount: Number(bal.amount.replace(',', '.')), date: bal.date, note: bal.note || undefined }), {
    invalidate: [['forecast']],
    success: 'Solde enregistré.',
    onSuccess: () => setEditing(false),
  });
  const [open, setOpen] = useState<string | null>(null);
  const max = d ? Math.max(1, ...d.months.map((m) => Math.abs(m.balance))) : 1;
  return (
    <>
      <Filters>
        <FilterSelect label="Tranches en retard" value={late} onChange={(e) => setLate(e.target.value as typeof late)}>
          <option value="half">Retards comptés à moitié (prudent)</option>
          <option value="include">Retards comptés en entier</option>
          <option value="exclude">Retards non comptés</option>
        </FilterSelect>
        {canEdit && (
          <Button
            variant="primary"
            onClick={() => {
              setBal({ amount: d?.balance ? String(d.balance.amount) : '', date: new Date().toISOString().slice(0, 10), note: d?.balance?.note ?? '' });
              setEditing(true);
            }}
          >
            Saisir le solde du club
          </Button>
        )}
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {d && (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 min-[700px]:grid-cols-3">
              <Card>
                <CardSubtitle>Solde estimé aujourd’hui</CardSubtitle>
                <Kpi>{d.estimated !== null ? DT(d.estimated) : '—'}</Kpi>
                <CardText keep>
                  {d.balance
                    ? `${DT(d.balance.amount)} au ${fD(d.balance.date, { day: 'numeric', month: 'short', year: 'numeric' })}, + ${DT(d.since!.received)} encaissés, − ${DT(d.since!.paid)} payés depuis`
                    : 'Saisissez le solde de la caisse et du compte pour démarrer la prévision.'}
                </CardText>
              </Card>
              <Card>
                <CardSubtitle>Point le plus bas</CardSubtitle>
                <Kpi>
                  <span className={d.lowest && d.lowest.balance < 0 ? 'text-[#b42318]' : ''}>{d.lowest ? DT(d.lowest.balance) : '—'}</span>
                </Kpi>
                <CardText keep>{d.lowest ? monthLabel(d.lowest.month) : ''}</CardText>
              </Card>
              <Card>
                <CardSubtitle>Tranches en retard</CardSubtitle>
                <Kpi>{DT(d.lateTotal)}</Kpi>
                <CardText keep>{late === 'half' ? 'comptées à moitié ce mois-ci' : late === 'include' ? 'comptées en entier ce mois-ci' : 'non comptées'}</CardText>
              </Card>
            </div>
            {d.firstNegative && (
              <Note>
                <b>Attention :</b> le solde prévu devient négatif en {monthLabel(d.firstNegative)}. Décalez un projet, relancez les retards ou cherchez
                une recette (subvention, sponsor) avant cette date.
              </Note>
            )}
            <Section title="Mois par mois">
              <div className="flex flex-col gap-2">
                {d.months.map((m) => (
                  <Card key={m.month}>
                    <button type="button" className="flex w-full cursor-pointer flex-wrap items-center gap-3 text-start" aria-expanded={open === m.month} onClick={() => setOpen(open === m.month ? null : m.month)}>
                      <span className="w-[86px] font-medium capitalize">{monthLabel(m.month)}</span>
                      <span className="min-w-[160px] flex-1">
                        <span className="block h-2.5 overflow-hidden rounded-full bg-fld">
                          <span className={`block h-full rounded-full ${m.balance < 0 ? 'bg-[#fdb3b0]' : 'bg-[#9fd36b]'}`} style={{ width: `${(Math.abs(m.balance) / max) * 100}%` }} />
                        </span>
                      </span>
                      {m.in > 0 && <Pill tone="g">+ {DT(m.in)}</Pill>}
                      {m.out > 0 && <Pill tone="r">− {DT(m.out)}</Pill>}
                      <b className={`w-[110px] text-end tabular-nums ${m.balance < 0 ? 'text-[#b42318]' : ''}`}>{DT(m.balance)}</b>
                    </button>
                    {open === m.month && (
                      <ul className="m-0 mt-2 list-none border-t-[1.5px] border-line p-0 pt-2 text-[14px]">
                        {m.items.length ? (
                          m.items.map((i) => (
                            <li key={`${i.kind}${i.label}`} className="flex justify-between gap-2 py-0.5">
                              <span>
                                {i.label}
                                {i.late ? ' (prudence)' : ''}
                              </span>
                              <b className="font-semibold tabular-nums">
                                {i.kind === 'in' ? '+' : '−'} {DT(i.amount)}
                              </b>
                            </li>
                          ))
                        ) : (
                          <li className="text-mut">Aucun mouvement prévu.</li>
                        )}
                      </ul>
                    )}
                  </Card>
                ))}
              </div>
              <Note>
                Encaissements prévus : tranches à encaisser à leur échéance. Paiements prévus : dépenses non payées (à leur date limite), salaires à
                verser, et reste de chaque projet validé (devis choisi moins les dépenses déjà enregistrées) au mois de réalisation souhaité. Les
                montants restent une prévision : le solde réel se ressaisit de temps en temps.
              </Note>
            </Section>
          </>
        )}
      </QueryState>
      <Modal
        open={editing}
        title="Solde du club"
        onClose={() => setEditing(false)}
        footer={
          <>
            <Button onClick={() => setEditing(false)}>Annuler</Button>
            <Button variant="primary" disabled={!bal.amount || !bal.date || saveBal.isPending} onClick={() => saveBal.mutate()}>
              Enregistrer
            </Button>
          </>
        }
      >
        <FormGrid onSubmit={(e) => e.preventDefault()}>
          <TextField label="Montant (caisse + compte, DT)" inputMode="decimal" value={bal.amount} onChange={(e) => setBal({ ...bal, amount: e.target.value })} />
          <TextField label="À la date du" type="date" value={bal.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBal({ ...bal, date: e.target.value })} />
          <TextField label="Remarque" full value={bal.note} onChange={(e) => setBal({ ...bal, note: e.target.value })} placeholder="ex. relevé bancaire + caisse comptée" />
        </FormGrid>
        <Note>Les encaissements et paiements enregistrés après cette date sont ajoutés automatiquement.</Note>
      </Modal>
    </>
  );
}
