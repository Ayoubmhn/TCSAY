import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMe } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card, CardGrid, CardRow, EmptyState } from '../../components/ui/Card';
import { SelectField, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { useViewMode, ViewToggle } from '../../components/ui/ViewToggle';
import { api } from '../../lib/api';
import { fD, todayIso } from '../../lib/format';
import { useAction } from '../../lib/useAction';
import { first, type MatchSummary } from './types';

/** Tout acteur peut créer un match pour en suivre le score (spectateur compris) ; il en saisit ensuite les points. */
export function useCanManageMatches() {
  return Boolean(useMe());
}

export function LivePill() {
  return (
    <Pill tone="r">
      <span className="me-1.5 inline-block size-2 animate-pulse rounded-full bg-[#e5484d] align-middle" aria-hidden="true" />
      En direct
    </Pill>
  );
}

function MatchCard({ m }: { m: MatchSummary }) {
  const winner = m.winner === null ? null : m.winner === 0 ? m.playerA.name : m.playerB.name;
  return (
    <Card>
      <CardRow>
        <h3>
          <Link to={`/matchs/${m.id}`} className="hover:underline">
            {m.playerA.name} <span className="text-mut">contre</span> {m.playerB.name}
          </Link>
        </h3>
        {m.status === 'LIVE' ? (
          <LivePill />
        ) : m.status === 'FINISHED' ? (
          <Pill tone="g">{first(winner ?? '')} gagne</Pill>
        ) : m.status === 'ABANDONED' ? (
          <Pill tone="s">Abandon</Pill>
        ) : (
          <Pill tone="s">À venir</Pill>
        )}
      </CardRow>
      <Pills>
        {(m.score || m.live) && (
          <Pill tone="b">
            {m.score}
            {m.live ? `${m.score ? ' · ' : ''}${m.live.point[0] || 'AV'}-${m.live.point[1] || 'AV'}` : ''}
          </Pill>
        )}
        <Pill tone="s">{m.title ?? m.kindLabel}</Pill>
        <Pill tone="b">{fD(m.date, { weekday: 'short', day: 'numeric', month: 'short' })}</Pill>
        {m.court && <Pill tone="g">{m.court}</Pill>}
      </Pills>
    </Card>
  );
}

/** Matchs : en cours (direct), à venir, terminés. Tous les acteurs consultent ; coach et direction créent et saisissent. */
export function MatchesPage() {
  const q = useQuery({ queryKey: ['matches'], queryFn: () => api.get<MatchSummary[]>('/matches'), refetchInterval: 15_000 });
  const canManage = useCanManageMatches();
  const [creating, setCreating] = useState(false);
  const [view, setView] = useViewMode('matchs');
  const list = q.data ?? [];
  const groups: [string, MatchSummary[]][] = [
    ['En cours', list.filter((m) => m.status === 'LIVE')],
    ['À venir', list.filter((m) => m.status === 'SCHEDULED')],
    ['Terminés', list.filter((m) => m.status === 'FINISHED' || m.status === 'ABANDONED')],
  ];

  return (
    <>
      <PageHeader
        title="Matchs"
        subtitle="Découvrez les matchs du club en direct et leurs statistiques."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            {canManage && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                + Nouveau match
              </Button>
            )}
          </div>
        }
      />
      <div className="mt-2">
        <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
          {list.length ? (
            groups
              .filter(([, ms]) => ms.length)
              .map(([title, ms]) => (
                <Section key={title} title={`${title} · ${ms.length}`}>
                  <CardGrid list={view === 'list'}>
                    {ms.map((m) => (
                      <MatchCard key={m.id} m={m} />
                    ))}
                  </CardGrid>
                </Section>
              ))
          ) : (
            <div className="mt-5">
              <EmptyState>Aucun match pour le moment.</EmptyState>
            </div>
          )}
        </QueryState>
      </div>
      <Note>
        Le score se met à jour tout seul pendant le match. Chacun peut créer un match et en saisir les points (même en spectateur) ;
        l’entraîneur des joueurs et la direction peuvent aussi saisir. Les parents sont prévenus au début et à la fin du match.
      </Note>
      {creating && <CreateMatchModal onClose={() => setCreating(false)} />}
    </>
  );
}

