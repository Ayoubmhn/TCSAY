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
import { isInApp } from '../../lib/pwa';
import { fD } from '../../lib/format';
import { uploadPhotos } from './upload';
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

/**
 * Bande de photos à faire défiler (glisser à gauche / droite) : suit la photo choisie (boutons, clavier),
 * seules les photos voisines sont chargées.
 */
function PhotoStrip({ photos, index, onIndex, className = '', dark = false }: { photos: AlbumPhoto[]; index: number; onIndex: (i: number) => void; className?: string; dark?: boolean }) {
  const strip = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const w = el.clientWidth;
    if (Math.round(Math.abs(el.scrollLeft) / w) !== index) {
      const rtl = getComputedStyle(el).direction === 'rtl';
      el.scrollTo({ left: (rtl ? -1 : 1) * index * w, behavior: first.current ? 'auto' : 'smooth' });
    }
    first.current = false;
  }, [index]);
  const onScroll = () => {
    const el = strip.current;
    if (!el) return;
    const i = Math.round(Math.abs(el.scrollLeft) / el.clientWidth);
    if (i !== index && i >= 0 && i < photos.length) onIndex(i);
  };
  return (
    <div
      ref={strip}
      onScroll={onScroll}
      className={`flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      aria-label="Photos : glissez à gauche ou à droite"
    >
      {photos.map((p, i) => (
        <div key={p.id} className="flex h-full w-full shrink-0 snap-center items-center justify-center">
          {Math.abs(i - index) <= 1 && (
            <img src={apiUrl(p.fullUrl)} alt={p.caption ?? `Photo ${i + 1}`} draggable={false} className={`max-h-full w-auto max-w-full object-contain ${dark ? '' : 'rounded-[18px]'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

/** Plein écran : fond noir, photo à toute la taille, glisser pour changer, toucher ✕ ou Échap pour sortir. */
function FullScreen({ photos, index, onIndex, onClose, onDownload, title }: { photos: AlbumPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void; onDownload: () => void; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Vrai plein écran quand le navigateur le permet (sinon la couche noire couvre la page).
    const el = box.current;
    el?.requestFullscreen?.().catch(() => undefined);
    const onChange = () => !document.fullscreenElement && onClose();
    document.addEventListener('fullscreenchange', onChange);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.body.style.overflow = prev;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const btn = 'grid h-11 min-w-11 place-items-center rounded-full bg-white/15 px-3 text-white hover:bg-white/25 disabled:opacity-30';
  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label={`${title} en plein écran`} className="fixed inset-0 z-[100] flex flex-col bg-black text-white">
      <div className="flex items-center justify-between gap-2 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2">
        <span className="text-sm font-medium">
          {index + 1} / {photos.length}
        </span>
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={onDownload} aria-label="Télécharger la photo">
            ⬇
          </button>
          <button type="button" className={btn} onClick={onClose} aria-label="Quitter le plein écran">
            ✕
          </button>
        </div>
      </div>
      <PhotoStrip photos={photos} index={index} onIndex={onIndex} className="min-h-0 flex-1" dark />
      <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-[max(14px,env(safe-area-inset-bottom))]">
        <button type="button" className={btn} onClick={() => onIndex(Math.max(0, index - 1))} disabled={index === 0} aria-label="Photo précédente">
          ‹
        </button>
        <span className="truncate text-center text-sm text-white/80">{photos[index]?.caption ?? ''}</span>
        <button type="button" className={btn} onClick={() => onIndex(Math.min(photos.length - 1, index + 1))} disabled={index === photos.length - 1} aria-label="Photo suivante">
          ›
        </button>
      </div>
    </div>
  );
}

/** Enregistre une photo sur l'appareil : téléchargement (ordinateur, Android), feuille de partage (iPhone), navigateur (application). */
async function savePhoto(url: string, name: string): Promise<'app' | 'done'> {
  const full = new URL(apiUrl(url)!, window.location.href).href;
  if (isInApp()) {
    // L'application ouvre la photo dans le navigateur du téléphone (appui long › Télécharger l'image).
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'open-url', value: full }));
    return 'app';
  }
  const blob = await (await fetch(full)).blob();
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const file = new File([blob], `${name}.${ext}`, { type: blob.type });
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] }).catch(() => undefined);
    return 'done';
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  return 'done';
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'photo';

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
  const [full, setFull] = useState(false);
  const [saving, setSaving] = useState(false);
  const keys = [['album', id], ['albums']];
  const photo = a && open !== null ? a.photos[open] : undefined;
  useEffect(() => setTagging(false), [open]);
  useEffect(() => {
    if (open === null) setFull(false);
  }, [open]);
  const count = a?.photos.length ?? 0;
  const go = (d: number) => setOpen((i) => (i === null ? i : Math.min(count - 1, Math.max(0, i + d))));

  // Flèches du clavier (hors saisie de texte).
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const rtl = document.documentElement.dir === 'rtl';
      if (e.key === 'ArrowRight') go(rtl ? -1 : 1);
      if (e.key === 'ArrowLeft') go(rtl ? 1 : -1);
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, count]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    if (!photo || !a || open === null) return;
    setSaving(true);
    try {
      const r = await savePhoto(photo.fullUrl, `${slug(a.title)}-${open + 1}`);
      if (r === 'app') toast('Photo ouverte dans le navigateur : appui long sur l’image › Télécharger.');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (files: FileList) => {
    const { ok, errors } = await uploadPhotos(id, [...files], (done, total) => setProgress({ done, total }));
    errors.forEach((e) => toast(e));
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
        open={Boolean(photo) && !full}
        size="xl"
        title={a && open !== null ? `${a.title} · ${open + 1}/${a.photos.length}` : ''}
        onClose={() => setOpen(null)}
        footer={
          photo && (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button onClick={() => go(-1)} disabled={open === 0} aria-label="Photo précédente">
                  ‹
                </Button>
                <Button onClick={() => go(1)} disabled={!a || open === a.photos.length - 1} aria-label="Photo suivante">
                  ›
                </Button>
                <Button onClick={() => void download()} disabled={saving} aria-label="Télécharger la photo">
                  {saving ? '…' : '⬇ Télécharger'}
                </Button>
                <Button onClick={() => setFull(true)} aria-label="Plein écran">
                  ⛶
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
            <PhotoStrip photos={a.photos} index={open ?? 0} onIndex={setOpen} className="h-[62dvh]" />
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
      {full && a && open !== null && <FullScreen photos={a.photos} index={open} onIndex={setOpen} onClose={() => setFull(false)} onDownload={() => void download()} title={a.title} />}
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
