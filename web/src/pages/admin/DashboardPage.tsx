import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useMe } from '../../auth/AuthContext';
import { Card, CardSubtitle, EmptyState, Kpi } from '../../components/ui/Card';
import { IconBell, IconCalendar, IconCard, IconClipboard, IconCourt, IconPlus, IconSettings } from '../../components/ui/Icons';
import { ProgressBar } from '../../components/ui/InstallmentCard';
import { QueryState } from '../../components/ui/Loading';
import { Pill, Pills, type PillTone } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { DT, fD } from '../../lib/format';
import type { Dashboard, Planning } from '../../lib/types';

/** Blocs que chacun peut masquer (« Personnaliser », mémorisé sur l'appareil). */
const BLOCKS = [
  ['kpis', 'Chiffres clés'],
  ['actions', 'Actions rapides'],
  ['todo', 'À traiter'],
  ['today', 'Aujourd’hui'],
  ['chart', 'Encaissements par mois'],
  ['groups', 'Groupes'],
] as const;
type Block = (typeof BLOCKS)[number][0];
const HIDDEN_KEY = 'tcsay-dash-hidden';

function readHidden(): Block[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as Block[];
  } catch {
    return [];
  }
}

type FinanceMonths = { months: { month: string; cotisations: number; reservations: number }[] };

const MONTH_SHORT = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];

function Head({ title, link, to }: { title: string; link?: string; to?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h2 className="m-0">{title}</h2>
      {link && to && (
        <Link to={to} className="text-[13.5px] font-medium text-pri">
          {link}
        </Link>
      )}
    </div>
  );
}

/** Bouton d'action rapide : grand carré cliquable, icône ronde. */
function Action({ to, label, icon, primary = false }: { to: string; label: string; icon: ReactNode; primary?: boolean }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center gap-2.5 rounded-[22px] border-[1.5px] border-line bg-card px-3 py-4 text-center text-[14px] font-medium text-fg hover:border-pri focus-visible:outline-2 focus-visible:outline-pri"
    >
      <span className={`grid h-11 w-11 place-items-center rounded-[14px] ${primary ? 'bg-pri text-white' : 'bg-fld text-fg'}`}>{icon}</span>
      {label}
    </Link>
  );
}

/** Ligne « À traiter » : pastille d'icône, texte, bouton d'action coloré. */
function Todo({ tone, icon, text, cta, to }: { tone: PillTone; icon: string; text: string; cta: string; to: string }) {
  const bg = { r: 'bg-[#fdb3b0]', s: 'bg-[#f0d9a8]', b: 'bg-[#c9e9fb]', g: 'bg-[#dff3a8]' }[tone];
  return (
    <li className="flex items-center gap-3 border-t-[1.5px] border-line py-3 first:border-t-0">
      <span className={`grid h-8 w-8 flex-none place-items-center rounded-[10px] text-[14px] text-[#111] ${bg}`} aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-[14.5px]">{text}</span>
      <Link to={to} className={`flex-none rounded-full px-3.5 py-1.5 text-[13px] text-[#111] ${bg}`}>
        {cta}
      </Link>
    </li>
  );
}

