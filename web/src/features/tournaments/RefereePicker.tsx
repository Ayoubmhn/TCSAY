import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TextField } from '../../components/ui/Field';
import { Pill } from '../../components/ui/Pill';
import { api } from '../../lib/api';

export type Referee = { userId: string | null; name: string | null };
type Candidate = { id: string; name: string; roles: string };

/**
 * Arbitre : n'importe quel compte du club (joueur, parent, entraîneur, personnel : il saisit alors les points depuis
 * Matchs), ou une personne hors club dont on saisit le nom.
 */
export function RefereePicker({ label = 'Arbitre', value, onChange }: { label?: string; value: Referee | null; onChange: (v: Referee | null) => void }) {
  const [mode, setMode] = useState<'club' | 'outside'>(value?.name && !value.userId ? 'outside' : 'club');
  const [q, setQ] = useState('');
  const found = useQuery({
    queryKey: ['referee-candidates', q],
    queryFn: () => api.get<Candidate[]>('/tournaments/referee-candidates', { q }),
    enabled: mode === 'club' && q.trim().length >= 2,
  });
  const chip = (on: boolean) => `rounded-full px-3 py-1.5 text-[13px] ${on ? 'bg-sel text-white' : 'bg-fld text-fg'}`;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-mut">{label}</span>
        <button type="button" className={chip(mode === 'club')} aria-pressed={mode === 'club'} onClick={() => setMode('club')}>
          Membre du club
        </button>
        <button type="button" className={chip(mode === 'outside')} aria-pressed={mode === 'outside'} onClick={() => setMode('outside')}>
          Hors club
        </button>
        {value?.name && (
          <button type="button" onClick={() => onChange(null)} aria-label="Retirer l’arbitre">
            <Pill tone="g">{value.name} ✕</Pill>
          </button>
        )}
      </div>
      {mode === 'outside' ? (
        <TextField
          label="Nom de l’arbitre (hors club)"
          value={value && !value.userId ? (value.name ?? '') : ''}
          maxLength={80}
          onChange={(e) => onChange(e.target.value.trim() ? { userId: null, name: e.target.value } : null)}
        />
      ) : (
        <>
          <TextField label="Rechercher (nom ou prénom)" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="2 lettres au moins" />
          {q.trim().length >= 2 && (
            <div className="flex max-h-[200px] flex-col gap-1 overflow-y-auto" role="listbox" aria-label="Arbitres possibles">
              {found.data?.length === 0 && <span className="px-1 text-[13px] text-mut">Aucun compte trouvé : choisissez « Hors club ».</span>}
              {found.data?.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={value?.userId === c.id}
                  onClick={() => {
                    onChange({ userId: c.id, name: c.name });
                    setQ('');
                  }}
                  className={`flex items-center justify-between gap-2 rounded-[14px] px-3 py-2 text-start ${value?.userId === c.id ? 'bg-pri text-white' : 'bg-fld hover:bg-btn'}`}
                >
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="flex-none text-xs opacity-75">{c.roles}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
