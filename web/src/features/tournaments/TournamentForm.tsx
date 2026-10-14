import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/Button';
import { SelectField, TextArea, TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { todayIso } from '../../lib/format';
import type { Category } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import type { TournamentBase } from './types';

type Court = { id: string; name: string; lit: boolean; active: boolean };

const chip = (on: boolean) => `rounded-full px-[14px] py-[7px] text-sm ${on ? 'bg-sel text-white' : 'bg-fld text-fg'}`;

/** Création ou modification d'un tournoi : identité, qui peut jouer, format, terrains et horaires. */
export function TournamentForm({ open, tournament, onClose }: { open: boolean; tournament?: TournamentBase; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories'), enabled: open });
  const courts = useQuery({ queryKey: ['courts'], queryFn: () => api.get<Court[]>('/courts'), enabled: open });
  const blank = {
    name: '',
    kind: 'INTERNAL' as TournamentBase['kind'],
    startDate: todayIso(),
    endDate: todayIso(),
    mode: 'cats' as 'cats' | 'age' | 'open',
    categoryIds: [] as string[],
    fromYear: '',
    toYear: '',
    gender: '' as '' | 'M' | 'F',
    format: 'KNOCKOUT' as TournamentBase['format'],
    maxPlayers: 16,
    fee: '',
    familyRequest: false,
    setsToWin: 2,
    games: 6,
    superTB: true,
    noAd: false,
    courtIds: [] as string[],
    dayStart: '09:00',
    dayEnd: '18:00',
    matchMinutes: 90,
    restMinutes: 60,
    notes: '',
  };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!open) return;
    if (!tournament) return setF(blank);
    const e = tournament.eligibility;
    setF({
      name: tournament.name,
      kind: tournament.kind,
      startDate: tournament.startDate,
      endDate: tournament.endDate,
      mode: e.mode,
      categoryIds: e.categoryIds ?? [],
      fromYear: e.fromYear ? String(e.fromYear) : '',
      toYear: e.toYear ? String(e.toYear) : '',
      gender: e.gender ?? '',
      format: tournament.format,
      maxPlayers: tournament.maxPlayers,
      fee: tournament.fee === null ? '' : String(tournament.fee),
      familyRequest: tournament.familyRequest,
      setsToWin: tournament.setsToWin,
      games: tournament.games,
      superTB: tournament.superTB,
      noAd: tournament.noAd,
      courtIds: tournament.courtIds,
      dayStart: tournament.dayStart,
      dayEnd: tournament.dayEnd,
      matchMinutes: tournament.matchMinutes,
      restMinutes: tournament.restMinutes,
      notes: tournament.notes ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tournament]);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = useAction(
    () => {
      const body = {
        name: f.name.trim(),
        kind: f.kind,
        startDate: f.startDate,
        endDate: f.endDate,
        eligibility: {
          mode: f.mode,
          categoryIds: f.mode === 'cats' ? f.categoryIds : [],
          fromYear: f.mode === 'age' && f.fromYear ? Number(f.fromYear) : undefined,
          toYear: f.mode === 'age' && f.toYear ? Number(f.toYear) : undefined,
          gender: f.gender || null,
        },
        format: f.format,
        maxPlayers: f.maxPlayers,
        fee: f.fee.trim() ? Number(f.fee.replace(',', '.')) : null,
        familyRequest: f.familyRequest,
        setsToWin: f.setsToWin,
        games: f.games,
        tiebreak: true,
        superTB: f.superTB,
        noAd: f.noAd,
        courtIds: f.courtIds,
        dayStart: f.dayStart,
        dayEnd: f.dayEnd,
        matchMinutes: f.matchMinutes,
        restMinutes: f.restMinutes,
        notes: f.notes.trim() || undefined,
      };
      return tournament ? api.patch(`/tournaments/${tournament.id}`, { ...body, version: tournament.version }).then(() => ({ id: tournament.id })) : api.post<{ id: string }>('/tournaments', body);
    },
    {
      invalidate: [['tournaments'], ['tournament']],
      success: tournament ? 'Tournoi modifié.' : 'Tournoi créé : inscriptions ouvertes.',
      onSuccess: (r) => (onClose(), !tournament && navigate(`/tournois/${r.id}`)),
    },
  );
  const submit = () => {
    if (!f.name.trim()) return toast('Nom du tournoi obligatoire.');
    if (f.mode === 'cats' && !f.categoryIds.length) return toast('Choisissez au moins une catégorie.');
    if (!f.courtIds.length) return toast('Choisissez au moins un terrain.');
    save.mutate();
  };

  return (
    <Modal
      open={open}
      size="lg"
      title={tournament ? 'Modifier le tournoi' : 'Nouveau tournoi'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" data-primary onClick={submit} disabled={save.isPending}>
            {tournament ? 'Enregistrer' : 'Ouvrir les inscriptions'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-2">
          <TextField label="Nom du tournoi *" value={f.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} placeholder="ex. Open jeunes de Sayada" />
          <SelectField label="Type" value={f.kind} onChange={(e) => set({ kind: e.target.value as typeof f.kind })}>
            <option value="INTERNAL">Tournoi interne</option>
            <option value="OPEN">Open (joueurs extérieurs)</option>
            <option value="CHAMPIONSHIP">Championnat</option>
            <option value="INTERCLUB">Rencontre inter-clubs</option>
          </SelectField>
          <TextField label="Du" type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} />
          <TextField label="Au" type="date" value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-mut">Qui peut jouer</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['cats', 'Par catégorie'],
                ['age', 'Par année de naissance'],
                ['open', 'Ouvert à tous'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={f.mode === k} className={chip(f.mode === k)} onClick={() => set({ mode: k })}>
                {l}
              </button>
            ))}
          </div>
          {f.mode === 'cats' && (
            <div className="flex flex-wrap gap-2">
              {categories.data?.map((c) => (
                <button key={c.id} type="button" aria-pressed={f.categoryIds.includes(c.id)} className={chip(f.categoryIds.includes(c.id))} onClick={() => set({ categoryIds: toggle(f.categoryIds, c.id) })}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {f.mode === 'age' && (
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Nés à partir de (année)" inputMode="numeric" value={f.fromYear} onChange={(e) => set({ fromYear: e.target.value })} placeholder="ex. 2012" />
              <TextField label="Nés jusqu’à (année)" inputMode="numeric" value={f.toYear} onChange={(e) => set({ toYear: e.target.value })} placeholder="ex. 2014" />
            </div>
          )}
          <div className="max-w-[260px]">
            <SelectField label="Genre" value={f.gender} onChange={(e) => set({ gender: e.target.value as typeof f.gender })}>
              <option value="">Mixte</option>
              <option value="M">Garçons</option>
              <option value="F">Filles</option>
            </SelectField>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-2">
          <SelectField label="Format" value={f.format} onChange={(e) => set({ format: e.target.value as typeof f.format })}>
            <option value="KNOCKOUT">Élimination directe (têtes de série, exempts)</option>
            <option value="ROUND_ROBIN">Championnat (tous contre tous)</option>
          </SelectField>
          <SelectField label="Places" value={f.maxPlayers} onChange={(e) => set({ maxPlayers: Number(e.target.value) })}>
            {[4, 6, 8, 12, 16, 24, 32, 64].map((n) => (
              <option key={n} value={n}>
                {n} joueurs
              </option>
            ))}
          </SelectField>
          <SelectField label="Matchs" value={`${f.setsToWin}-${f.games}`} onChange={(e) => { const [s, g] = e.target.value.split('-').map(Number); set({ setsToWin: s, games: g }); }}>
            <option value="2-6">2 sets gagnants de 6 jeux</option>
            <option value="2-4">2 sets gagnants de 4 jeux (jeunes)</option>
            <option value="1-6">1 set de 6 jeux</option>
            <option value="3-6">3 sets gagnants</option>
          </SelectField>
          <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-pri" checked={f.superTB} onChange={(e) => set({ superTB: e.target.checked })} /> Dernier set en super tie-break à 10</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-pri" checked={f.noAd} onChange={(e) => set({ noAd: e.target.checked })} /> Point décisif à 40-40</label>
          </div>
          <TextField label="Frais d’inscription (facultatif, DT)" inputMode="decimal" value={f.fee} onChange={(e) => set({ fee: e.target.value })} placeholder="Montant fixé par le bureau" />
          <label className="flex items-end gap-2 pb-3 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-pri" checked={f.familyRequest} onChange={(e) => set({ familyRequest: e.target.checked })} /> Les familles peuvent demander l’inscription
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-mut">Terrains réservés pour les matchs *</span>
          <div className="flex flex-wrap gap-2">
            {courts.data
              ?.filter((c) => c.active)
              .map((c) => (
                <button key={c.id} type="button" aria-pressed={f.courtIds.includes(c.id)} className={chip(f.courtIds.includes(c.id))} onClick={() => set({ courtIds: toggle(f.courtIds, c.id) })}>
                  {c.name}
                  {c.lit ? ' ☀' : ''}
                </button>
              ))}
          </div>
          <div className="grid grid-cols-2 gap-3 min-[561px]:grid-cols-4">
            <TextField label="Début de journée" type="time" value={f.dayStart} onChange={(e) => set({ dayStart: e.target.value })} />
            <TextField label="Fin de journée" type="time" value={f.dayEnd} onChange={(e) => set({ dayEnd: e.target.value })} />
            <SelectField label="Durée d’un match" value={f.matchMinutes} onChange={(e) => set({ matchMinutes: Number(e.target.value) })}>
              {[45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </SelectField>
            <SelectField label="Repos entre 2 matchs" value={f.restMinutes} onChange={(e) => set({ restMinutes: Number(e.target.value) })}>
              {[0, 30, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </SelectField>
          </div>
        </div>
        <TextArea label="Informations (règlement, balles, tenue…)" rows={2} maxLength={1000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>
    </Modal>
  );
}