/** Histogramme fait main : encaissements par mois (mois en cours en indigo). */
function MonthBars({ months }: { months: FinanceMonths['months'] }) {
  const max = Math.max(1, ...months.map((m) => m.cotisations + m.reservations));
  const current = new Date().toISOString().slice(0, 7);
  return (
    <div className="flex h-[150px] items-end gap-2" role="img" aria-label="Encaissements par mois">
      {months.map((m) => {
        const v = m.cotisations + m.reservations;
        return (
          <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${m.month} : ${DT(v)}`}>
            <div className={`w-full rounded-t-[8px] ${m.month === current ? 'bg-pri' : 'bg-fld'}`} style={{ height: `${Math.max(4, (v / max) * 110)}px` }} />
            <span className="text-[11.5px] text-mut">{MONTH_SHORT[Number(m.month.slice(5, 7)) - 1]}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Tableau de bord (maquette validée) : chiffres clés, actions rapides, « À traiter », séances du jour,
 * encaissements par mois et groupes. Chaque bloc n'apparaît que si le compte a l'autorisation correspondante ;
 * « Personnaliser » masque les blocs voulus sur cet appareil.
 */
export function DashboardPage() {
  const me = useMe();
  const can = (...p: string[]) => p.some((x) => me.permissions.includes(x));
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard') });
  const today = new Date().toISOString().slice(0, 10);
  const planning = useQuery({
    queryKey: ['planning', today],
    queryFn: () => api.get<Planning>('/planning', { date: today }),
    enabled: can('planning.view', 'groups.manage'),
  });
  const finances = useQuery({ queryKey: ['finance-stats-dash'], queryFn: () => api.get<FinanceMonths>('/stats/finances') });
  const [hidden, setHidden] = useState<Block[]>(readHidden);
  const [custom, setCustom] = useState(false);
  const show = (b: Block) => !hidden.includes(b);
  const toggle = (b: Block) => {
    const next = hidden.includes(b) ? hidden.filter((x) => x !== b) : [...hidden, b];
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    } catch {
      /* mémoire de l'appareil indisponible : réglage gardé pour cette visite */
    }
  };

  const d = q.data;
  const rate = d && d.due > 0 ? Math.round((d.cashed / d.due) * 100) : null;

  // Séances et réservations du jour, triées par heure.
  const plan = planning.data;
  const agenda = plan
    ? [
        ...plan.sessions.map((s) => ({
          key: `s-${s.id}`,
          start: s.startTime,
          end: s.endTime,
          title: s.group.name,
          court: s.court?.name ?? null,
          tag: s.absentCoachIds.length && !s.replacement ? { tone: 'r' as PillTone, label: s.resolution === 'CANCELLED' ? 'Annulée' : 'À remplacer' } : { tone: 's' as PillTone, label: (s.replacement ?? s.coaches[0])?.firstName ?? 'Sans entraîneur' },
        })),
        ...plan.reservations.map((r) => ({
          key: `r-${r.id}`,
          start: r.startTime,
          end: r.endTime,
          title: r.match ? (r.match.title ?? r.match.players) : `Réservation${r.player ? ` · ${r.player}` : r.coach ? ` · ${r.coach.name}` : ''}`,
          court: plan.courts.find((c) => c.id === r.courtId)?.name ?? null,
          tag: { tone: 'b' as PillTone, label: r.type === 'PRIVATE' ? 'Séance privée' : r.type === 'LEISURE' ? 'Loisir' : 'Match' },
        })),
      ].sort((a, b) => a.start.localeCompare(b.start))
    : [];
  const sessionsToday = plan?.sessions.length ?? null;

  const todo = d
    ? [
        d.lateFamilies > 0 && can('payments.collect') && { tone: 'r' as PillTone, icon: '!', text: `${d.lateFamilies} famille(s) en retard de paiement`, cta: 'Relancer', to: '/admin/paiements' },
        d.todo.pendingAbsences > 0 && can('absences.manage') && { tone: 's' as PillTone, icon: '⇄', text: `${d.todo.pendingAbsences} absence(s) d’entraîneur à décider`, cta: 'Remplacer', to: '/admin/absences' },
        d.todo.newComplaints > 0 && can('complaints.manage', 'payments.collect', 'reservations.manage', 'evaluations.manage', 'groups.manage', 'courts.manage') && { tone: 's' as PillTone, icon: '✉', text: `${d.todo.newComplaints} réclamation(s) sans réponse`, cta: 'Ouvrir', to: '/admin/reclamations' },
        d.todo.tournamentRequests > 0 && can('tournaments.manage') && { tone: 'b' as PillTone, icon: '🏆', text: `${d.todo.tournamentRequests} demande(s) d’inscription au tournoi`, cta: 'Valider', to: '/tournois' },
        d.todo.reportsToPrepare && can('seasons.manage', 'stats.view') && { tone: 's' as PillTone, icon: '✎', text: `Saison ${d.todo.reportsToPrepare.label} clôturée : préparer le rapport moral et le rapport financier`, cta: 'Préparer', to: `/admin/rapports?saison=${d.todo.reportsToPrepare.seasonId}` },
        d.todo.withoutMembership > 0 && can('payments.collect', 'players.manage') && { tone: 'b' as PillTone, icon: '€', text: `${d.todo.withoutMembership} joueur(s) sans cotisation`, cta: 'Créer', to: '/admin/joueurs' },
      ].filter((x): x is { tone: PillTone; icon: string; text: string; cta: string; to: string } => Boolean(x))
    : [];

  type QuickAction = { to: string; label: string; icon: ReactNode; primary?: boolean };
  const actions = ([
    can('players.manage') && { to: '/admin/joueurs?nouveau=1', label: 'Nouveau joueur', icon: <IconPlus />, primary: true },
    can('payments.collect') && { to: '/admin/paiements', label: 'Encaisser', icon: <IconCard />, primary: true },
    can('planning.view', 'groups.manage') && { to: '/admin/planning', label: 'Planning du jour', icon: <IconCalendar /> },
    can('reservations.manage') && { to: '/admin/reservations', label: 'Réserver un terrain', icon: <IconCourt /> },
    can('notifications.send') && { to: '/admin/notifications', label: 'Envoyer un message', icon: <IconBell /> },
    can('payments.collect') && { to: '/admin/recus', label: 'Reçus', icon: <IconClipboard /> },
  ] as (QuickAction | false)[]).filter((x): x is QuickAction => Boolean(x));

  const groups = d?.groups ?? [];
  const fill = groups.length ? Math.round((groups.reduce((t, g) => t + Math.min(1, g.members / Math.max(1, g.capacity)), 0) / groups.length) * 100) : 0;
  const full = groups.filter((g) => g.members >= g.capacity);
  const mostFull = [...groups].sort((a, b) => b.members / Math.max(1, b.capacity) - a.members / Math.max(1, a.capacity))[0];
  const mostFree = [...groups].sort((a, b) => b.capacity - b.members - (a.capacity - a.members))[0];
  const firstName = me.firstName || 'Bienvenue';
  const dateLabel = fD(today, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0">Bonjour {firstName} 👋</h1>
          <p className="m-0 mt-1 text-mut first-letter:uppercase">
            {dateLabel}
            {d ? ` · saison ${d.season.label}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d && <Pill tone="g">Saison active {d.season.label}</Pill>}
          <button
            type="button"
            onClick={() => setCustom(!custom)}
            className="inline-flex items-center gap-1.5 rounded-full bg-btn px-3.5 py-[7px] text-[13.5px] font-medium text-fg"
            aria-expanded={custom}
          >
            <IconSettings size={16} /> Personnaliser
          </button>
        </div>
      </header>

      {custom && (
        <div className="mt-4 flex flex-wrap gap-2 rounded-[18px] bg-fld px-4 py-3 text-[14px]">
          <span className="me-2 text-mut">Blocs affichés :</span>
          {BLOCKS.map(([key, label]) => (
            <label key={key} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-card px-3 py-1.5">
              <input type="checkbox" className="h-4 w-4 accent-pri" checked={show(key)} onChange={() => toggle(key)} />
              {label}
            </label>
          ))}
        </div>
      )}

      <div className="mt-5">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {d && (
            <div className="flex flex-col gap-7">
              {show('kpis') && (
                <div className="grid grid-cols-2 gap-3.5 min-[1000px]:grid-cols-4">
                  <Card>
                    <CardSubtitle>Joueurs inscrits</CardSubtitle>
                    <Kpi>{d.activePlayers}</Kpi>
                    <Pills>
                      <Pill tone="g">+{d.newThisMonth} ce mois</Pill>
                      <Pill tone="b">{d.groupsCount} groupes</Pill>
                    </Pills>
                  </Card>
                  <Card>
                    <CardSubtitle>Encaissé · saison</CardSubtitle>
                    <Kpi>{DT(d.cashed)}</Kpi>
                    {rate !== null && (
                      <>
                        <ProgressBar value={d.cashed} max={d.due} />
                        <span className="text-[12.5px] text-mut">
                          {rate} % des {DT(d.due)} attendus
                        </span>
                      </>
                    )}
                  </Card>
                  <Card>
                    <CardSubtitle>En retard</CardSubtitle>
                    <span className={`text-[28px] font-semibold leading-[1.1] tabular-nums ${d.lateAmount > 0 ? 'text-[#c0392b]' : ''}`}>{DT(d.lateAmount)}</span>
                    <Pills>
                      {d.lateFamilies ? <Pill tone="r">{d.lateFamilies} famille(s)</Pill> : <Pill tone="g">Aucun retard</Pill>}
                      {d.late30 > 0 && <Pill tone="s">&gt; 30 j : {d.late30}</Pill>}
                    </Pills>
                  </Card>
                  <Card>
                    <CardSubtitle>Aujourd’hui</CardSubtitle>
                    <Kpi>{sessionsToday !== null ? `${sessionsToday} séance${sessionsToday > 1 ? 's' : ''}` : `${d.reservationsToday} résa.`}</Kpi>
                    <Pills>
                      <Pill tone="b">{d.reservationsToday} réservation(s)</Pill>
                      <Pill tone="b">Demain : {d.reservationsTomorrow}</Pill>
                    </Pills>
                  </Card>
                </div>
              )}

              {show('actions') && actions.length > 0 && (
                <section>
                  <Head title="Actions rapides" />
                  <div className="grid grid-cols-3 gap-3 min-[1000px]:grid-cols-6">
                    {actions.map((a) => (
                      <Action key={a.to} {...a} />
                    ))}
                  </div>
                </section>
              )}

              {(show('todo') || show('today')) && (
                <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-2 [&>section]:min-w-0">
                  {show('todo') && (
                    <section>
                      <Head title="À traiter" />
                      <Card>
                        {todo.length ? (
                          <ul className="m-0 list-none p-0">
                            {todo.map((t) => (
                              <Todo key={t.text} {...t} />
                            ))}
                          </ul>
                        ) : (
                          <EmptyState>Rien à traiter pour le moment ✓</EmptyState>
                        )}
                      </Card>
                    </section>
                  )}
                  {show('today') && can('planning.view', 'groups.manage') && (
                    <section>
                      <Head title="Aujourd’hui" link="Planning" to="/admin/planning" />
                      <Card>
                        {planning.isPending ? (
                          <span className="text-mut">Chargement…</span>
                        ) : agenda.length ? (
                          <ul className="m-0 list-none p-0">
                            {agenda.slice(0, 6).map((a) => (
                              <li key={a.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t-[1.5px] border-line py-2.5 first:border-t-0">
                                <b className="flex-none text-[14px] font-semibold tabular-nums min-[560px]:w-[96px]">
                                  {a.start}–{a.end}
                                </b>
                                <span className="min-w-[90px] flex-1 truncate text-[14.5px]">{a.title}</span>
                                {a.court && <Pill tone="g">{a.court}</Pill>}
                                <Pill tone={a.tag.tone}>{a.tag.label}</Pill>
                              </li>
                            ))}
                            {agenda.length > 6 && (
                              <li className="pt-2 text-center">
                                <Link to="/admin/planning" className="text-[13.5px] font-medium text-pri">
                                  + {agenda.length - 6} autre(s) · Voir le planning
                                </Link>
                              </li>
                            )}
                          </ul>
                        ) : (
                          <EmptyState>Aucune séance ni réservation aujourd’hui.</EmptyState>
                        )}
                      </Card>
                    </section>
                  )}
                </div>
              )}

              {(show('chart') || show('groups')) && (
                <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-2 [&>section]:min-w-0">
                  {show('chart') && (
                    <section>
                      <Head title="Encaissements par mois" link="Statistiques" to="/admin/statistiques" />
                      <Card>
                        <CardSubtitle>Cotisations et réservations · saison {d.season.label}</CardSubtitle>
                        {finances.data?.months.length ? <MonthBars months={finances.data.months} /> : <span className="text-mut">Chargement…</span>}
                      </Card>
                    </section>
                  )}
                  {show('groups') && (
                    <section>
                      <Head title="Groupes" link={`Voir les ${groups.length} groupes`} to="/admin/groupes" />
                      <Card>
                        <CardSubtitle>
                          Remplissage moyen {fill} % · {full.length} groupe(s) complet(s)
                        </CardSubtitle>
                        {groups.length ? (
                          <ul className="m-0 list-none p-0 text-[14.5px]">
                            {mostFull && (
                              <li className="flex items-center justify-between gap-2 py-2.5">
                                <span>Plus rempli</span>
                                <Pill tone={mostFull.members >= mostFull.capacity ? 'r' : 'b'}>
                                  {mostFull.name} {mostFull.members}/{mostFull.capacity}
                                </Pill>
                              </li>
                            )}
                            {mostFree && (
                              <li className="flex items-center justify-between gap-2 border-t-[1.5px] border-line py-2.5">
                                <span>Places libres</span>
                                <Pill tone="g">
                                  {mostFree.name} · {mostFree.capacity - mostFree.members} place(s)
                                </Pill>
                              </li>
                            )}
                            <li className="flex items-center justify-between gap-2 border-t-[1.5px] border-line py-2.5">
                              <span>Entraîneurs actifs</span>
                              <Pill tone="s">{d.coachesCount}</Pill>
                            </li>
                          </ul>
                        ) : (
                          <EmptyState>Aucun groupe sur la saison.</EmptyState>
                        )}
                      </Card>
                    </section>
                  )}
                </div>
              )}
            </div>
          )}
        </QueryState>
      </div>
    </>
  );
}

