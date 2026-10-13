import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Card, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { Segmented } from '../../components/ui/Segmented';
import { api } from '../../lib/api';
import { fD } from '../../lib/format';
import { useAction } from '../../lib/useAction';
import { LivePill } from './MatchesPage';
import { first, type AnnotatedPoint, type MatchDetail, type PlayerStats, type PointKind, type Side } from './types';

const SHOTS = ['Coup droit', 'Revers', 'Volée', 'Smash', 'Amorti', 'Lob', 'Passing'];

/** Tableau de score : sets (avec tie-break), points du jeu, serveur. */
function Board({ m }: { m: MatchDetail }) {
  const s = m.state;
  const sets = s?.sets ?? [];
  const live = m.status === 'LIVE';
  const row = (i: Side) => {
    const name = i === 0 ? m.playerA.name : m.playerB.name;
    return (
      <div
        className="grid items-center gap-1.5 border-t-[1.5px] border-line px-4 py-3 first:border-t-0"
        style={{ gridTemplateColumns: `18px minmax(0,1fr) repeat(${Math.max(1, sets.length)}, 34px) 60px` }}
      >
        <span>{live && s?.server === i && <span className="inline-block size-2.5 rounded-full border-2 border-ink bg-pg" title="Au service" />}</span>
        <span className="truncate font-semibold">
          {name}
          {m.winner === i && <span className="text-pri"> ✓</span>}
        </span>
        {sets.length ? (
          sets.map((set, k) => (
            <span key={k} className={`text-center tabular-nums ${k === sets.length - 1 && live ? 'font-semibold' : 'text-mut'}`}>
              {set.games[i]}
              {set.tiebreak && <sup className="text-[10px]">{set.tiebreak[i]}</sup>}
            </span>
          ))
        ) : (
          <span className="text-center text-mut">–</span>
        )}
        <span className="rounded-[14px] bg-fld py-1.5 text-center text-[19px] font-semibold tabular-nums">
          {live ? s?.point[i] || ' ' : m.winner === i ? '✓' : ' '}
        </span>
      </div>
    );
  };
  return (
    <>
      <div className="overflow-hidden rounded-[24px] border-[1.5px] border-line bg-card">
        {row(0)}
        {row(1)}
      </div>
      <Pills className="mt-2.5">
        {live ? <LivePill /> : m.status === 'FINISHED' ? <Pill tone="g">Terminé {m.score}</Pill> : m.status === 'ABANDONED' ? <Pill tone="s">Abandon</Pill> : <Pill tone="s">À venir</Pill>}
        {live && s?.tiebreak && <Pill tone="s">{s.tiebreak === 'SUPER' ? 'Super tie-break (10 points)' : 'Tie-break'}</Pill>}
        {live && s?.breakPoint && <Pill tone="r">Balle de break pour {first(s.server === 0 ? m.playerB.name : m.playerA.name)}</Pill>}
        {live && s?.decisivePoint && <Pill tone="s">Point décisif</Pill>}
        <Pill tone="s">{m.title ?? m.kindLabel}</Pill>
        <Pill tone="b">{fD(m.date, { weekday: 'short', day: 'numeric', month: 'short' })}</Pill>
        {m.court && <Pill tone="g">{m.court}</Pill>}
      </Pills>
    </>
  );
}

