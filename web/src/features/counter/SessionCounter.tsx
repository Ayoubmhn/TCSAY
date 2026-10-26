import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../../auth/AuthContext';
import { Card, CardGrid, CardRow, CardSubtitle, EmptyState, Kpi } from '../../components/ui/Card';
import { FilterSelect, Filters } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pill } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { fD, fullName, todayIso } from '../../lib/format';
import { hm } from '../../lib/timetable';
import type { Coach, CounterSummary, GroupCounter } from '../../lib/types';
import { Button } from '../../components/ui/Button';
import { ProgramSessionModal, type ProgramInit } from './ProgramSession';

const short = (iso: string) => fD(iso, { day: 'numeric', month: 'short' });
const plural = (n: number, word: string) => `${n} ${word}${Math.abs(n) > 1 ? 's' : ''}`;

/** Périodes proposées : depuis le début de la saison, ce mois, le mois dernier, 30 derniers jours. */
export function periodRange(period: string): { from?: string; to?: string } {
  const today = todayIso();
  const [y, m] = today.split('-').map(Number);
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  if (period === 'month') return { from: iso(y, m, 1) };
  if (period === 'last-month') {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return { from: iso(py, pm, 1), to: iso(py, pm, new Date(Date.UTC(py, pm, 0)).getUTCDate()) };
  }
  if (period === '30') {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 30);
    return { from: d.toISOString().slice(0, 10) };
  }
  return {};
}

export const PERIODS = [
  { v: 'season', label: 'Depuis le début de la saison' },
  { v: 'month', label: 'Ce mois' },
  { v: 'last-month', label: 'Le mois dernier' },
  { v: '30', label: '30 derniers jours' },
];

/** Pastille du solde d'un groupe : en retard (séances dues), en avance (séances en plus) ou à jour. */
export function BalancePill({ c }: { c: GroupCounter }) {
  if (c.owed > 0) {
    const min = c.missed.filter((m) => !m.madeUp?.done).reduce((t, m) => t + m.minutes, 0);
    return <Pill tone="r">{`−${plural(c.owed, 'séance')} · ${hm(min)}`}</Pill>;
  }
  if (c.balance.sessions > 0) return <Pill tone="g">{`+${plural(c.balance.sessions, 'séance')} · ${hm(c.balance.minutes)}`}</Pill>;
  return <Pill tone="g">À jour</Pill>;
}

