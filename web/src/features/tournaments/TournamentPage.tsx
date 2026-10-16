import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth, useMe } from '../../auth/AuthContext';
import { KidSelect } from '../../components/KidSelect';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardActions, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { SelectField, TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill, Pills } from '../../components/ui/Pill';
import { Section } from '../../components/ui/Section';
import { Segmented } from '../../components/ui/Segmented';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { DT, fD } from '../../lib/format';
import type { Player } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { RefereePicker, type Referee } from './RefereePicker';
import { TournamentForm } from './TournamentForm';
import { STATUS, type Conflict, type TEntry, type TMatch, type TournamentDetail } from './types';

const KEYS = [['tournament'], ['tournaments'], ['matches']];
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
const day = (iso: string | null) => (iso ? fD(iso.slice(0, 10), { weekday: 'short', day: 'numeric', month: 'short' }) : 'Horaire à fixer');

/** Inscription d'un joueur du club (recherche) ou d'un joueur extérieur ; hors critères : motif de dérogation. */
function AddEntry({ tournamentId }: { tournamentId: string }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [ext, setExt] = useState('');
  const [derog, setDerog] = useState<{ id: string; name: string; why: string }>();
  const found = useQuery({ queryKey: ['players', 'tournament', q.trim()], queryFn: () => api.get<Player[]>('/players', { q: q.trim() }), enabled: q.trim().length >= 2 });
  const add = useAction((body: { playerId?: string; name?: string; derogationReason?: string }) => api.post(`/tournaments/${tournamentId}/entries`, body), {
    invalidate: KEYS,
    success: 'Joueur inscrit.',
    onSuccess: () => (setQ(''), setExt(''), setDerog(undefined)),
  });
  const tryAdd = (p: Player) =>
    api
      .post(`/tournaments/${tournamentId}/entries`, { playerId: p.id })
      .then(() => (toast('Joueur inscrit.'), setQ('')))
      .catch((e: Error) => (/dérogation/.test(e.message) ? setDerog({ id: p.id, name: `${p.firstName} ${p.lastName}`, why: e.message }) : toast(e.message)))
      .finally(() => add.reset());
  return (
    <Card className="max-w-[760px]">
      <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-2">
        <TextField label="Inscrire un joueur du club" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou code TCSAY" />
        <div className="flex items-end gap-2">
          <TextField label="ou un joueur extérieur (nom, club)" value={ext} maxLength={80} onChange={(e) => setExt(e.target.value)} placeholder="ex. Karim Jaziri (CT Monastir)" />
          <ActionIcon kind="add" primary label="Inscrire le joueur extérieur" onClick={() => (ext.trim() ? add.mutate({ name: ext.trim() }) : toast('Saisissez le nom.'))} />
        </div>
      </div>
      {q.trim().length >= 2 && (
        <div className="flex flex-col gap-1.5">
          {found.data?.slice(0, 8).map((p) => (
            <button key={p.id} type="button" onClick={() => void tryAdd(p).then(() => void 0)} className="flex justify-between rounded-[16px] bg-fld px-4 py-2 text-start text-sm hover:bg-btn">
              <span>
                {p.firstName} {p.lastName}
              </span>
              <span className="text-mut">{p.memberCode ?? ''}</span>
            </button>
          ))}
          {found.data && !found.data.length && <CardText keep>Aucun joueur trouvé.</CardText>}
        </div>
      )}
      <ConfirmModal
        open={Boolean(derog)}
        title={`Inscrire ${derog?.name ?? ''} hors critères ?`}
        text={derog?.why ?? ''}
        cta="Inscrire avec dérogation"
        withMotif
        pending={add.isPending}
        onConfirm={(reason) => derog && add.mutate({ playerId: derog.id, derogationReason: reason })}
        onClose={() => setDerog(undefined)}
      />
    </Card>
  );
}

