import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { KidSelect } from '../../components/KidSelect';
import { CRITERIA } from '../../components/SessionReview';
import { Card, CardGrid, CardRow, CardSubtitle, CardText, EmptyState, Kpi } from '../../components/ui/Card';
import { Filters } from '../../components/ui/Field';
import { ProgressBar } from '../../components/ui/InstallmentCard';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { api } from '../../lib/api';
import { fD } from '../../lib/format';
import { useModule } from '../../lib/modules';
import type { Evaluation, Mood, SessionRatingNotes } from '../../lib/types';

type Progress = {
  player: { id: string; firstName: string; lastName: string; category: string | null; groups: { id: string; name: string }[] };
  season: { id: string; label: string };
  attendance: { present: number; late: number; absent: number; rate: number | null };
  average: number | null;
  months: { month: string; average: number | null; sessions: number }[];
  criteria: Record<keyof SessionRatingNotes, number | null>;
  lastMood: Mood | null;
  sessions: { date: string; group: string; startTime: string; objective: string | null; average: number; mood: Mood; comment: string | null }[];
};

const MOOD: Record<Mood, string> = { GOOD: '🙂 En forme', TIRED: '😐 Fatigué', PAIN: '🙁 Douleur signalée' };
const nb = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const monthLabel = (m: string) => fD(`${m}-01`, { month: 'short' });

/** Courbe de la moyenne mensuelle (SVG fait main, échelle 1 à 5). */
function ProgressChart({ months }: { months: Progress['months'] }) {
  const points = months.filter((m) => m.average !== null) as { month: string; average: number; sessions: number }[];
  const W = 560;
  const H = 180;
  const P = 30;
  const x = (i: number) => (points.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (points.length - 1));
  const y = (v: number) => H - P - ((v - 1) / 4) * (H - 2 * P);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Moyenne des séances par mois, sur 5">
        {[1, 2, 3, 4, 5].map((v) => (
          <g key={v}>
            <line x1={P} x2={W - P / 2} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={6} y={y(v) + 4} fontSize={11} fill="var(--mut)">
              {v}
            </text>
          </g>
        ))}
        {points.length > 1 && (
          <polyline
            points={points.map((p, i) => `${x(i)},${y(p.average)}`).join(' ')}
            fill="none"
            stroke="var(--pri)"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {points.map((p, i) => (
          <g key={p.month}>
            <circle cx={x(i)} cy={y(p.average)} r={5} fill="var(--card)" stroke="var(--pri)" strokeWidth={3}>
              <title>{`${monthLabel(p.month)} : ${nb(p.average)}/5 (${p.sessions} séance(s))`}</title>
            </circle>
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--mut)">
              {monthLabel(p.month)}
            </text>
          </g>
        ))}
      </svg>
      <ul className="sr-only">
        {points.map((p) => (
          <li key={p.month}>
            {monthLabel(p.month)} : {nb(p.average)} sur 5
          </li>
        ))}
      </ul>
    </>
  );
}