/** Lignes du détail : séances manquées (à rattraper, rattrapage prévu ou fait) et séances en plus non utilisées. */
export function CounterLines({ c, limit = 6, onProgram }: { c: GroupCounter; limit?: number; onProgram?: (init: ProgramInit) => void }) {
  const lines = [
    ...c.missed.map((m) => ({
      key: `m${m.slotId}${m.date}`,
      date: m.date,
      text: `${short(m.date)} · ${m.reason}`,
      pill: m.madeUp?.done ? (
        <Pill tone="g">{`Rattrapée le ${short(m.madeUp.date)}`}</Pill>
      ) : m.madeUp ? (
        <Pill tone="b">{`Rattrapage prévu le ${short(m.madeUp.date)}`}</Pill>
      ) : onProgram ? (
        <span className="inline-flex items-center gap-1.5">
          <Pill tone="s">À rattraper</Pill>
          <button
            type="button"
            onClick={() => onProgram({ groupId: c.group.id, makeup: { slotId: m.slotId, date: m.date } })}
            className="rounded-full bg-pri px-3 py-1.5 text-[12.5px] font-semibold text-white"
            aria-label={`Programmer le rattrapage du ${short(m.date)}`}
          >
            Programmer
          </button>
        </span>
      ) : (
        <Pill tone="s">À rattraper</Pill>
      ),
    })),
    ...c.extra
      .filter((e) => !e.covers)
      .map((e) => ({
        key: `e${e.slotId}${e.date}`,
        date: e.date,
        text: `${short(e.date)} · ${e.reason}`,
        pill: <Pill tone="b">{e.done ? (e.oneOff?.type === 'SPECIAL' ? 'Donnée' : 'En avance') : 'Prévue'}</Pill>,
      })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  if (!lines.length) return <p className="m-0 text-[13px] text-mut">Aucune séance annulée ni en plus sur la période.</p>;
  return (
    <div className="flex flex-col">
      {lines.slice(0, limit).map((l) => (
        <div key={l.key} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-line py-2 text-[13.5px] first:border-t-0">
          <span className="min-w-[140px] flex-1">{l.text}</span>
          <span className="shrink-0">{l.pill}</span>
        </div>
      ))}
      {lines.length > limit && <span className="pt-1 text-[12.5px] text-mut">{`… et ${lines.length - limit} autre${lines.length - limit > 1 ? 's' : ''}`}</span>}
    </div>
  );
}

/** Barre : données (vert) sur prévues, part due en rose, séances en plus en indigo. */
export function CounterBar({ c }: { c: GroupCounter }) {
  const total = Math.max(c.planned.sessions, c.given.sessions, 1);
  const given = Math.min(c.given.sessions, c.planned.sessions);
  const ahead = Math.max(0, c.given.sessions - c.planned.sessions);
  return (
    <div className="flex h-[9px] overflow-hidden rounded-full bg-fld" aria-hidden="true">
      <i className="block h-full bg-[#2f7a4d]" style={{ width: `${(given / total) * 100}%` }} />
      {c.owed > 0 && <i className="block h-full bg-[#fdb3b0]" style={{ width: `${(c.owed / total) * 100}%` }} />}
      {ahead > 0 && <i className="block h-full bg-pri" style={{ width: `${(ahead / total) * 100}%` }} />}
    </div>
  );
}

function GroupCounterCard({ c, admin, onProgram }: { c: GroupCounter; admin: boolean; onProgram?: (init: ProgramInit) => void }) {
  const cancelled = c.missed.length;
  return (
    <Card>
      <CardRow>
        <h3>{admin ? <Link to={`/admin/groupes/${c.group.id}`}>{c.group.name}</Link> : c.group.name}</h3>
        <BalancePill c={c} />
      </CardRow>
      <CounterBar c={c} />
      <CardSubtitle>
        {`Prévues ${c.planned.sessions} · données ${c.given.sessions}${cancelled ? ` · annulées ${cancelled}` : ''}${c.extra.length ? ` · en plus ${c.extra.length}` : ''}`}
      </CardSubtitle>
      <CounterLines c={c} onProgram={onProgram} />
    </Card>
  );
}

/**
 * Compteur des séances (direction : tous les groupes, filtre entraîneur ; entraîneur : ses groupes) : prévues, données,
 * à rattraper, en avance. Les absences des joueurs ne sont jamais dues par le club.
 */
export function SessionCounterPage({ scope }: { scope: 'admin' | 'coach' }) {
  const [period, setPeriod] = useState('season');
  const [coachId, setCoachId] = useState('');
  const range = periodRange(period);
  const params = new URLSearchParams({ ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}), ...(coachId ? { coachId } : {}) }).toString();
  const path = `${scope === 'admin' ? '/session-counter' : '/session-counter/mine'}${params ? `?${params}` : ''}`;
  const q = useQuery({ queryKey: ['session-counter', scope, period, coachId], queryFn: () => api.get<CounterSummary>(path) });
  const coaches = useQuery({ queryKey: ['coaches'], queryFn: () => api.get<Coach[]>('/coaches'), enabled: scope === 'admin' });
  const d = q.data;
  const me = useMe();
  const canProgram = scope === 'admin' && me.role === 'ADMIN' && me.permissions.includes('groups.manage');
  const [program, setProgram] = useState<ProgramInit | null>(null);

  return (
    <>
      <PageHeader
        title="Compteur des séances"
        subtitle={scope === 'admin' ? 'Découvrez, pour chaque groupe, les séances prévues, données, annulées et à rattraper.' : 'Découvrez les séances prévues, données et à rattraper de vos groupes.'}
        action={
          canProgram ? (
            <Button variant="primary" onClick={() => setProgram({})}>
              + Programmer une séance
            </Button>
          ) : undefined
        }
      />
      {program && <ProgramSessionModal init={program} onClose={() => setProgram(null)} />}
      <Filters>
        <FilterSelect label="Période" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map((p) => (
            <option key={p.v} value={p.v}>
              {p.label}
            </option>
          ))}
        </FilterSelect>
        {scope === 'admin' && (
          <FilterSelect label="Entraîneur" value={coachId} onChange={(e) => setCoachId(e.target.value)}>
            <option value="">Tous les entraîneurs</option>
            {coaches.data
              ?.filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {fullName(c).trim()}
                </option>
              ))}
          </FilterSelect>
        )}
      </Filters>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {d && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 min-[761px]:grid-cols-4">
              {[
                { n: d.totals.planned, label: 'séances prévues' },
                { n: d.totals.given, label: 'données' },
                { n: d.totals.owed, label: 'en retard (à rattraper)', color: d.totals.owed ? 'text-[#c2410c]' : '' },
                { n: d.totals.ahead, label: 'en avance (stages, séances en plus)', color: d.totals.ahead ? 'text-[#2f7a4d]' : '' },
              ].map((k) => (
                <div key={k.label} className="flex flex-col gap-1 rounded-[20px] bg-fld px-4 py-3.5">
                  <span className={k.color}>
                    <Kpi>{k.n}</Kpi>
                  </span>
                  <span className="text-[13px] text-mut">{k.label}</span>
                </div>
              ))}
            </div>
            {d.groups.length ? (
              <CardGrid>
                {d.groups.map((c) => (
                  <GroupCounterCard key={c.group.id} c={c} admin={scope === 'admin'} onProgram={canProgram ? setProgram : undefined} />
                ))}
              </CardGrid>
            ) : (
              <EmptyState>Aucun groupe sur cette période.</EmptyState>
            )}
          </>
        )}
      </QueryState>
      <Note>
        Prévues = horaire habituel de la période (vacances non dues retirées). Une séance annulée par le club (entraîneur absent sans remplaçant,
        terrain pris par un tournoi, pluie, fermeture) compte « à rattraper » ; une séance en plus (stage, rattrapage) la couvre. Les absences d’un
        joueur ne sont jamais dues par le club.
        {scope === 'admin' && (
          <>
            {' '}
            Pour rattraper : <Link to="/admin/emploi-du-temps" className="text-pri hover:underline">Emploi du temps</Link> › « + Nouvelles vacances / stage » ›
            séances en plus. Pour annuler une séance (pluie…) : Planning › fiche de la séance.
          </>
        )}
      </Note>
    </>
  );
}