/** Saisie du résultat par la direction (score sur papier ou forfait). */
function ResultModal({ tournamentId, match, onClose }: { tournamentId: string; match?: TMatch; onClose: () => void }) {
  const [winner, setWinner] = useState<'0' | '1'>('0');
  const [score, setScore] = useState('');
  useEffect(() => (setWinner('0'), setScore('')), [match]);
  const save = useAction(() => api.post(`/tournaments/${tournamentId}/matches/${match!.id}/result`, { winner: Number(winner), score: score.trim() || undefined }), {
    invalidate: KEYS,
    success: 'Résultat enregistré : le tableau avance.',
    onSuccess: onClose,
  });
  return (
    <Modal
      open={Boolean(match)}
      title={match ? `${match.roundLabel} · résultat` : ''}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={() => save.mutate()} disabled={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      {match && (
        <div className="grid gap-3">
          <SelectField label="Vainqueur" value={winner} onChange={(e) => setWinner(e.target.value as '0' | '1')}>
            <option value="0">{match.playerA.name}</option>
            <option value="1">{match.playerB.name}</option>
          </SelectField>
          <TextField label="Score (vide = victoire par forfait)" value={score} maxLength={60} onChange={(e) => setScore(e.target.value)} placeholder="ex. 6-3 4-6 10-7" />
          <Note>Pour suivre le match en direct point par point, ouvrez-le dans Matchs : le tableau avance aussi à la fin du match.</Note>
        </div>
      )}
    </Modal>
  );
}

/** Nom affiché d'un joueur pas encore connu : « Vainqueur A / B » d'après le match du tour précédent. */
function feederName(all: TMatch[], m: TMatch, side: 0 | 1): string | null {
  const f = all.find((x) => x.round === m.round - 1 && x.position === 2 * m.position + side);
  if (!f) return null;
  const known = (n: string) => !n.startsWith('À déterminer');
  if (known(f.playerA.name) && known(f.playerB.name)) return `Vainqueur ${f.playerA.name} / ${f.playerB.name}`;
  return `Vainqueur ${f.roundLabel} n° ${f.position + 1}`;
}

/** Arbitre d'un match, choisi avant son début (compte du club ou nom hors club). */
function RefereeModal({ tournamentId, match, onClose }: { tournamentId: string; match?: TMatch; onClose: () => void }) {
  const [ref, setRef] = useState<Referee | null>(null);
  useEffect(() => setRef(match?.referee ?? null), [match]);
  const save = useAction(() => api.patch(`/tournaments/${tournamentId}/matches/${match!.id}/referee`, { userId: ref?.userId ?? null, name: ref?.name ?? null }), {
    invalidate: KEYS,
    success: 'Arbitre enregistré.',
    onSuccess: onClose,
  });
  return (
    <Modal
      open={Boolean(match)}
      title={match ? `Arbitre · ${match.roundLabel} n° ${match.position + 1}` : ''}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={() => save.mutate()} disabled={save.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <RefereePicker value={ref} onChange={setRef} />
        <Note>Un arbitre membre du club saisit les points depuis Matchs ; il est prévenu par notification.</Note>
      </div>
    </Modal>
  );
}

function MatchBox({ m, all, manage, onResult, onReferee }: { m: TMatch; all: TMatch[]; manage: boolean; onResult: (m: TMatch) => void; onReferee: (m: TMatch) => void }) {
  const row = (side: 0 | 1) => {
    const p = side ? m.playerB : m.playerA;
    const name = p.name.startsWith('À déterminer') ? (feederName(all, m, side) ?? p.name) : p.name;
    const won = m.winner === side;
    return (
      <div className={`flex items-center justify-between gap-2 px-3.5 py-2 ${side ? 'border-t-[1.5px] border-line' : ''}`}>
        <span className={`truncate ${won ? 'font-semibold' : ''} ${p.name.startsWith('À déterminer') ? 'text-mut' : ''}`}>{name}</span>
        {won && <span className="text-pri">✓</span>}
      </div>
    );
  };
  return (
    <div className="overflow-hidden rounded-[18px] border-[1.5px] border-line bg-card text-sm">
      {row(0)}
      {row(1)}
      <div className="flex flex-wrap items-center justify-between gap-1.5 bg-fld px-3.5 py-1.5 text-xs text-mut">
        <span>
          {m.score ?? (m.scheduledAt ? `${day(m.scheduledAt)} ${time(m.scheduledAt)}${m.court ? ` · ${m.court}` : ''}` : 'Horaire à fixer')}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {m.status === 'LIVE' && <Pill tone="r">En direct</Pill>}
          {m.resultHidden && m.status !== 'SCHEDULED' && <span>Résultat non public</span>}
          {m.referee?.name && <span title="Arbitre">Arbitre : {m.referee.name}</span>}
          {manage && m.status === 'SCHEDULED' && (
            <button type="button" className="font-medium text-pri hover:underline" onClick={() => onReferee(m)}>
              {m.referee?.name ? 'Changer l’arbitre' : 'Arbitre'}
            </button>
          )}
          {m.ready && (
            <Link to={`/matchs/${m.id}`} className="font-medium text-pri hover:underline">
              Match
            </Link>
          )}
          {manage && m.ready && m.status !== 'FINISHED' && (
            <button type="button" className="font-medium text-pri hover:underline" onClick={() => onResult(m)}>
              Résultat
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function PaidPill({ e }: { e: TEntry }) {
  return e.paid ? <Pill tone="g">Inscription payée</Pill> : <Pill tone="r">Inscription à payer</Pill>;
}

/** Fiche d'un tournoi : inscrits, tableau ou classement, planning des terrains et entraînements touchés. */
export function TournamentPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const { playerId } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['tournament', id], queryFn: () => api.get<TournamentDetail>(`/tournaments/${id}`), refetchInterval: 15_000 });
  const t = q.data;
  const [tab, setTab] = useState<'entries' | 'board' | 'schedule' | 'conflicts'>('entries');
  useEffect(() => {
    if (t && t.status !== 'REGISTRATION' && t.status !== 'DRAFT') setTab((x) => (x === 'entries' ? 'board' : x));
  }, [t?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<TMatch>();
  const [refereeOf, setRefereeOf] = useState<TMatch>();
  const [cancelling, setCancelling] = useState(false);
  const manage = Boolean(t?.canManage);
  const conflicts = useQuery({ queryKey: ['tournament', id, 'conflicts'], queryFn: () => api.get<Conflict[]>(`/tournaments/${id}/conflicts`), enabled: manage && tab === 'conflicts' });
  const draw = useAction(() => api.post<{ matches: number; unplaced: string[] }>(`/tournaments/${id}/draw`), {
    invalidate: KEYS,
    success: (r) => `Tirage fait : ${r.matches} match(s) planifié(s)${r.unplaced.length ? ` · sans horaire : ${r.unplaced.join(', ')} (ajoutez des jours ou des terrains)` : ''}. Vérifiez puis publiez le tableau.`,
    onSuccess: () => setTab('board'),
  });
  const publish = useAction((published: boolean) => api.post(`/tournaments/${id}/publish`, { published }), {
    invalidate: KEYS,
    success: (_r, published) => (published ? 'Tableau publié : les familles sont prévenues.' : 'Tableau retiré : seule la direction le voit.'),
  });
  const pay = useAction(({ entryId, paid }: { entryId: string; paid: boolean }) => api.patch(`/tournaments/${id}/entries/${entryId}/payment`, { paid }), {
    invalidate: KEYS,
    success: (_r, v) => (v.paid ? 'Inscription marquée payée.' : 'Paiement annulé.'),
  });
  const seed = useAction(({ entryId, value }: { entryId: string; value: number | null }) => api.patch(`/tournaments/${id}/entries/${entryId}`, { seed: value }), { invalidate: KEYS });
  const withdraw = useAction((entryId: string) => api.delete(`/tournaments/${id}/entries/${entryId}`), { invalidate: KEYS, success: 'Inscription retirée.' });
  const approve = useAction((p: string) => api.post(`/tournaments/${id}/entries`, { playerId: p }), { invalidate: KEYS, success: 'Inscription confirmée : la famille est prévenue.' });
  const request = useAction(() => api.post<{ message: string }>(`/tournaments/${id}/request`, { playerId: me.role === 'PARENT' ? playerId : undefined }), { invalidate: KEYS, success: (r) => r.message });
  const resolve = useAction((b: { slotId: string; date: string; action: 'move' | 'postpone' }) => api.post(`/tournaments/${id}/conflicts`, b), {
    invalidate: [['tournament', id, 'conflicts']],
    success: 'Séance mise à jour : groupe et entraîneurs prévenus.',
  });
  const cancel = useAction((reason: string) => api.post(`/tournaments/${id}/cancel`, { reason }), { invalidate: KEYS, success: 'Tournoi annulé : terrains libérés.', onSuccess: () => setCancelling(false) });

  if (!t) return <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>{null}</QueryState>;
  const confirmed = t.entries.filter((e) => e.status === 'CONFIRMED');
  const pending = t.entries.filter((e) => e.status === 'PENDING');
  const family = me.role === 'PARENT' || me.role === 'PLAYER';
  const tabs = [
    { value: 'entries' as const, label: `Inscrits · ${confirmed.length}` },
    { value: 'board' as const, label: t.format === 'KNOCKOUT' ? 'Tableau' : 'Classement' },
    { value: 'schedule' as const, label: 'Planning' },
    ...(manage ? [{ value: 'conflicts' as const, label: 'Entraînements touchés' }] : []),
  ];
  const byRound = Array.from({ length: t.rounds }, (_, r) => t.matches.filter((m) => m.round === r + 1));
  const scheduled = [...t.matches].filter((m) => m.scheduledAt).sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1));

  return (
    <>
      <PageHeader
        title={t.name}
        subtitle={`${t.kindLabel} · ${t.format === 'KNOCKOUT' ? 'élimination directe' : 'championnat'} · ${t.setsToWin} set${t.setsToWin > 1 ? 's' : ''} gagnant${t.setsToWin > 1 ? 's' : ''} de ${t.games} jeux${t.superTB ? ', super tie-break' : ''}`}
        action={<Pill tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Pill>}
      />
      <Pills className="mt-3">
        <Pill tone="b">{t.startDate === t.endDate ? fD(t.startDate, { weekday: 'long', day: 'numeric', month: 'long' }) : `${fD(t.startDate, { day: 'numeric', month: 'short' })} – ${fD(t.endDate, { day: 'numeric', month: 'short' })}`}</Pill>
        <Pill tone="s">{t.eligibilityLabel}</Pill>
        <Pill tone="g">{t.courts.map((c) => c.name).join(' · ')}</Pill>
        <Pill tone="b">
          {t.dayStart}–{t.dayEnd} · matchs de {t.matchMinutes} min
        </Pill>
        {t.fee !== null ? <Pill tone="s">Inscription {DT(t.fee)}</Pill> : <Pill tone="g">Inscription gratuite</Pill>}
        <Pill tone="s">{t.resultsPublic ? 'Résultats publics' : 'Résultats réservés aux joueurs concernés'}</Pill>
        <Pill tone="b">{t.liveScoring ? 'Score en direct' : 'Résultat à la fin du match'}</Pill>
        {t.referee?.name && <Pill tone="b">Arbitre : {t.referee.name}</Pill>}
        {t.winnerName && <Pill tone="g">🏆 {t.winnerName}</Pill>}
      </Pills>
      {t.notes && <Note>{t.notes}</Note>}
      {manage && !t.drawPublished && t.status !== 'REGISTRATION' && t.status !== 'DRAFT' && t.status !== 'CANCELLED' && (
        <Note>
          Tableau et créneaux pas encore publiés : seule la direction les voit. Vérifiez les horaires, choisissez les arbitres, puis
          publiez (les familles inscrites sont prévenues).
        </Note>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Segmented label="Vue" value={tab} onChange={setTab} options={tabs} />
        {manage && t.status === 'REGISTRATION' && (
          <>
            <ActionIcon kind="edit" label="Modifier le tournoi" onClick={() => setEditing(true)} />
            <Button variant="primary" onClick={() => draw.mutate()} disabled={draw.isPending || confirmed.length < 2}>
              Fermer les inscriptions et tirer au sort
            </Button>
          </>
        )}
        {manage && t.status !== 'REGISTRATION' && t.status !== 'DRAFT' && t.status !== 'CANCELLED' && (
          <Button variant={t.drawPublished ? undefined : 'primary'} onClick={() => publish.mutate(!t.drawPublished)} disabled={publish.isPending}>
            {t.drawPublished ? 'Retirer la publication' : 'Publier le tableau'}
          </Button>
        )}
        {manage && t.status !== 'FINISHED' && t.status !== 'CANCELLED' && <ActionIcon kind="cancel" label="Annuler le tournoi" onClick={() => setCancelling(true)} />}
      </div>

      {tab === 'entries' && (
        <Section title="Inscrits">
          {family && t.familyRequest && t.status === 'REGISTRATION' && (
            <Card className="mb-3 max-w-[760px]">
              <div className="flex flex-wrap items-center gap-2">
                <KidSelect />
                <Button variant="primary" onClick={() => request.mutate()} disabled={request.isPending}>
                  Demander l’inscription
                </Button>
              </div>
              <CardText keep>
                La direction technique valide la demande ; vous êtes prévenu par notification.
                {t.fee !== null && ` Inscription payante : ${DT(t.fee)}, à régler au club.`}
              </CardText>
            </Card>
          )}
          {manage && t.status === 'REGISTRATION' && <AddEntry tournamentId={t.id} />}
          {pending.length > 0 && manage && (
            <CardGrid list className="mt-3">
              {pending.map((e) => (
                <Card key={e.id}>
                  <CardRow>
                    <h3>{e.name}</h3>
                  </CardRow>
                  <Pills>
                    <Pill tone="s">Demande de la famille</Pill>
                  </Pills>
                  <CardActions>
                    <ActionIcon kind="check" primary label="Confirmer l’inscription" onClick={() => e.playerId && approve.mutate(e.playerId)} />
                    <ActionIcon kind="refuse" label="Refuser" onClick={() => withdraw.mutate(e.id)} />
                  </CardActions>
                </Card>
              ))}
            </CardGrid>
          )}
          {confirmed.length ? (
            <CardGrid list className="mt-3">
              {confirmed.map((e) => (
                <Card key={e.id}>
                  <CardRow>
                    <h3>
                      {e.seed ? <b className="me-1 text-pri">{e.seed}</b> : null}
                      {e.name}
                    </h3>
                  </CardRow>
                  <Pills>
                    {e.playerId ? e.category && <Pill tone="s">{e.category}</Pill> : <Pill tone="s">Extérieur</Pill>}
                    {e.level && <Pill tone="b">Niveau {e.level}</Pill>}
                    {e.seed && <Pill tone="g">Tête de série {e.seed}</Pill>}
                    {e.derogationReason && <Pill tone="r" className="card-text">Dérogation : {e.derogationReason}</Pill>}
                    {e.mine && <Pill tone="g">Mon joueur</Pill>}
                    {t.fee !== null && (manage || e.mine) && <PaidPill e={e} />}
                  </Pills>
                  {manage && t.fee !== null && t.status !== 'CANCELLED' && (
                    <CardActions>
                      <ActionIcon
                        kind={e.paid ? 'cancel' : 'pay'}
                        primary={!e.paid}
                        label={e.paid ? 'Annuler le paiement de l’inscription' : `Inscription payée (${DT(t.fee)})`}
                        onClick={() => pay.mutate({ entryId: e.id, paid: !e.paid })}
                      />
                    </CardActions>
                  )}
                  {manage && t.status === 'REGISTRATION' && (
                    <CardActions>
                      <select
                        className="fld w-auto py-1.5 text-sm"
                        aria-label="Tête de série"
                        value={e.seed ?? ''}
                        onChange={(ev) => seed.mutate({ entryId: e.id, value: ev.target.value ? Number(ev.target.value) : null })}
                      >
                        <option value="">Sans tête de série</option>
                        {Array.from({ length: Math.min(8, t.maxPlayers) }, (_, i) => (
                          <option key={i + 1} value={i + 1}>
                            Tête de série {i + 1}
                          </option>
                        ))}
                      </select>
                      <ActionIcon kind="remove" label="Retirer du tournoi" onClick={() => withdraw.mutate(e.id)} />
                    </CardActions>
                  )}
                </Card>
              ))}
            </CardGrid>
          ) : (
            <div className="mt-3">
              <EmptyState>Aucun inscrit pour l’instant.</EmptyState>
            </div>
          )}
        </Section>
      )}

      {tab === 'board' &&
        (t.matches.length ? (
          t.format === 'KNOCKOUT' ? (
            <div className="mt-5 grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2">
              {byRound.map((ms, r) => (
                <div key={r} className="flex flex-col justify-around gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-mut">{ms[0]?.roundLabel ?? `Tour ${r + 1}`}</h3>
                  {ms.map((m) => (
                    <MatchBox key={m.id} m={m} all={t.matches} manage={manage} onResult={setResult} onReferee={setRefereeOf} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <>
              <Section title="Classement">
                <CardGrid list>
                  {t.standings.map((s, i) => (
                    <Card key={s.name}>
                      <CardRow>
                        <h3>
                          <b className="me-1.5">{i + 1}.</b>
                          {s.name}
                        </h3>
                      </CardRow>
                      <Pills>
                        <Pill tone="g">{s.wins} V</Pill>
                        <Pill tone="r">{s.losses} D</Pill>
                        <Pill tone="b">
                          Sets {s.setsFor}-{s.setsAgainst}
                        </Pill>
                      </Pills>
                    </Card>
                  ))}
                </CardGrid>
              </Section>
              {byRound.map((ms, r) => (
                <Section key={r} title={`Journée ${r + 1}`}>
                  <CardGrid>
                    {ms.map((m) => (
                      <MatchBox key={m.id} m={m} all={t.matches} manage={manage} onResult={setResult} onReferee={setRefereeOf} />
                    ))}
                  </CardGrid>
                </Section>
              ))}
            </>
          )
        ) : (
          <div className="mt-5">
            <EmptyState>{t.drawHidden ? 'Tableau en préparation : il sera publié par la direction technique.' : 'Le tableau sera publié après le tirage au sort.'}</EmptyState>
          </div>
        ))}

      {tab === 'schedule' && (
        <Section title="Planning des matchs">
          {scheduled.length ? (
            <CardGrid list>
              {scheduled.map((m) => (
                <Card key={m.id}>
                  <CardRow>
                    <h3>
                      {m.playerA.name.startsWith('À déterminer') ? (feederName(t.matches, m, 0) ?? m.playerA.name) : m.playerA.name} <span className="text-mut">contre</span>{' '}
                      {m.playerB.name.startsWith('À déterminer') ? (feederName(t.matches, m, 1) ?? m.playerB.name) : m.playerB.name}
                    </h3>
                  </CardRow>
                  <Pills>
                    <Pill tone="b">
                      {day(m.scheduledAt)} · {time(m.scheduledAt)}
                    </Pill>
                    <Pill tone="g">{m.court}</Pill>
                    <Pill tone="s">{m.roundLabel}</Pill>
                    {m.score && <Pill tone="g">{m.score}</Pill>}
                    {m.referee?.name && <Pill tone="b">Arbitre : {m.referee.name}</Pill>}
                    {m.resultHidden && m.status !== 'SCHEDULED' && <Pill tone="s">Résultat non public</Pill>}
                  </Pills>
                </Card>
              ))}
            </CardGrid>
          ) : (
            <EmptyState>{t.drawHidden ? 'Horaires en préparation : ils seront publiés avec le tableau.' : 'Les horaires sont fixés au tirage au sort.'}</EmptyState>
          )}
        </Section>
      )}

      {tab === 'conflicts' && manage && (
        <Section title="Entraînements touchés par le tournoi">
          <QueryState isPending={conflicts.isPending} error={conflicts.error} refetch={conflicts.refetch}>
            {conflicts.data?.length ? (
              <CardGrid list>
                {conflicts.data.map((c) => (
                  <Card key={c.slotId + c.date}>
                    <CardRow>
                      <h3>{c.group}</h3>
                    </CardRow>
                    <Pills>
                      <Pill tone="b">
                        {fD(c.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {c.startTime}–{c.endTime}
                      </Pill>
                      <Pill tone="r">{c.court}</Pill>
                      <Pill tone="s" className="card-text">{c.coaches.join(', ')}</Pill>
                      {c.change && <Pill tone="g">✓ {c.change.kind === 'MOVED' ? `Déplacée sur ${c.change.court}` : 'Reportée'}</Pill>}
                    </Pills>
                    {!c.change && (
                      <CardActions>
                        <Button onClick={() => (c.freeCourt ? resolve.mutate({ slotId: c.slotId, date: c.date, action: 'move' }) : toast('Aucun terrain libre à cet horaire : reportez la séance.'))} disabled={resolve.isPending}>
                          {c.freeCourt ? `Déplacer sur ${c.freeCourt.name}` : 'Aucun terrain libre'}
                        </Button>
                        <Button onClick={() => resolve.mutate({ slotId: c.slotId, date: c.date, action: 'postpone' })} disabled={resolve.isPending}>
                          Reporter
                        </Button>
                      </CardActions>
                    )}
                  </Card>
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucun entraînement sur les terrains et horaires du tournoi.</EmptyState>
            )}
          </QueryState>
          <Note>Déplacer : même horaire sur un terrain libre (éclairé après 18h). Reporter : séance annulée ce jour-là, à rattraper. Familles et entraîneurs sont prévenus.</Note>
        </Section>
      )}

      <TournamentForm open={editing} tournament={t} onClose={() => setEditing(false)} />
      <ResultModal tournamentId={t.id} match={result} onClose={() => setResult(undefined)} />
      <RefereeModal tournamentId={t.id} match={refereeOf} onClose={() => setRefereeOf(undefined)} />
      <ConfirmModal
        open={cancelling}
        title="Annuler le tournoi ?"
        text="Les matchs non joués sont supprimés et les terrains libérés."
        cta="Annuler le tournoi"
        withMotif
        pending={cancel.isPending}
        onConfirm={(reason) => cancel.mutate(reason)}
        onClose={() => setCancelling(false)}
      />
    </>
  );
}
