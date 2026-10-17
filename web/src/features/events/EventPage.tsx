import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { AlbumForm } from '../albums/AlbumForm';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { Card, CardGrid, CardRow, CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { QueryState } from '../../components/ui/Loading';
import { Note } from '../../components/ui/Note';
import { Pill, Pills } from '../../components/ui/Pill';
import { api, apiUrl } from '../../lib/api';
import { fD, formatDateTime } from '../../lib/format';
import { useAction } from '../../lib/useAction';
import { EventForm } from './EventForm';
import { when, type EventDetail } from './types';

/** Fiche d'un événement : affiche, infos, participation (soi ou chaque enfant), albums ; direction : réponses, publication. */
export function EventPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['event', id], queryFn: () => api.get<EventDetail>(`/events/${id}`) });
  const e = q.data;
  const [editing, setEditing] = useState(false);
  const [askArchive, setAskArchive] = useState(false);
  const [album, setAlbum] = useState(false);
  const keys = [['event', id], ['events']];
  const respond = useAction((v: { going: boolean; playerId: string | null }) => api.post(`/events/${id}/respond`, { going: v.going, playerId: v.playerId ?? undefined }), {
    invalidate: keys,
    success: (_, v) => (v.going ? 'Participation enregistrée.' : 'Réponse enregistrée.'),
  });
  const publish = useAction(() => api.post<{ notified: number }>(`/events/${id}/publish`), { invalidate: keys, success: (r) => `Publié : ${r.notified} personne${r.notified > 1 ? 's' : ''} prévenue${r.notified > 1 ? 's' : ''}.` });
  const archive = useAction(() => api.post(`/events/${id}/archive`, { restore: e?.archived }), {
    invalidate: keys,
    success: e?.archived ? 'Événement restauré.' : 'Événement archivé.',
    onSuccess: () => setAskArchive(false),
  });
  const removePoster = useAction(() => api.delete(`/events/${id}/poster`), { invalidate: keys, success: 'Affiche retirée.' });

  const going = e?.responses.filter((r) => r.going) ?? [];
  const notGoing = e?.responses.filter((r) => !r.going) ?? [];

  return (
    <>
      <Link to="/evenements" className="text-sm font-medium text-mut hover:underline">
        ‹ Événements
      </Link>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {e && (
          <>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-[23px] font-semibold min-[861px]:text-[26px]">{e.title}</h1>
              {e.canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  {!e.published && !e.archived && (
                    <Button variant="primary" onClick={() => publish.mutate()} disabled={publish.isPending}>
                      Publier et prévenir
                    </Button>
                  )}
                  <ActionIcon kind="edit" label="Modifier l’événement" onClick={() => setEditing(true)} />
                  <ActionIcon kind={e.archived ? 'restore' : 'archive'} label={e.archived ? 'Restaurer l’événement' : 'Archiver l’événement'} onClick={() => (e.archived ? archive.mutate() : setAskArchive(true))} />
                </div>
              )}
            </div>
            <Pills>
              <Pill tone="s">{e.tag}</Pill>
              <Pill tone="b">{fD(e.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Pill>
              {when(e) && <Pill tone="b">{when(e)}</Pill>}
              <Pill tone="g">{e.place}</Pill>
              {e.canManage && <Pill tone="s">{e.audienceLabel}</Pill>}
              {e.canManage && !e.published && <Pill tone="s">Brouillon</Pill>}
              {e.archived && <Pill tone="r">Archivé</Pill>}
            </Pills>

            <div className="mt-4 grid grid-cols-1 gap-4 min-[861px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-4">
                {e.posterUrl && (
                  <Card className="overflow-hidden p-0">
                    <img src={apiUrl(e.posterUrl)} alt={`Affiche : ${e.title}`} className="max-h-[520px] w-full object-contain" />
                    {e.canManage && (
                      <div className="flex justify-end px-4 pb-3">
                        <button type="button" className="text-sm font-medium text-mut hover:underline" onClick={() => removePoster.mutate()}>
                          Retirer l’affiche
                        </button>
                      </div>
                    )}
                  </Card>
                )}
                {e.description && (
                  <Card>
                    <h3>Programme</h3>
                    <p className="whitespace-pre-line text-[15px] leading-relaxed">{e.description}</p>
                  </Card>
                )}
                {e.canManage && (e.groups.length > 0 || e.categories.length > 0 || e.members.length > 0) && (
                  <Card>
                    <h3>Pour qui ?</h3>
                    <Pills>
                      {[...e.groups, ...e.categories].map((o) => (
                        <Pill key={o.id} tone="b">
                          {o.label}
                        </Pill>
                      ))}
                      {e.members.map((m) => (
                        <Pill key={m.kind + m.id} tone={m.kind === 'player' ? 'g' : 'b'}>
                          {m.name}
                        </Pill>
                      ))}
                    </Pills>
                  </Card>
                )}
              </div>

              <div className="flex flex-col gap-4">
                {e.rsvp ? (
                  <Card>
                    <CardRow>
                      <h3>Participation</h3>
                      <Pill tone={e.full ? 'r' : 'g'}>
                        {e.going}
                        {e.capacity ? ` / ${e.capacity}` : ''} participant{e.going > 1 ? 's' : ''}
                      </Pill>
                    </CardRow>
                    {e.past ? (
                      <CardText keep>Événement passé : les réponses sont fermées.</CardText>
                    ) : e.respondents.length ? (
                      <div className="flex flex-col gap-3">
                        {e.respondents.map((r) => (
                          <div key={r.key} className="flex flex-col gap-2 rounded-[18px] bg-dr p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{r.name}</span>
                              {r.going === true && <Pill tone="g">Participe ✓</Pill>}
                              {r.going === false && <Pill tone="r">Ne participe pas</Pill>}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button variant={r.going === true ? 'primary' : undefined} onClick={() => respond.mutate({ going: true, playerId: r.playerId })} disabled={respond.isPending || (e.full && r.going !== true)} aria-pressed={r.going === true}>
                                Je participe
                              </Button>
                              <Button onClick={() => respond.mutate({ going: false, playerId: r.playerId })} disabled={respond.isPending} aria-pressed={r.going === false}>
                                Je ne participe pas
                              </Button>
                            </div>
                          </div>
                        ))}
                        {e.full && <CardText keep>Complet : il ne reste plus de place.</CardText>}
                      </div>
                    ) : (
                      <CardText keep>{e.canManage ? 'Les familles concernées répondent depuis cette page.' : 'Aucune réponse attendue de votre part.'}</CardText>
                    )}
                  </Card>
                ) : (
                  <Note>Événement affiché seulement : pas d’inscription.</Note>
                )}

                {e.canManage && e.rsvp && (
                  <Card>
                    <CardRow>
                      <h3>Réponses reçues</h3>
                      <Pills>
                        <Pill tone="g">{going.length} oui</Pill>
                        <Pill tone="r">{notGoing.length} non</Pill>
                      </Pills>
                    </CardRow>
                    {e.responses.length ? (
                      <ul className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto">
                        {[...going, ...notGoing].map((r, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 rounded-[14px] bg-fld px-3 py-2 text-sm">
                            <span>
                              {r.name}
                              {r.by && <span className="text-mut"> · par {r.by}</span>}
                            </span>
                            <Pill tone={r.going ? 'g' : 'r'}>{r.going ? 'Oui' : 'Non'}</Pill>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <CardText keep>Pas encore de réponse.</CardText>
                    )}
                  </Card>
                )}
                {e.canManage && e.notifiedAt && <CardText keep>Annoncé le {formatDateTime(e.notifiedAt)} · rappel automatique la veille.</CardText>}
              </div>
            </div>

            <section className="mt-7 flex flex-col gap-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2>Photos</h2>
                {e.canCreateAlbum && <Button onClick={() => setAlbum(true)}>+ Créer l’album</Button>}
              </div>
              {e.albums.length ? (
                <CardGrid>
                  {e.albums.map((a) => (
                    <Link key={a.id} to={`/photos/${a.id}`} className="block">
                      <Card>
                        <CardRow>
                          <h3>{a.title}</h3>
                          <Pill tone="b">
                            {a.photos} photo{a.photos > 1 ? 's' : ''}
                          </Pill>
                        </CardRow>
                        {a.archived && <Pill tone="r">Archivé</Pill>}
                      </Card>
                    </Link>
                  ))}
                </CardGrid>
              ) : (
                <EmptyState>{e.past ? 'Pas encore de photos de cet événement.' : 'Les photos seront partagées après l’événement.'}</EmptyState>
              )}
            </section>

            {editing && <EventForm event={e} onClose={() => setEditing(false)} />}
            {album && <AlbumForm preset={{ kind: 'EVENT', contextId: e.id, title: e.title, date: e.date }} onClose={() => setAlbum(false)} />}
            <ConfirmModal
              open={askArchive}
              title="Archiver l’événement ?"
              text="Il disparaît pour les familles (réponses et albums conservés). Vous pourrez le restaurer."
              cta="Archiver"
              pending={archive.isPending}
              onConfirm={() => archive.mutate()}
              onClose={() => setAskArchive(false)}
            />
          </>
        )}
      </QueryState>
    </>
  );
}