/** Suivi et progression (joueur, parent) : assiduité, évolution des notes, retours de l'entraîneur. */
export function ProgressPage() {
  const { playerId } = useAuth();
  // Bilans de période : module activable (sans lui, la page garde le suivi des séances).
  const bilansOn = useModule('bilans');
  const q = useQuery({
    queryKey: ['progress', playerId],
    queryFn: () => api.get<Progress>('/progress', { playerId }),
    enabled: Boolean(playerId),
  });
  const bilans = useQuery({
    queryKey: ['progress', 'evaluations', playerId],
    queryFn: () =>
      api.get<{ level: string | null; levelUpdatedAt: string | null; evaluations: Evaluation[] }>('/evaluations/player', { playerId }),
    enabled: Boolean(playerId) && bilansOn,
  });
  const criteria = useQuery({
    queryKey: ['evaluation-criteria'],
    queryFn: () => api.get<{ criteria: { key: string; label: string; family: string }[] }>('/evaluations/criteria'),
    enabled: bilansOn,
  });
  const matches = useQuery({
    queryKey: ['progress', 'matches', playerId],
    queryFn: () =>
      api.get<{
        played: number;
        wins: number;
        losses: number;
        totals: { aces: number; doubleFaults: number; firstIn: [number, number]; firstWon: [number, number]; bpWon: [number, number] };
        recent: { id: string; date: string; opponent: string; won: boolean; score: string | null; kind: string }[];
      }>('/matches/player/summary', { playerId }),
    enabled: Boolean(playerId),
  });
  const labelOf = (k: string) => criteria.data?.criteria.find((c) => c.key === k)?.label ?? k;
  const d = q.data;
  const last = d?.months.at(-1);
  const prev = d?.months.at(-2);
  const trend = last?.average != null && prev?.average != null ? Math.round((last.average - prev.average) * 10) / 10 : null;
  const marks = d ? d.attendance.present + d.attendance.late + d.attendance.absent : 0;

  return (
    <>
      <PageHeader title="Suivi et progression" subtitle="Découvrez l’évolution, les notes et les retours de l’entraîneur." />
      <Filters>
        <KidSelect />
        {d?.player.groups.map((g) => (
          <Pill key={g.id} tone="g">
            {g.name}
          </Pill>
        ))}
        {d?.player.category && <Pill tone="s">{d.player.category}</Pill>}
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {d && (
          <>
            <CardGrid>
              <Card>
                <CardSubtitle>Assiduité (saison)</CardSubtitle>
                <Kpi>{d.attendance.rate !== null ? `${d.attendance.rate} %` : '—'}</Kpi>
                {marks > 0 && <ProgressBar value={d.attendance.present + d.attendance.late} max={marks} />}
                <Pills>
                  <Pill tone="g">{d.attendance.present} présence(s)</Pill>
                  <Pill tone="b">{d.attendance.late} retard(s)</Pill>
                  <Pill tone="r">{d.attendance.absent} absence(s)</Pill>
                </Pills>
              </Card>
              <Card>
                <CardSubtitle>Moyenne des séances {last ? `(${monthLabel(last.month)})` : ''}</CardSubtitle>
                <Kpi>{last?.average != null ? `${nb(last.average)}/5` : '—'}</Kpi>
                <Pills>
                  {trend !== null && (
                    <Pill tone={trend >= 0 ? 'g' : 'r'}>
                      {trend >= 0 ? '+' : '−'}
                      {nb(Math.abs(trend))} vs mois précédent
                    </Pill>
                  )}
                  {d.average !== null && <Pill tone="b">Saison {nb(d.average)}/5</Pill>}
                </Pills>
              </Card>
              <Card>
                <CardSubtitle>Niveau</CardSubtitle>
                <Kpi>{bilans.data?.level ?? '—'}</Kpi>
                <CardText>
                  {bilans.data?.levelUpdatedAt
                    ? `Validé par la direction technique le ${fD(bilans.data.levelUpdatedAt.slice(0, 10), { day: 'numeric', month: 'long' })}`
                    : 'Fixé au bilan de période.'}
                </CardText>
              </Card>
              <Card>
                <CardSubtitle>Forme signalée</CardSubtitle>
                <Kpi>{d.lastMood ? MOOD[d.lastMood].split(' ')[0] : '—'}</Kpi>
                <CardText>{d.lastMood ? `${MOOD[d.lastMood].slice(3)} à la dernière séance évaluée` : 'Pas encore d’évaluation.'}</CardText>
              </Card>
            </CardGrid>

            <Section title="Progression mois par mois">
              {d.months.length ? (
                <Card>
                  <ProgressChart months={d.months} />
                  <CardText>Moyenne des 5 critères notés par l’entraîneur à chaque séance (1 à 5).</CardText>
                </Card>
              ) : (
                <EmptyState>Les notes apparaîtront après les premières séances évaluées.</EmptyState>
              )}
            </Section>

            {d.average !== null && (
              <Section title="Moyenne par critère (saison)">
                <Card>
                  <div className="flex flex-col gap-2.5">
                    {CRITERIA.map((c) => {
                      const v = d.criteria[c.key];
                      return (
                        <div key={c.key} className="grid grid-cols-[minmax(120px,180px)_1fr_auto] items-center gap-3 text-sm">
                          <span>{c.label}</span>
                          <ProgressBar value={v ?? 0} max={5} />
                          <b className="font-semibold tabular-nums">{v !== null ? `${nb(v)}/5` : '—'}</b>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </Section>
            )}

            {bilans.data && bilans.data.evaluations.length > 0 && (
              <Section title="Bilans de période">
                <CardGrid>
                  {bilans.data.evaluations.map((e) => (
                    <Card key={e.id}>
                      <CardRow>
                        <h3>{e.periodLabel}</h3>
                        {e.average !== null && <Pill tone="g">{nb(e.average)}/5</Pill>}
                      </CardRow>
                      <Pills>
                        <Pill tone="s">Par {e.author}</Pill>
                        {e.proposedLevel && e.levelValidated && <Pill tone="g">Niveau {e.proposedLevel}</Pill>}
                      </Pills>
                      <div className="flex flex-col gap-1.5">
                        {Object.entries(e.scores).map(([k, v]) => (
                          <div key={k} className="grid grid-cols-[minmax(110px,170px)_1fr_auto] items-center gap-3 text-sm">
                            <span className="truncate">{labelOf(k)}</span>
                            <ProgressBar value={v} max={5} />
                            <b className="font-semibold tabular-nums">{v}/5</b>
                          </div>
                        ))}
                      </div>
                      {e.strengths && <CardText>✅ Point fort : {e.strengths}</CardText>}
                      {e.toWork && <CardText>🎯 À travailler : {e.toWork}</CardText>}
                      {e.goals && <CardText>📌 Objectifs : {e.goals}</CardText>}
                    </Card>
                  ))}
                </CardGrid>
              </Section>
            )}

            {matches.data && matches.data.played > 0 && (
              <Section title="Matchs de la saison">
                <CardGrid>
                  <Card>
                    <CardSubtitle>Bilan</CardSubtitle>
                    <Kpi>
                      {matches.data.wins} V · {matches.data.losses} D
                    </Kpi>
                    <Pills>
                      <Pill tone="b">{matches.data.played} match(s)</Pill>
                      <Pill tone="g">{matches.data.totals.aces} aces</Pill>
                    </Pills>
                  </Card>
                  <Card>
                    <CardSubtitle>% de 1re balle</CardSubtitle>
                    <Kpi>{matches.data.totals.firstIn[1] ? Math.round((matches.data.totals.firstIn[0] / matches.data.totals.firstIn[1]) * 100) : 0} %</Kpi>
                    <CardText>
                      Points gagnés sur 1re balle :{' '}
                      {matches.data.totals.firstWon[1] ? Math.round((matches.data.totals.firstWon[0] / matches.data.totals.firstWon[1]) * 100) : 0} %
                    </CardText>
                  </Card>
                  <Card>
                    <CardSubtitle>Derniers matchs</CardSubtitle>
                    <div className="flex flex-col gap-1.5 text-sm">
                      {matches.data.recent.map((r) => (
                        <Link key={r.id} to={`/matchs/${r.id}`} className="flex items-center justify-between gap-2 hover:underline">
                          <span className="truncate">{r.opponent}</span>
                          <Pill tone={r.won ? 'g' : 'r'}>
                            {r.won ? 'V' : 'D'} {r.score}
                          </Pill>
                        </Link>
                      ))}
                    </div>
                  </Card>
                </CardGrid>
              </Section>
            )}

            <Section title="Dernières séances">
              {d.sessions.length ? (
                <CardGrid list>
                  {d.sessions.map((s) => (
                    <Card key={s.date + s.startTime}>
                      <CardRow>
                        <h3>{fD(s.date)}</h3>
                        <Pill tone={s.average >= 3.5 ? 'g' : s.average >= 2.5 ? 'b' : 'r'}>{nb(s.average)}/5</Pill>
                      </CardRow>
                      <Pills>
                        <Pill tone="b">
                          {s.group} · {s.startTime}
                        </Pill>
                        {s.objective && <Pill tone="s">Objectif : {s.objective}</Pill>}
                        {s.mood !== 'GOOD' && <Pill tone={s.mood === 'PAIN' ? 'r' : 's'}>{MOOD[s.mood]}</Pill>}
                      </Pills>
                      <CardText>{s.comment ? `💬 ${s.comment}` : 'Pas de commentaire.'}</CardText>
                    </Card>
                  ))}
                </CardGrid>
              ) : (
                <EmptyState>Aucune séance évaluée pour le moment.</EmptyState>
              )}
            </Section>
          </>
        )}
      </QueryState>
      <Note>
        Après chaque séance, l’entraîneur note 5 critères de 1 à 5 : engagement, concentration, comportement, objectif du jour et
        qualité de jeu. Le joueur est comparé à lui-même, jamais aux autres.
      </Note>
    </>
  );
}
