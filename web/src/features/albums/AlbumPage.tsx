import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ActionIcon } from '../../components/ui/ActionIcon';
import { Button } from '../../components/ui/Button';
import { CardText, EmptyState } from '../../components/ui/Card';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { TextField } from '../../components/ui/Field';
import { QueryState } from '../../components/ui/Loading';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { Pill, Pills } from '../../components/ui/Pill';
import { useToast } from '../../components/ui/Toast';
import { api, apiUrl, errorMessage } from '../../lib/api';
import { fD } from '../../lib/format';
import { albumPhoto } from '../../lib/photo';
import { useAction } from '../../lib/useAction';
import { AlbumForm } from './AlbumForm';
import type { AlbumDetail, AlbumPhoto } from './types';

type People = { users: unknown[]; players: { id: string; name: string; code: string | null }[] };

/** Identification des joueurs d'une photo (liste du contexte d'abord, puis recherche) et légende. */
function TagEditor({ album, photo, onDone }: { album: AlbumDetail; photo: AlbumPhoto; onDone: () => void }) {
  const [tags, setTags] = useState(photo.tags);
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [q, setQ] = useState('');
  const found = useQuery({ queryKey: ['album-people', q], queryFn: () => api.get<People>('/albums/people', { q }), enabled: q.trim().length >= 2 });
  const save = useAction(() => api.put(`/albums/${album.id}/photos/${photo.id}/tags`, { playerIds: tags.map((t) => t.id), caption }), {
    invalidate: [['album', album.id]],
    success: 'Photo mise à jour.',
    onSuccess: onDone,
  });
  const has = (id: string) => tags.some((t) => t.id === id);
  const toggle = (p: { id: string; name: string }) => setTags((l) => (has(p.id) ? l.filter((t) => t.id !== p.id) : [...l, p]));
  return (
    <div className="flex flex-col gap-2.5">
      <TextField label="Légende (facultatif)" value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} />
      <span className="text-xs font-medium text-mut">Joueurs sur la photo</span>
      {album.candidates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {album.candidates.map((c) => (
            <button key={c.id} type="button" aria-pressed={has(c.id)} onClick={() => toggle(c)} className={`rounded-full px-3 py-1.5 text-[13px] ${has(c.id) ? 'bg-sel text-white' : 'bg-fld'}`}>
              {c.name}
              {!c.allowed && ' ⚠'}
            </button>
          ))}
        </div>
      )}
      <TextField label="Autre joueur" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="2 lettres au moins" />
      {q.trim().length >= 2 && (
        <div className="flex flex-wrap gap-1.5">
          {found.data?.players.map((p) => (
            <button key={p.id} type="button" onClick={() => (toggle(p), setQ(''))} className="rounded-full bg-fld px-3 py-1.5 text-[13px] hover:bg-btn">
              + {p.name}
            </button>
          ))}
        </div>
      )}
      {tags.length > 0 && (
        <Pills>
          {tags.map((t) => (
            <button key={t.id} type="button" onClick={() => toggle(t)} aria-label={`Retirer ${t.name}`}>
              <Pill tone="g">{t.name} ✕</Pill>
            </button>
          ))}
        </Pills>
      )}
      {album.candidates.some((c) => !c.allowed) && <CardText keep>⚠ sans autorisation photo : la photo ne sera visible que de sa famille.</CardText>}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Annuler</Button>
        <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