/** Création d'un match : joueurs (club ou adversaire extérieur), type, format. */
function CreateMatchModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const players = useQuery({ queryKey: ['match-players'], queryFn: () => api.get<{ id: string; name: string }[]>('/matches/players') });
  const [kind, setKind] = useState<'INTERNAL' | 'FRIENDLY' | 'TOURNAMENT'>('INTERNAL');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayIso());
  const [court, setCourt] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [bName, setBName] = useState('');
  const [setsToWin, setSetsToWin] = useState(2);
  const [games, setGames] = useState(6);
  const [superTB, setSuperTB] = useState(false);
  const [noAd, setNoAd] = useState(false);
  const [tiebreak, setTiebreak] = useState(true);
  const list = players.data ?? [];
  const aId = a || list[0]?.id || '';
  const external = b === 'EXT' || kind !== 'INTERNAL';
  const create = useAction(
    () =>
      api.post<{ id: string }>('/matches', {
        kind,
        title: title.trim() || undefined,
        date,
        court: court.trim() || undefined,
        playerAId: aId,
        ...(external ? { playerBName: bName.trim() } : { playerBId: b || list.find((p) => p.id !== aId)?.id }),
        setsToWin,
        games,
        tiebreak: tiebreak || superTB,
        superTB,
        noAd,
      }),
    { invalidate: [['matches']], success: 'Match créé.', onSuccess: (r) => navigate(`/matchs/${r.id}`) },
  );
  const ready = aId && (external ? bName.trim() : true);

  return (
    <Modal
      open
      size="lg"
      title="Nouveau match"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={() => create.mutate()} disabled={!ready || create.isPending}>
            Créer le match
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-2">
        <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="INTERNAL">Match interne</option>
          <option value="FRIENDLY">Match amical (adversaire extérieur)</option>
          <option value="TOURNAMENT">Tournoi</option>
        </SelectField>
        <TextField label="Tournoi, tour (facultatif)" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Open de Sayada U14 · quart" />
        <SelectField label="Joueur A (club)" value={aId} onChange={(e) => setA(e.target.value)}>
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        {kind === 'INTERNAL' ? (
          <SelectField label="Joueur B" value={b} onChange={(e) => setB(e.target.value)}>
            {list
              .filter((p) => p.id !== aId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            <option value="EXT">Adversaire extérieur…</option>
          </SelectField>
        ) : (
          <TextField label="Adversaire (nom, club)" value={bName} maxLength={80} onChange={(e) => setBName(e.target.value)} placeholder="ex. Lina Haddad (CT Monastir)" />
        )}
        {kind === 'INTERNAL' && b === 'EXT' && (
          <TextField label="Adversaire (nom, club)" value={bName} maxLength={80} full onChange={(e) => setBName(e.target.value)} />
        )}
        <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <TextField label="Terrain (facultatif)" value={court} maxLength={40} onChange={(e) => setCourt(e.target.value)} placeholder="ex. Court 2" />
        <SelectField label="Sets gagnants" value={setsToWin} onChange={(e) => setSetsToWin(Number(e.target.value))}>
          <option value={2}>2 sets gagnants</option>
          <option value={3}>3 sets gagnants</option>
        </SelectField>
        <SelectField label="Jeux par set" value={games} onChange={(e) => setGames(Number(e.target.value))}>
          <option value={6}>6 jeux</option>
          <option value={4}>4 jeux (jeunes)</option>
        </SelectField>
        <SelectField label="Dernier set" value={superTB ? '1' : '0'} onChange={(e) => setSuperTB(e.target.value === '1')}>
          <option value="0">Set normal</option>
          <option value="1">Super tie-break à 10 points</option>
        </SelectField>
        <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={tiebreak || superTB} disabled={superTB} onChange={(e) => setTiebreak(e.target.checked)} /> Tie-break à égalité de jeux
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={noAd} onChange={(e) => setNoAd(e.target.checked)} /> Point décisif à 40-40
          </label>
        </div>
      </div>
    </Modal>
  );
}
