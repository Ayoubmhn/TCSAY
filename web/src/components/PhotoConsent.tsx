import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useAction } from '../lib/useAction';
import { Card, CardText } from './ui/Card';
import { Segmented } from './ui/Segmented';

type Consent = { mode: 'OPT_IN' | 'OPT_OUT'; players: { id: string; name: string; consent: boolean | null; at: string | null }[] };

/** Autorisation photo (albums du club) : réponse de la famille pour chaque enfant, ou du joueur pour lui-même. */
export function PhotoConsent() {
  const q = useQuery({ queryKey: ['album-consent'], queryFn: () => api.get<Consent>('/albums/consent') });
  const set = useAction(({ id, consent }: { id: string; consent: boolean }) => api.put(`/albums/consent/${id}`, { consent }), {
    invalidate: [['album-consent'], ['albums']],
    success: (_r, v) => (v.consent ? 'Autorisation photo accordée.' : 'Autorisation photo refusée : les photos identifiées restent visibles de votre famille seulement.'),
  });
  if (!q.data?.players.length) return null;
  return (
    <Card className="gap-3">
      {q.data.players.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{p.name}</span>
          <Segmented<'yes' | 'no'>
            label={`Autorisation photo de ${p.name}`}
            value={p.consent === true ? 'yes' : p.consent === false ? 'no' : ('' as 'yes')}
            onChange={(v) => set.mutate({ id: p.id, consent: v === 'yes' })}
            options={[
              { value: 'yes', label: 'J’autorise' },
              { value: 'no', label: 'Je refuse' },
            ]}
          />
          {p.at && <span className="w-full text-xs text-mut">Réponse du {formatDate(p.at)}</span>}
        </div>
      ))}
      <CardText keep>
        {q.data.mode === 'OPT_IN'
          ? 'Sans votre accord, une photo où votre enfant est identifié n’est visible que de votre famille.'
          : 'Sauf refus, votre enfant peut apparaître dans les albums du club (jamais publics).'}{' '}
        Vous pouvez aussi retirer une photo précise depuis l’album.
      </CardText>
    </Card>
  );
}
