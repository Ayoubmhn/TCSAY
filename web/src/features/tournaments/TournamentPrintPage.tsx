import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { FitWidth } from '../../components/ui/FitWidth';
import { TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { api } from '../../lib/api';
import { bracketLines, dateRange, known, longSlot, nameParts, percent, shortSlot, standings, winnerScore } from './tournamentSheet';
import type { TMatch, TournamentDetail } from './types';

/** Couleurs de la feuille imprimée : horaires en rouge, vainqueur surligné (comme les feuilles de la fédération). */
const RED = '#c0262d';
const WIN = '#dff3a8';
const SEED = '#c9e9fb';

type Settings = { title: string; subtitle: string; referee: string; schedule: boolean };

function useSettings(t: TournamentDetail | undefined) {
  const key = t ? `tcsay-impression-tournoi-${t.id}` : '';
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (!t) return;
    let saved: Partial<Settings> = {};
    try {
      saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Settings>;
    } catch {
      /* réglages absents */
    }
    setS({
      title: saved.title ?? (t.format === 'KNOCKOUT' ? 'Tableau final' : `Tournoi ${t.name}`),
      subtitle: saved.subtitle ?? (t.format === 'KNOCKOUT' ? t.eligibilityLabel : 'Groupe'),
      referee: saved.referee ?? t.referee?.name ?? '',
      schedule: saved.schedule ?? true,
    });
  }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (patch: Partial<Settings>) =>
    setS((prev) => {
      const next = { ...prev!, ...patch };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* stockage indisponible */
      }
      return next;
    });
  return [s, update] as const;
}

