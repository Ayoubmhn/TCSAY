import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AttendanceSheet, AttendanceStatus } from '../lib/types';
import { useAction } from '../lib/useAction';
import { Button } from './ui/Button';
import { TextField } from './ui/Field';
import { QueryState } from './ui/Loading';
import { Pill } from './ui/Pill';
import { Segmented } from './ui/Segmented';

type Mark = { status: AttendanceStatus; reason: string };

const clock = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Tunis' });

/**
 * Feuille de présence d'une séance : présent, en retard ou absent pour chaque joueur, motif facultatif.
 * L'entraîneur ne peut enregistrer que pendant la séance en cours ; la direction peut corriger ensuite.
 */
export function AttendanceSheetForm({ slotId, date, onSaved }: { slotId: string; date: string; onSaved?: () => void }) {
  const sheet = useQuery({
    queryKey: ['attendance', slotId, date],
    queryFn: () => api.get<AttendanceSheet>('/attendance', { slotId, date }),
  });
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  useEffect(() => {
    if (sheet.data) {
      setMarks(Object.fromEntries(sheet.data.entries.map((e) => [e.playerId, { status: e.status ?? 'PRESENT', reason: e.reason ?? '' }])));
    }
  }, [sheet.data]);

  const save = useAction(
    () =>
      api.put('/attendance', {
        slotId,
        date,
        entries: Object.entries(marks).map(([playerId, m]) => ({ playerId, status: m.status, reason: m.reason.trim() || undefined })),
      }),
    { invalidate: [['sessions'], ['attendance']], success: 'Présences enregistrées.', onSuccess: onSaved },
  );

  const d = sheet.data;
  const count = (st: AttendanceStatus) => Object.values(marks).filter((m) => m.status === st).length;

  return (
    <QueryState isPending={sheet.isPending} error={sheet.error} refetch={sheet.refetch}>
      {d && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {d.editable ? (
              <Pill tone="g">Pointage ouvert jusqu’à {clock(d.closesAt)}</Pill>
            ) : new Date(d.opensAt) > new Date() ? (
              <Pill tone="s">Pointage à partir de {clock(d.opensAt)}</Pill>
            ) : (
              <Pill tone="r">Pointage fermé depuis {clock(d.closesAt)}</Pill>
            )}
            <Pill tone="g">{count('PRESENT')} présent(s)</Pill>
            <Pill tone="b">{count('LATE')} en retard</Pill>
            <Pill tone="r">{count('ABSENT')} absent(s)</Pill>
          </div>
          <div>
            {d.entries.map((e) => {
              const m = marks[e.playerId] ?? { status: 'PRESENT' as AttendanceStatus, reason: '' };
              const set = (patch: Partial<Mark>) => setMarks((x) => ({ ...x, [e.playerId]: { ...m, ...patch } }));
              return (
                <div key={e.playerId} className="flex flex-col gap-2 border-b-[1.5px] border-line py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <span className="font-medium">
                      {e.firstName} {e.lastName}
                    </span>
                    <Segmented<AttendanceStatus>
                      label={`Présence de ${e.firstName}`}
                      value={m.status}
                      onChange={(status) => d.editable && set({ status })}
                      options={[
                        { value: 'PRESENT', label: 'Présent' },
                        { value: 'LATE', label: 'Retard' },
                        { value: 'ABSENT', label: 'Absent' },
                      ]}
                    />
                  </div>
                  {m.status !== 'PRESENT' && (
                    <TextField
                      label={m.status === 'LATE' ? 'Retard : précision (facultatif)' : 'Motif d’absence (facultatif)'}
                      value={m.reason}
                      disabled={!d.editable}
                      onChange={(ev) => set({ reason: ev.target.value })}
                    />
                  )}
                </div>
              );
            })}
            {d.entries.length === 0 && <span className="text-mut">Aucun joueur dans ce groupe.</span>}
          </div>
          {d.editable && d.entries.length > 0 && (
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
                Enregistrer les présences
              </Button>
            </div>
          )}
        </div>
      )}
    </QueryState>
  );
}
