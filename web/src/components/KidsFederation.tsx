import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { useAction } from '../lib/useAction';
import { ActionIcon } from './ui/ActionIcon';
import { Card, CardText } from './ui/Card';
import { Pill, Pills } from './ui/Pill';

type Kid = { playerId: string; name: string; login: string | null; hasPassword: boolean };

/** Parent : comptes fédération (IJIN) de ses enfants, saisis par le club ; mot de passe affiché à la demande. */
export function KidsFederation() {
  const q = useQuery({ queryKey: ['federation-kids'], queryFn: () => api.get<Kid[]>('/me/federation/kids') });
  const [shown, setShown] = useState<Record<string, string>>({});
  const reveal = useAction((id: string) => api.post<{ password: string }>(`/me/federation/kids/${id}/reveal`).then((r) => ({ id, ...r })), {
    onSuccess: (r) => setShown((s) => ({ ...s, [r.id]: r.password })),
  });
  if (!q.data?.length) return null;
  return (
    <Card className="mt-3">
      <h3>Comptes IJIN de mes enfants</h3>
      {q.data.map((k) => (
        <div key={k.playerId} className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] bg-fld px-4 py-2.5">
          <span className="font-medium">{k.name}</span>
          <Pills>
            {k.login ? <Pill tone="g">{k.login}</Pill> : <Pill tone="s">Pas encore saisi par le club</Pill>}
            {shown[k.playerId] && <Pill tone="b">{shown[k.playerId]}</Pill>}
          </Pills>
          {k.hasPassword && !shown[k.playerId] && <ActionIcon kind="view" label="Afficher le mot de passe" onClick={() => reveal.mutate(k.playerId)} />}
        </div>
      ))}
      <CardText keep>Saisis par le club ; mot de passe chiffré, visible par les parents seulement.</CardText>
    </Card>
  );
}