/** En-tête commun : logo du club, titres soulignés, tournoi, dates, juge arbitre. */
function SheetHeader({ t, s }: { t: TournamentDetail; s: Settings }) {
  return (
    <div className="flex items-start gap-4 border-b-[2.5px] border-black pb-2">
      <img src="/logo-tcsay.png" alt="" className="h-[22mm] w-[22mm] object-contain" />
      <div className="flex flex-1 flex-col gap-1">
        <div className="text-center text-[15px] leading-tight font-semibold uppercase underline [font-variant:small-caps]">
          <div>{s.title}</div>
          {s.subtitle && <div>{s.subtitle}</div>}
        </div>
        <div className="grid grid-cols-[22mm_1fr_auto] items-baseline gap-x-3 text-[10.5px]">
          <b className="uppercase underline">Tournoi :</b>
          <span>{t.name}</span>
          <span />
          <b className="uppercase underline">Date :</b>
          <span>{dateRange(t.startDate, t.endDate)}</span>
          <span className="flex gap-3">
            <b className="uppercase underline">Le juge arbitre :</b>
            <span className="min-w-[38mm] border-b border-black">{s.referee}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Information d'un match : horaire (rouge) avant, score du vainqueur après. */
function matchInfo(m: TMatch | undefined, t: TournamentDetail, s: Settings, short = true) {
  if (!m) return null;
  if ((m.status === 'FINISHED' || m.status === 'ABANDONED') && m.winner !== null) return { text: winnerScore(m, t), red: false };
  if (m.status === 'LIVE') return { text: 'En cours', red: true };
  if (s.schedule && m.scheduledAt) return { text: short ? shortSlot(m.scheduledAt) : longSlot(m.scheduledAt), red: true };
  return null;
}

/** Tableau à élimination directe : lignes 1 à N (exempts « BYE »), puis les tours et le vainqueur. */
function KnockoutSheet({ t, s }: { t: TournamentDetail; s: Settings }) {
  const lines = bracketLines(t);
  const size = lines.length;
  const R = t.rounds;
  const W = 190;
  const top = 6;
  const rowH = Math.min(7.2, 232 / size);
  const fs = Math.min(2.6, rowH * 0.42);
  const xs = { no: 0, st: 6, cl: 13, ts: 22, nom: 28.5, pre: 62, club: 88, end: 103 };
  const cw = (W - xs.end) / (R + 1);
  const H = top + size * rowH + 6;
  const byName = new Map(t.entries.map((e) => [e.name, e]));
  const short = (name: string, width: number) => {
    const e = byName.get(name);
    const text = e ? nameParts(e).last : name.toUpperCase();
    const max = Math.floor(width / (fs * 0.62));
    return text.length > max ? `${text.slice(0, max - 1)}.` : text;
  };
  const yRow = (i: number) => top + (i + 1) * rowH;
  // Hauteur des lignes d'entrée de chaque tour : milieu des deux lignes du tour précédent.
  const yIn: number[][] = [Array.from({ length: size }, (_, i) => yRow(i))];
  for (let r = 1; r <= R; r++) yIn.push(Array.from({ length: size / 2 ** r }, (_, k) => (yIn[r - 1][2 * k] + yIn[r - 1][2 * k + 1]) / 2));
  const match = (r: number, p: number) => t.matches.find((m) => m.round === r && m.position === p);
  const final = match(R, 0);
  const champion = final && final.winner !== null && (final.status === 'FINISHED' || final.status === 'ABANDONED') ? (final.winner === 0 ? final.playerA.name : final.playerB.name) : null;
  const els: ReactNode[] = [];
  const text = (x: number, y: number, v: string, o: { bold?: boolean; color?: string; anchor?: 'start' | 'middle' | 'end'; size?: number } = {}) =>
    els.push(
      <text key={els.length} x={x} y={y} fontSize={o.size ?? fs} fontWeight={o.bold ? 600 : 400} fill={o.color ?? '#111'} textAnchor={o.anchor ?? 'start'}>
        {v}
      </text>,
    );
  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.25) => els.push(<line key={els.length} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#111" strokeWidth={w} />);

  // En-têtes de colonnes.
  [
    ['St', xs.st + 1],
    ['CL', xs.cl + 1.5],
    ['Ts', xs.ts + 1],
    ['Nom', xs.nom],
    ['Prénom', xs.pre],
    ['Club', xs.club],
  ].forEach(([v, x]) => text(x as number, top - 1.5, v as string, { bold: true, size: 2.7 }));
  els.push(<rect key="ts" x={xs.ts} y={top} width={xs.nom - xs.ts - 0.5} height={size * rowH} fill={SEED} />);
  // Lignes des joueurs.
  lines.forEach((l, i) => {
    const y = yRow(i);
    const ty = y - rowH * 0.25;
    text(xs.no + 3, ty, String(i + 1), { bold: true, anchor: 'end' });
    line(xs.st, y, xs.end + cw, y);
    if (!l) return;
    if ('bye' in l) {
      text(xs.nom, ty, 'BYE');
      return;
    }
    const n = nameParts(l);
    const seeded = Boolean(l.seed);
    if (l.seed) text(xs.ts + 3, ty, String(l.seed), { bold: true, anchor: 'middle' });
    text(xs.nom, ty, n.last.slice(0, 22), { bold: seeded });
    text(xs.pre, ty, n.first.slice(0, 18), { bold: seeded });
    text(xs.club, ty, l.club ?? n.club ?? '', { bold: seeded });
  });
  // Tours : vertical qui relie deux lignes, nom du vainqueur et horaire / score sur la ligne suivante.
  for (let r = 1; r <= R; r++) {
    const x1 = xs.end + r * cw;
    for (let p = 0; p < size / 2 ** r; p++) {
      const ya = yIn[r - 1][2 * p];
      const yb = yIn[r - 1][2 * p + 1];
      line(x1, ya, x1, yb);
      const yo = yIn[r][p];
      line(x1, yo, x1 + cw, yo);
      // Nom porté sur la ligne de sortie : joueur du tour suivant (ou exempt déjà qualifié), sinon vainqueur de la finale.
      const next = r < R ? match(r + 1, Math.floor(p / 2)) : undefined;
      const name = r < R ? (p % 2 ? next?.playerB.name : next?.playerA.name) : champion;
      if (name && known(name)) text(x1 + 0.8, yo - rowH * 0.22, short(name, cw - 1.5), { bold: true });
      const info = matchInfo(match(r, p), t, s);
      if (info) text(x1 + 0.8, yo + fs + 0.6, info.text, { color: info.red ? RED : '#111', bold: info.red, size: fs * 0.92 });
    }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={`${W}mm`} height={`${H}mm`} className="block font-[Montserrat]">
      {els}
    </svg>
  );
}

/** Poule (championnat) : liste des joueurs, journées avec horaires ou résultats, classement final. */
function GroupSheet({ t, s }: { t: TournamentDetail; s: Settings }) {
  const players = t.entries.filter((e) => e.status === 'CONFIRMED');
  const num = new Map(players.map((e, i) => [e.name, i + 1]));
  const label = (name: string) => {
    const e = players.find((x) => x.name === name);
    if (!e) return name.toUpperCase();
    const n = nameParts(e);
    return `${n.last} ${n.first.toUpperCase()}`.trim();
  };
  const rounds = Array.from({ length: t.rounds }, (_, r) => t.matches.filter((m) => m.round === r + 1).sort((a, b) => a.position - b.position));
  const rows = standings(t, players.map((e) => e.name));
  const anyResult = t.matches.some((m) => (m.status === 'FINISHED' || m.status === 'ABANDONED') && m.winner !== null);
  const cell = 'border border-black px-1.5 py-[2px]';
  const tableRows = Math.max(6, players.length);
  return (
    <div className="flex flex-col gap-3 text-[10.5px]">
      <table className="ms-[12mm] w-[105mm] border-collapse">
        <thead>
          <tr>
            <th className="w-[7mm]" />
            <th className={`${cell} border-2 bg-btn text-center font-semibold`}>Joueur</th>
            <th className={`${cell} w-[28mm] border-2 bg-btn text-center font-semibold`}>Club</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: tableRows }, (_, i) => {
            const e = players[i];
            const n = e ? nameParts(e) : null;
            return (
              <tr key={i}>
                <td className={`${cell} text-center`}>{i + 1}</td>
                <td className={`${cell} text-center`}>{n ? `${n.last} ${n.first}`.trim() : ''}</td>
                <td className={`${cell} text-center`}>{e ? (e.club ?? n?.club ?? '') : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex flex-col">
        <div className="mb-0.5 text-end font-semibold">Résultats</div>
        {rounds.map((ms, r) => {
          const playing = new Set(ms.flatMap((m) => [m.playerA.name, m.playerB.name]));
          const byes = players.filter((e) => !playing.has(e.name));
          return (
            <div key={r} className="flex flex-col">
              <div className="font-semibold">{r === 0 ? '1ère' : `${r + 1}ème`} Journée</div>
              {ms.map((m) => {
                const info = matchInfo(m, t, s, false);
                const won = (i: 0 | 1) => (m.status === 'FINISHED' || m.status === 'ABANDONED') && m.winner === i;
                return (
                  <div key={m.id} className="grid grid-cols-[10mm_62mm_10mm_8mm_62mm_1fr] items-center py-[1.5px]">
                    <span className="text-end font-semibold">{num.get(m.playerA.name) ?? ''}</span>
                    <span className="ms-2 px-1" style={won(0) ? { background: WIN } : undefined}>
                      {label(m.playerA.name)}
                    </span>
                    <span className="text-center">-</span>
                    <span className="text-center">{num.get(m.playerB.name) ?? ''}</span>
                    <span className="px-1" style={won(1) ? { background: WIN } : undefined}>
                      {label(m.playerB.name)}
                    </span>
                    <span className="text-end font-semibold" style={{ color: info?.red ? RED : '#111' }}>
                      {info?.text ?? ''}
                    </span>
                  </div>
                );
              })}
              {byes.map((e) => (
                <div key={e.id} className="grid grid-cols-[10mm_62mm_10mm_8mm_62mm_1fr] items-center py-[1.5px]">
                  <span className="text-end font-semibold">{num.get(e.name)}</span>
                  <span className="ms-2 px-1">{label(e.name)}</span>
                  <span className="text-center">-</span>
                  <span className="text-center">Bye</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th colSpan={11} className={`${cell} border-2 text-center font-semibold`}>
              Classement final
            </th>
          </tr>
          <tr>
            <th colSpan={2} />
            {['Pts', 'G', 'P', 'SG', 'SP', 'SA', 'JG', 'JP', 'JA'].map((h) => (
              <th key={h} className="py-[2px] text-center font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: tableRows }, (_, i) => {
            const r = anyResult ? rows[i] : undefined;
            const e = r ? players.find((x) => x.name === r.name) : undefined;
            const n = e ? nameParts(e) : null;
            return (
              <tr key={i}>
                <td className={`${cell} w-[10mm] text-center text-[12px] font-semibold`}>{i + 1}</td>
                <td className={`${cell} w-[48mm] text-center`}>{r ? (n?.first ? `${n.first} ${n.last}` : r.name) : ''}</td>
                {(r ? [r.pts, r.g, r.p, r.sg, r.sp, percent(r.sg, r.sp), r.jg, r.jp, percent(r.jg, r.jp)] : Array(9).fill('')).map((v, j) => (
                  <td key={j} className={`${cell} text-center`}>
                    {v}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="m-0 text-[8.5px] text-mut">
        Pts : victoire 2, défaite 1 (forfait 0) · G / P : matchs gagnés / perdus · SG / SP : sets gagnés / perdus · SA : % de sets · JG / JP : jeux (super tie-break = 1 jeu) · JA : % de jeux.
      </p>
    </div>
  );
}

/**
 * Feuille de tournoi à imprimer ou enregistrer en PDF (A4 portrait), sur le modèle des feuilles de la fédération :
 * tableau final (élimination directe, exempts « BYE ») ou poule (journées, classement final).
 */
export function TournamentPrintPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['tournament', id], queryFn: () => api.get<TournamentDetail>(`/tournaments/${id}`) });
  const t = q.data;
  const [s, set] = useSettings(t);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 portrait; margin: 0; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  useEffect(() => {
    if (!t) return;
    const previous = document.title;
    document.title = `${t.name} - ${t.format === 'KNOCKOUT' ? 'tableau' : 'poule'}`;
    return () => {
      document.title = previous;
    };
  }, [t]);

  const drawn = t && t.matches.length > 0;
  return (
    <div className="flex min-h-full flex-col items-center gap-4 bg-bg px-4 py-6 print:p-0">
      <div className="no-print flex w-full max-w-[860px] flex-col gap-3">
        <h1 className="m-0 text-[23px] font-semibold">Feuille du tournoi</h1>
        {t && s && (
          <>
            <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-3">
              <TextField label="Titre" value={s.title} onChange={(e) => set({ title: e.target.value })} />
              <TextField label="Sous-titre (catégorie, groupe…)" value={s.subtitle} onChange={(e) => set({ subtitle: e.target.value })} />
              <TextField label="Juge arbitre" value={s.referee} onChange={(e) => set({ referee: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.schedule} onChange={(e) => set({ schedule: e.target.checked })} />
              Afficher les horaires des matchs à venir (en rouge)
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => window.print()} disabled={!drawn}>
                Imprimer / PDF
              </Button>
              <Button onClick={() => window.close()}>Fermer</Button>
            </div>
            <Note>
              {drawn
                ? 'Dans la fenêtre d’impression : A4 portrait, marges « aucune », échelle 100 %, sans en-têtes ni pieds de page ; pour un PDF, destination « Enregistrer au format PDF ». Les résultats saisis apparaissent à la place des horaires, le vainqueur surligné.'
                : 'Faites d’abord le tirage au sort : la feuille se remplit avec le tableau ou les journées.'}
            </Note>
          </>
        )}
      </div>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {t && s && drawn && (
          <div className="print-area w-full max-w-[860px] overflow-auto rounded-[24px] border-[1.5px] border-line bg-fld p-4">
            <FitWidth>
              <div className="a4-sheet box-border flex w-[210mm] flex-col gap-3 bg-white px-[10mm] py-[9mm] text-[#111]" style={{ minHeight: '297mm' }}>
                <SheetHeader t={t} s={s} />
                {t.format === 'KNOCKOUT' ? <KnockoutSheet t={t} s={s} /> : <GroupSheet t={t} s={s} />}
                <div className="mt-auto flex justify-end pe-[20mm]">
                  <div className="w-[50mm] border-t border-black pt-1 text-center text-[11px]">Le Juge Arbitre</div>
                </div>
              </div>
            </FitWidth>
          </div>
        )}
      </QueryState>
    </div>
  );
}

