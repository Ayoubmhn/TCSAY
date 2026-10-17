import { Link } from 'react-router';
import { Card, CardRow, CardText } from '../../components/ui/Card';
import { Pill, Pills } from '../../components/ui/Pill';
import { apiUrl } from '../../lib/api';
import { fD } from '../../lib/format';
import { when, type EventSummary } from './types';

/** Carte d'un événement (liste, accueil). */
export function EventCard({ e }: { e: EventSummary }) {
  return (
    <Link to={`/evenements/${e.id}`} className="block">
      <Card className="h-full gap-3 overflow-hidden p-0">
        {e.posterUrl && (
          <div className="aspect-[16/9] bg-fld">
            <img src={apiUrl(e.posterUrl)} alt="" loading="lazy" className="h-full w-full object-cover" />
          </div>
        )}
        <div className={`flex flex-col gap-2 px-5 pb-5 ${e.posterUrl ? '' : 'pt-5'}`}>
          <CardRow>
            <h3>{e.title}</h3>
            <Pill tone="s">{e.tag}</Pill>
          </CardRow>
          <Pills>
            <Pill tone="b">{fD(e.date, { weekday: 'long', day: 'numeric', month: 'long' })}</Pill>
            {when(e) && <Pill tone="b">{when(e)}</Pill>}
            <Pill tone="g">{e.place}</Pill>
            {e.rsvp && e.myGoing && <Pill tone="g">Je participe ✓</Pill>}
            {e.rsvp && e.full && !e.myGoing && <Pill tone="r">Complet</Pill>}
            {e.canManage && !e.published && <Pill tone="s">Brouillon</Pill>}
            {e.archived && <Pill tone="r">Archivé</Pill>}
          </Pills>
          {e.rsvp ? (
            <CardText keep>
              {e.going} participant{e.going > 1 ? 's' : ''}
              {e.capacity ? ` sur ${e.capacity} places` : ''}
            </CardText>
          ) : (
            e.canManage && <CardText>Affichage seulement · {e.audienceLabel}</CardText>
          )}
        </div>
      </Card>
    </Link>
  );
}