/** Album : grille des photos ; grande photo avec identification, retrait (famille) ou gestion (direction). */
export function AlbumPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['album', id], queryFn: () => api.get<AlbumDetail>(`/albums/${id}`) });
  const a = q.data;
  const [open, setOpen] = useState<number | null>(null);
  const [tagging, setTagging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [askHide, setAskHide] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const keys = [['album', id], ['albums']];
  const photo = a && open !== null ? a.photos[open] : undefined;
  useEffect(() => setTagging(false), [open]);

  const upload = async (files: FileList) => {
    const list = [...files];
    setProgress({ done: 0, total: list.length });
    let ok = 0;
    for (const f of list) {
      try {
        const p = await albumPhoto(f);
        const form = new FormData();
        form.append('file', p.full, 'photo.jpg');
        form.append('thumb', p.thumb, 'vignette.jpg');
        form.append('width', String(p.width));
        form.append('height', String(p.height));
        await api.post(`/albums/${id}/photos`, form);
        ok++;
      } catch (e) {
        toast(errorMessage(e));
      }
      setProgress((x) => (x ? { ...x, done: x.done + 1 } : x));
    }
    setProgress(null);
    if (ok) toast(`${ok} photo${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''}. Identifiez les joueurs puis « Prévenir ».`);
    void queryClient.invalidateQueries({ queryKey: ['album', id] });
  };

  const notify = useAction(() => api.post<{ notified: number; photos: number }>(`/albums/${id}/notify`), { invalidate: keys, success: (r) => `${r.notified} personne(s) prévenue(s) pour ${r.photos} photo(s).` });
  const hide = useAction(() => api.post(`/albums/${id}/photos/${photo!.id}/hide`, {}), {
    invalidate: keys,
    success: 'Photo retirée : la direction est prévenue.',
    onSuccess: () => (setAskHide(false), setOpen(null)),
  });
  const restore = useAction((pid: string) => api.post(`/albums/${id}/photos/${pid}/restore`), { invalidate: keys, success: 'Photo remise en ligne.' });
  const remove = useAction((pid: string) => api.delete(`/albums/${id}/photos/${pid}`), { invalidate: keys, success: 'Photo supprimée.', onSuccess: () => setOpen(null) });
  const archive = useAction(() => api.post(`/albums/${id}/archive`, { restore: a?.archived }), {
    invalidate: keys,
    success: a?.archived ? 'Album restauré.' : 'Album archivé.',
    onSuccess: () => !a?.archived && navigate('/photos'),
  });

  return (
    <>
      <Link to="/photos" className="text-sm font-medium text-mut hover:underline">
        ‹ Photos
      </Link>
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {a && (
          <>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-[23px] font-semibold">{a.title}</h1>
              {a.canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={() => input.current?.click()} disabled={Boolean(progress)}>
                    {progress ? `Envoi ${progress.done}/${progress.total}…` : '+ Ajouter des photos'}
                  </Button>
                  <Button onClick={() => notify.mutate()} disabled={notify.isPending}>
                    Prévenir
                  </Button>
                  <ActionIcon kind="edit" label="Modifier l’album" onClick={() => setEditing(true)} />
                  <ActionIcon kind={a.archived ? 'restore' : 'archive'} label={a.archived ? 'Restaurer l’album' : 'Archiver l’album'} onClick={() => archive.mutate()} />
                  <input ref={input} type="file" accept="image/*" multiple className="hidden" aria-label="Photos à ajouter" onChange={(e) => (e.target.files?.length ? void upload(e.target.files) : undefined, (e.target.value = ''))} />
                </div>
              )}
            </div>
            <Pills className="mt-3">
              <Pill tone="s">
                {a.kindLabel}
                {a.context ? ` · ${a.context}` : ''}
              </Pill>
              <Pill tone="b">{fD(a.date, { weekday: 'long', day: 'numeric', month: 'long' })}</Pill>
              <Pill tone="g">{a.photos.length} photo{a.photos.length > 1 ? 's' : ''}</Pill>
              {a.canManage && <Pill tone="b">Visible : {a.audienceLabel}</Pill>}
              {a.canManage && !a.notifiedAt && a.photos.length > 0 && <Pill tone="r">Pas encore annoncé</Pill>}
              {a.archived && <Pill tone="r">Archivé</Pill>}
            </Pills>
            {a.description && <p className="mt-3 max-w-[760px] text-mut">{a.description}</p>}

            <div className="mt-5">
              {a.photos.length ? (
                <div className="grid grid-cols-3 gap-1.5 min-[561px]:grid-cols-4 min-[1001px]:grid-cols-6">
                  {a.photos.map((p, i) => (
                    <button key={p.id} type="button" onClick={() => setOpen(i)} className="relative aspect-square overflow-hidden rounded-[14px] bg-fld" aria-label={`Photo ${i + 1}${p.tags.length ? ` : ${p.tags.map((t) => t.name).join(', ')}` : ''}`}>
                      <img src={apiUrl(p.thumbUrl)} alt="" loading="lazy" className={`h-full w-full object-cover ${p.hidden ? 'opacity-35' : ''}`} />
                      {(p.hidden || p.withoutConsent.length > 0) && <span className="absolute start-1 top-1 rounded-full bg-pr px-2 py-0.5 text-[10px] font-semibold text-ink">{p.hidden ? 'Retirée' : 'Famille seule'}</span>}
                      {p.mine && <span className="absolute end-1 top-1 rounded-full bg-pg px-2 py-0.5 text-[10px] font-semibold text-ink">★</span>}
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState>{a.canManage ? 'Ajoutez les premières photos.' : 'Pas encore de photo dans cet album.'}</EmptyState>
              )}
            </div>
            <div className="mt-4 max-w-[760px]">
              <Note>
                {a.canManage
                  ? 'Photos réduites sur votre appareil (position GPS retirée). Identifiez les joueurs : un enfant sans autorisation photo n’apparaît qu’à sa famille. « Prévenir » envoie une notification aux personnes qui voient l’album.'
                  : 'Photos visibles des seules personnes concernées. Votre enfant est sur une photo que vous ne souhaitez pas ? Ouvrez-la et touchez « Retirer cette photo ».'}
              </Note>
            </div>
          </>
        )}
      </QueryState>

      <Modal
        open={Boolean(photo)}
        size="xl"
        title={a && open !== null ? `${a.title} · ${open + 1}/${a.photos.length}` : ''}
        onClose={() => setOpen(null)}
        footer={
          photo && (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button onClick={() => setOpen((i) => (i !== null && i > 0 ? i - 1 : i))} disabled={open === 0} aria-label="Photo précédente">
                  ‹
                </Button>
                <Button onClick={() => setOpen((i) => (i !== null && a && i < a.photos.length - 1 ? i + 1 : i))} disabled={!a || open === a.photos.length - 1} aria-label="Photo suivante">
                  ›
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {photo.mine && !photo.hidden && (
                  <Button variant="danger" onClick={() => setAskHide(true)}>
                    Retirer cette photo
                  </Button>
                )}
                {a?.canManage && (
                  <>
                    <Button onClick={() => setTagging((v) => !v)}>Identifier</Button>
                    {photo.hidden ? (
                      <Button onClick={() => restore.mutate(photo.id)}>Remettre en ligne</Button>
                    ) : (
                      !photo.mine && (
                        <Button variant="danger" onClick={() => setAskHide(true)}>
                          Retirer
                        </Button>
                      )
                    )}
                    <ActionIcon kind="delete" label="Supprimer la photo" onClick={() => remove.mutate(photo.id)} />
                  </>
                )}
              </div>
            </div>
          )
        }
      >
        {photo && a && (
          <div className="flex flex-col gap-3">
            <img src={apiUrl(photo.fullUrl)} alt={photo.caption ?? ''} className="mx-auto max-h-[62dvh] w-auto max-w-full rounded-[18px] object-contain" />
            {photo.caption && <p className="text-center">{photo.caption}</p>}
            <Pills>
              {photo.tags.map((t) => (
                <Pill key={t.id} tone="g">
                  {t.name}
                </Pill>
              ))}
              {photo.hidden && <Pill tone="r">{photo.hidden}</Pill>}
              {photo.withoutConsent.length > 0 && <Pill tone="r">Sans autorisation : {photo.withoutConsent.join(', ')} (famille seule)</Pill>}
            </Pills>
            {tagging && a.canManage && <TagEditor album={a} photo={photo} onDone={() => setTagging(false)} />}
          </div>
        )}
      </Modal>
      <ConfirmModal
        open={askHide}
        title="Retirer cette photo ?"
        text="Elle disparaît tout de suite de l’album pour tout le monde ; la direction est prévenue."
        cta="Retirer"
        pending={hide.isPending}
        onConfirm={() => hide.mutate()}
        onClose={() => setAskHide(false)}
      />
      {editing && a && <AlbumForm album={a} onClose={() => setEditing(false)} />}
    </>
  );
}