/** Saisie : un toucher par point ; ace, faute de 1re balle, double faute ; mode détaillé (comment, quel coup). */
function ScorePad({ m }: { m: MatchDetail }) {
  const [stage, setStage] = useState<1 | 2>(1);
  const [detailed, setDetailed] = useState(false);
  const [pending, setPending] = useState<Side | null>(null);
  const [shot, setShot] = useState('');
  const [abandon, setAbandon] = useState(false);
  const inv = [['match', m.id], ['matches']];
  const send = useAction(
    (p: { winner: Side; kind: PointKind }) => api.post<{ finished: boolean; score: string }>(`/matches/${m.id}/points`, { ...p, firstIn: stage === 1, shot: shot || undefined }),
    {
      invalidate: inv,
      success: (r) => (r.finished ? `Match terminé ${r.score} : parents prévenus.` : undefined),
      onSuccess: () => {
        setStage(1);
        setPending(null);
        setShot('');
      },
    },
  );
  const undo = useAction(() => api.delete(`/matches/${m.id}/points/last`), { invalidate: inv, success: 'Dernier point annulé.', onSuccess: () => setStage(1) });
  const stop = useAction((reason: string) => api.post(`/matches/${m.id}/abandon`, { reason }), { invalidate: inv, success: 'Match arrêté.', onSuccess: () => setAbandon(false) });
  const server = m.state?.server ?? 0;
  const srv = first(server === 0 ? m.playerA.name : m.playerB.name);
  const busy = send.isPending || undo.isPending;
  const big = 'rounded-[22px] px-3 py-[18px] text-[15px] font-semibold disabled:opacity-45';
  const point = (w: Side) => (detailed ? setPending(w) : send.mutate({ winner: w, kind: 'NONE' }));

  if (pending !== null) {
    return (
      <Card>
        <h3>Point pour {first(pending === 0 ? m.playerA.name : m.playerB.name)} : comment ?</h3>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Coup">
          {SHOTS.map((x) => (
            <button key={x} type="button" aria-pressed={shot === x} onClick={() => setShot(shot === x ? '' : x)} className={`rounded-full px-3.5 py-2 text-sm ${shot === x ? 'bg-sel text-white' : 'bg-fld'}`}>
              {x}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" className={`${big} bg-pg text-ink`} disabled={busy} onClick={() => send.mutate({ winner: pending, kind: 'WINNER' })}>
            Coup gagnant
          </button>
          <button type="button" className={`${big} bg-pr text-ink`} disabled={busy} onClick={() => send.mutate({ winner: pending, kind: 'UNFORCED' })}>
            Faute directe adverse
          </button>
          <button type="button" className={`${big} bg-ps text-ink`} disabled={busy} onClick={() => send.mutate({ winner: pending, kind: 'FORCED' })}>
            Faute provoquée
          </button>
          <button type="button" className={`${big} bg-fld`} disabled={busy} onClick={() => send.mutate({ winner: pending, kind: 'NONE' })}>
            Autre / passer
          </button>
        </div>
        <Button onClick={() => setPending(null)}>‹ Retour</Button>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3>
          Service : {srv} · {stage === 1 ? '1re balle' : '2e balle'}
        </h3>
        <label className="flex items-center gap-2 text-sm text-mut">
          <input type="checkbox" checked={detailed} onChange={(e) => setDetailed(e.target.checked)} /> Mode détaillé
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" className={`${big} bg-pri text-white`} disabled={busy} onClick={() => point(0)}>
          Point {first(m.playerA.name)}
        </button>
        <button type="button" className={`${big} bg-toggle text-bg`} disabled={busy} onClick={() => point(1)}>
          Point {first(m.playerB.name)}
        </button>
        <button type="button" className={`${big} bg-pg text-ink`} disabled={busy} onClick={() => send.mutate({ winner: server, kind: 'ACE' })}>
          Ace {srv}
        </button>
        {stage === 1 ? (
          <button type="button" className={`${big} bg-ps text-ink`} disabled={busy} onClick={() => setStage(2)}>
            Faute de 1re balle
          </button>
        ) : (
          <button type="button" className={`${big} bg-pr text-ink`} disabled={busy} onClick={() => send.mutate({ winner: (1 - server) as Side, kind: 'DF' })}>
            Double faute
          </button>
        )}
        <button type="button" className={`${big} col-span-2 bg-fld`} disabled={busy || !m.points.length} onClick={() => undo.mutate()}>
          ↶ Annuler le dernier point
        </button>
      </div>
      <div className="flex justify-end">
        <Button variant="danger" onClick={() => setAbandon(true)}>
          Arrêter le match (abandon)
        </Button>
      </div>
      <ConfirmModal
        open={abandon}
        title="Arrêter le match ?"
        text="Le score atteint est conservé ; le match ne pourra plus être repris."
        cta="Arrêter"
        withMotif
        pending={stop.isPending}
        onConfirm={(reason) => stop.mutate(reason)}
        onClose={() => setAbandon(false)}
      />
    </Card>
  );
}

const pct = (r: [number, number]) => (r[1] ? Math.round((r[0] / r[1]) * 100) : 0);

/** Ligne de statistique : valeurs de part et d'autre, barres depuis le centre (le meilleur en couleur). */
function StatRow({ label, a, b, mode = 'count' }: { label: string; a: number | [number, number]; b: number | [number, number]; mode?: 'count' | 'pct' | 'ratio' }) {
  const val = (x: number | [number, number]) => (Array.isArray(x) ? pct(x) : x);
  const txt = (x: number | [number, number]) =>
    Array.isArray(x) ? (
      mode === 'ratio' ? (
        `${x[0]}/${x[1]}`
      ) : (
        <>
          {pct(x)} %<span className="block text-xs font-medium text-mut">({x[0]}/{x[1]})</span>
        </>
      )
    ) : (
      x
    );
  const va = val(a);
  const vb = val(b);
  const max = Math.max(1, va, vb, mode === 'count' ? 0 : 100);
  return (
    <div className="border-t-[1.5px] border-line py-2.5 first:border-t-0">
      <div className="grid grid-cols-[80px_1fr_80px] items-end gap-2">
        <b className="text-[17px] font-semibold tabular-nums">{txt(a)}</b>
        <span className="text-center text-sm font-medium">{label}</span>
        <b className="text-end text-[17px] font-semibold tabular-nums">{txt(b)}</b>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1" aria-hidden="true">
        <div className="flex h-2 justify-end overflow-hidden rounded-full bg-fld">
          <i className={`block h-full rounded-full ${va >= vb ? 'bg-pri' : 'bg-mut'}`} style={{ width: `${(va / max) * 100}%` }} />
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-fld">
          <i className={`block h-full rounded-full ${vb >= va ? 'bg-pri' : 'bg-mut'}`} style={{ width: `${(vb / max) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

function StatsBlock({ m }: { m: MatchDetail }) {
  const [set, setSet] = useState<'ALL' | string>('ALL');
  if (!m.stats || !m.points.length) return <EmptyState>Aucun point joué.</EmptyState>;
  const [A, B]: [PlayerStats, PlayerStats] = set === 'ALL' ? m.stats.all : (m.stats.sets.find((s) => String(s.set) === set)?.stats ?? m.stats.all);
  const legend = (
    <div className="mb-1 flex justify-between font-semibold">
      <span>{first(m.playerA.name)}</span>
      <span>{first(m.playerB.name)}</span>
    </div>
  );
  return (
    <>
      <Segmented
        label="Période"
        value={set}
        onChange={setSet}
        options={[{ value: 'ALL', label: 'Match' }, ...m.stats.sets.map((s) => ({ value: String(s.set), label: `${s.set + 1}${s.set ? 'e' : 'er'} set` }))]}
      />
      <Section title="Service">
        <Card className="gap-0">
          {legend}
          <StatRow label="Aces" a={A.aces} b={B.aces} />
          <StatRow label="Doubles fautes" a={A.doubleFaults} b={B.doubleFaults} />
          <StatRow label="% 1re balle" a={A.firstServeIn} b={B.firstServeIn} mode="pct" />
          <StatRow label="Pts gagnés sur 1re balle" a={A.firstServeWon} b={B.firstServeWon} mode="pct" />
          <StatRow label="Pts gagnés sur 2e balle" a={A.secondServeWon} b={B.secondServeWon} mode="pct" />
          <StatRow label="Balles de break sauvées" a={A.breakPointsSaved} b={B.breakPointsSaved} mode="ratio" />
        </Card>
      </Section>
      <Section title="Retour">
        <Card className="gap-0">
          {legend}
          <StatRow label="Pts gagnés en retour de 1re" a={A.returnFirstWon} b={B.returnFirstWon} mode="pct" />
          <StatRow label="Pts gagnés en retour de 2e" a={A.returnSecondWon} b={B.returnSecondWon} mode="pct" />
          <StatRow label="Balles de break converties" a={A.breakPointsWon} b={B.breakPointsWon} mode="ratio" />
        </Card>
      </Section>
      <Section title="Points">
        <Card className="gap-0">
          {legend}
          <StatRow label="Points gagnés" a={A.pointsWon} b={B.pointsWon} />
          <StatRow label="Coups gagnants (aces compris)" a={A.winners} b={B.winners} />
          <StatRow label="Fautes directes" a={A.unforcedErrors} b={B.unforcedErrors} />
          <StatRow label="Plus longue série" a={A.longestStreak} b={B.longestStreak} />
        </Card>
      </Section>
      <Section title="Élan du match">
        <Card>
          <Momentum points={set === 'ALL' ? m.points : m.points.filter((p) => String(p.set) === set)} a={first(m.playerA.name)} b={first(m.playerB.name)} />
        </Card>
      </Section>
    </>
  );
}

/** Écart cumulé de points (au-dessus : joueur A devant), séparateurs de set. SVG fait main. */
function Momentum({ points, a, b }: { points: AnnotatedPoint[]; a: string; b: string }) {
  const W = 640;
  const H = 170;
  const mid = H / 2;
  let d = 0;
  const diffs = points.map((p) => (d += p.winner === 0 ? 1 : -1));
  const max = Math.max(4, ...diffs.map(Math.abs));
  const x = (i: number) => 10 + (i * (W - 20)) / Math.max(1, points.length - 1);
  const y = (v: number) => mid - (v / max) * (mid - 16);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Élan du match : au-dessus, ${a} devant ; en dessous, ${b} devant`}>
      <line x1={0} x2={W} y1={mid} y2={mid} stroke="var(--line)" strokeWidth={1.5} />
      {points.map((p, i) => (i && p.set !== points[i - 1].set ? <line key={i} x1={x(i)} x2={x(i)} y1={6} y2={H - 6} stroke="var(--line)" strokeDasharray="4 4" /> : null))}
      <polyline points={diffs.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="var(--pri)" strokeWidth={2.5} strokeLinejoin="round" />
      <text x={8} y={16} fontSize={11} fill="var(--mut)">
        {a} devant
      </text>
      <text x={8} y={H - 6} fontSize={11} fill="var(--mut)">
        {b} devant
      </text>
    </svg>
  );
}

/** Point par point : un jeu par ligne, pastille par point (couleur = gagnant ; A ace, D double faute, B balle de break). */
function PointByPoint({ m }: { m: MatchDetail }) {
  if (!m.points.length) return <EmptyState>Aucun point joué.</EmptyState>;
  const games: { key: string; set: number; game: string; server: Side; pts: AnnotatedPoint[] }[] = [];
  for (const p of m.points) {
    const key = `${p.set}|${p.game}`;
    if (!games.length || games[games.length - 1].key !== key) games.push({ key, set: p.set, game: p.game, server: p.server, pts: [] });
    games[games.length - 1].pts.push(p);
  }
  const mark = (p: AnnotatedPoint) => (p.kind === 'ACE' ? 'A' : p.kind === 'DF' ? 'D' : p.bp ? 'B' : '');
  return (
    <>
      <Card className="gap-0">
        {[...games].reverse().map((g) => {
          const last = g.pts[g.pts.length - 1];
          const broke = !g.game.includes('break') && last.winner !== g.server && (g !== games[games.length - 1] || m.status !== 'LIVE');
          return (
            <div key={g.key} className="grid grid-cols-[80px_1fr_auto] items-center gap-2.5 border-t-[1.5px] border-line py-2 text-[13.5px] first:border-t-0">
              <span className="text-mut">
                Set {g.set + 1}
                <br />
                {g.game}
              </span>
              <div className="flex flex-wrap gap-1">
                {g.pts.map((p) => (
                  <span
                    key={p.seq}
                    title={`${first(p.winner === 0 ? m.playerA.name : m.playerB.name)}${p.shot ? ' · ' + p.shot : ''}`}
                    className={`grid size-5 place-items-center rounded-full text-[10px] font-semibold ${p.winner === 0 ? 'bg-pri text-white' : 'bg-toggle text-bg'}`}
                  >
                    {mark(p)}
                  </span>
                ))}
              </div>
              {broke ? <Pill tone="r">Break</Pill> : <Pill tone="b">Service {first(g.server === 0 ? m.playerA.name : m.playerB.name)}</Pill>}
            </div>
          );
        })}
      </Card>
      <Note>
        Couleur = joueur qui gagne le point (indigo : {first(m.playerA.name)}, foncé : {first(m.playerB.name)}) · A = ace, D = double faute, B = balle de
        break.
      </Note>
    </>
  );
}

/** Fiche d'un match : score (direct, rafraîchi toutes les 5 s), saisie pour l'entraîneur ou la direction, statistiques, point par point. */
export function MatchPage() {
  const { id = '' } = useParams();
  const q = useQuery({
    queryKey: ['match', id],
    queryFn: () => api.get<MatchDetail>(`/matches/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'LIVE' ? 5_000 : false),
  });
  const [tab, setTab] = useState<'score' | 'stats' | 'pbp'>('score');
  const m = q.data;
  const start = useAction((firstServer: Side) => api.post(`/matches/${id}/start`, { firstServer }), {
    invalidate: [['match', id], ['matches']],
    success: 'Match lancé : parents prévenus.',
  });

  return (
    <>
      <Link to="/matchs" className="text-sm font-medium text-mut hover:underline">
        ‹ Matchs
      </Link>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {m && (
          <>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="text-[23px] font-semibold">
                {m.playerA.name} – {m.playerB.name}
              </h1>
              <span className="text-[13px] text-mut">Saisie : {m.scorer}</span>
            </div>
            <div className="mt-3">
              <Board m={m} />
            </div>
            <div className="mt-5">
              <Segmented
                label="Onglet"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'score', label: m.canScore && m.status === 'LIVE' ? 'Saisie' : 'Score' },
                  { value: 'stats', label: 'Stats' },
                  { value: 'pbp', label: 'Point par point' },
                ]}
              />
            </div>
            <div className="mt-4">
              {tab === 'score' &&
                (m.status === 'SCHEDULED' ? (
                  <Card>
                    <h3>Match à venir</h3>
                    {m.canScore ? (
                      <>
                        <span className="text-[13px] text-mut">Choisissez qui sert en premier pour lancer le match.</span>
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => start.mutate(0)} disabled={start.isPending}>
                            {first(m.playerA.name)} sert
                          </Button>
                          <Button onClick={() => start.mutate(1)} disabled={start.isPending}>
                            {first(m.playerB.name)} sert
                          </Button>
                        </div>
                      </>
                    ) : (
                      <span className="text-[13px] text-mut">Le score s’affichera ici dès le premier point.</span>
                    )}
                  </Card>
                ) : m.status === 'LIVE' && m.canScore ? (
                  <ScorePad m={m} />
                ) : (
                  <Card>
                    <h3>
                      {m.status === 'LIVE'
                        ? 'Match en cours'
                        : m.status === 'ABANDONED'
                          ? `Match arrêté${m.endReason ? ` : ${m.endReason}` : ''}`
                          : `🏆 ${m.winner === 0 ? m.playerA.name : m.playerB.name} gagne ${m.score}`}
                    </h3>
                    <span className="text-[13px] text-mut">
                      {m.status === 'LIVE' ? 'Le score se met à jour tout seul toutes les 5 secondes.' : `${m.points.length} points joués. Voir l’onglet Stats.`}
                    </span>
                    {m.status === 'FINISHED' && m.canScore && (
                      <span className="text-[13px] text-mut">Erreur de saisie ? « Annuler le dernier point » reste possible 30 minutes (ensuite : la direction).</span>
                    )}
                  </Card>
                ))}
              {tab === 'score' && m.status === 'FINISHED' && m.canScore && <UndoFinished m={m} />}
              {tab === 'stats' && <StatsBlock m={m} />}
              {tab === 'pbp' && <PointByPoint m={m} />}
            </div>
          </>
        )}
      </QueryState>
    </>
  );
}

function UndoFinished({ m }: { m: MatchDetail }) {
  const undo = useAction(() => api.delete(`/matches/${m.id}/points/last`), {
    invalidate: [['match', m.id], ['matches']],
    success: 'Dernier point annulé : le match reprend.',
  });
  return (
    <div className="mt-3 flex justify-end">
      <Button onClick={() => undo.mutate()} disabled={undo.isPending}>
        ↶ Annuler le dernier point
      </Button>
    </div>
  );
}
