import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ChangeEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Note } from '../../components/ui/Note';
import { Pill, Pills } from '../../components/ui/Pill';
import { api } from '../../lib/api';
import { resizedPhoto } from '../../lib/photo';
import type { AiReadResult, AiStatus } from '../../lib/types';
import { useAction } from '../../lib/useAction';

/** Photos réduites à 2000 px (écriture lisible, envoi léger), JPEG sans métadonnées (ni position GPS). */
const MAX_SIDE = 2000;

export type AiPages = { result: AiReadResult; photos: string[] };

/**
 * Lecture des photos du cahier par IA (Gemini, niveau gratuit) : prendre une photo ou en choisir dans la galerie,
 * puis « Lire ». Le résultat remplit le tableau modifiable de l'écran ; rien n'est enregistré ici.
 * Désactivée tant que le président ne l'a pas activée (avertissement sur les données accepté).
 */
export function AiPhotoReader({ kind, onRead }: { kind: 'players' | 'payments'; onRead: (pages: AiPages) => void }) {
  const { me } = useAuth();
  const president = Boolean(me?.permissions.includes('permissions.manage'));
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<AiStatus>('/ai/status') });
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [activate, setActivate] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const max = status.data?.limits.photos ?? 6;
  const add = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    setFiles((cur) => [...cur, ...picked].slice(0, max));
  };

  const configure = useAction((enabled: boolean) => api.put<AiStatus>('/ai/config', { enabled, accept: enabled ? accepted : undefined }), {
    invalidate: [['ai-status']],
    success: (s) => (s.enabled ? 'Lecture des photos par IA activée.' : 'Lecture des photos par IA désactivée.'),
    onSuccess: () => {
      setActivate(false);
      setAccepted(false);
    },
  });

  const read = useAction(
    async () => {
      const blobs = await Promise.all(files.map((f) => resizedPhoto(f, MAX_SIDE)));
      const result = await api.uploadMany<AiReadResult>(`/ai/read/${kind}`, blobs);
      // Photos gardées sur l'appareil seulement, pour comparer avec le tableau.
      return { result, photos: blobs.map((b) => URL.createObjectURL(b)) };
    },
    {
      invalidate: [['ai-status']],
      success: ({ result }) => {
        const failed = result.pages.filter((p) => p.error).length;
        const d = result.doubts.length;
        return `${result.rows.length} ligne(s) lue(s)${d ? `, ${d} case(s) à vérifier` : ''}${failed ? ` · ${failed} page(s) non lue(s)` : ''}.`;
      },
      onSuccess: (pages) => {
        setFiles([]);
        onRead(pages);
      },
    },
  );

  const s = status.data;
  if (!s) return null;

  return (
    <section className="mt-4 rounded-[24px] border-[1.5px] border-pri bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="m-0 text-[16px] font-medium">✦ Lire des photos du cahier (IA)</h3>
          <p className="m-0 mt-0.5 text-[13px] font-semibold text-mut">Prenez une photo ou choisissez des photos du téléphone : l’IA remplit le tableau, vous vérifiez.</p>
        </div>
        <Pills>
          <Pill tone={s.enabled ? 'g' : 's'}>{s.enabled ? 'Activée' : 'Désactivée'}</Pill>
          <Pill tone="b">{s.usage.pages} page(s) lue(s) ce mois</Pill>
        </Pills>
      </div>

      {!s.keyConfigured ? (
        <Note>
          Clé Gemini absente : créez une clé gratuite sur aistudio.google.com (« Get API key »), ajoutez <b>GEMINI_API_KEY=…</b> dans <b>api/.env</b>, puis
          redémarrez l’API.
        </Note>
      ) : !s.enabled ? (
        <>
          <Note>
            Lecture désactivée. {president ? 'Vous pouvez l’activer après avoir lu l’avertissement sur les données.' : 'Le président doit l’activer depuis cet écran.'}
          </Note>
          {president && (
            <div className="mt-3 flex justify-end">
              <Button variant="primary" onClick={() => setActivate(true)}>
                Activer la lecture par IA
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-3">
            {previews.map((u, i) => (
              <figure key={u} className="relative m-0 h-[150px] w-[118px] overflow-hidden rounded-[16px] border-[1.5px] border-line bg-fld">
                <img src={u} alt={`Page ${i + 1}`} className="h-full w-full object-cover" />
                <span className="absolute bottom-1.5 start-1.5 rounded-full bg-[#dff3a8] px-2.5 py-0.5 text-[12px] text-[#111]">Page {i + 1}</span>
                <button
                  type="button"
                  aria-label={`Retirer la page ${i + 1}`}
                  className="absolute end-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-card text-[14px]"
                  onClick={() => setFiles(files.filter((_, k) => k !== i))}
                >
                  ×
                </button>
              </figure>
            ))}
            {files.length < max && (
              <>
                <label className="grid h-[150px] w-[118px] cursor-pointer place-items-center rounded-[16px] bg-fld p-2 text-center text-[13px] text-mut focus-within:outline-2 focus-within:outline-pri">
                  <span>
                    📷
                    <br />
                    Prendre une photo
                  </span>
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={add} />
                </label>
                <label className="grid h-[150px] w-[118px] cursor-pointer place-items-center rounded-[16px] bg-fld p-2 text-center text-[13px] text-mut focus-within:outline-2 focus-within:outline-pri">
                  <span>
                    🖼
                    <br />
                    Choisir des photos
                  </span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={add} />
                </label>
              </>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] text-mut">
              {max} photos au plus · une page bien à plat, nette et éclairée par photo · {s.provider}
            </span>
            <div className="flex gap-2">
              {president && <Button onClick={() => configure.mutate(false)}>Désactiver</Button>}
              <Button variant="primary" disabled={!files.length || read.isPending} onClick={() => read.mutate()}>
                {read.isPending ? 'Lecture en cours…' : files.length > 1 ? `Lire les ${files.length} pages` : 'Lire la page'}
              </Button>
            </div>
          </div>
          <Note>
            Photos réduites sur l’appareil, sans position GPS, envoyées à Google (Gemini) pour la lecture puis non conservées par le club. L’IA peut se
            tromper : chaque case douteuse est signalée et <b>rien n’est enregistré</b> avant votre confirmation.
          </Note>
        </>
      )}

      <Modal
        open={activate}
        title="Activer la lecture des photos par IA"
        onClose={() => setActivate(false)}
        footer={
          <>
            <Button onClick={() => setActivate(false)}>Annuler</Button>
            <Button variant="primary" disabled={!accepted || configure.isPending} onClick={() => configure.mutate(true)}>
              Activer
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[14px]">
          <p className="m-0">
            Les photos des cahiers (noms d’enfants, dates de naissance, téléphones, paiements) seront envoyées à <b>Google</b> pour être lues par Gemini.
          </p>
          <p className="m-0">
            Avec le <b>niveau gratuit</b>, Google peut utiliser ces données pour améliorer ses produits, et des personnes peuvent les relire. Le niveau payant
            ne le fait pas.
          </p>
          <p className="m-0 text-mut">Données de mineurs : l’accord du bureau et le respect de la loi tunisienne sur les données personnelles (INPDP) sont de votre responsabilité.</p>
          <label className="flex items-start gap-2 rounded-[18px] bg-fld px-4 py-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-pri" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>J’ai lu cet avertissement et le bureau accepte l’envoi des photos à Google (niveau gratuit de Gemini).</span>
          </label>
          <p className="m-0 text-[12.5px] text-mut">L’activation est inscrite dans l’historique des actions, avec votre nom et la date.</p>
        </div>
      </Modal>
    </section>
  );
}

/** Photos lues, à côté du tableau : page au choix, zoom et rotation pour comparer ligne par ligne. */
export function PhotoPanel({ photos }: { photos: string[] }) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(0);
  if (!photos.length) return null;
  const src = photos[Math.min(page, photos.length - 1)];
  return (
    <section className="rounded-[22px] border-[1.5px] border-line bg-card p-3 min-[1100px]:sticky min-[1100px]:top-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <b className="text-[14px] font-semibold">Photo · page {page + 1}/{photos.length}</b>
        <Pill tone="b">Comparez avec le tableau</Pill>
      </div>
      <div className="h-[56vh] overflow-auto rounded-[14px] bg-fld">
        <img src={src} alt={`Page ${page + 1} du cahier`} style={{ width: `${zoom * 100}%`, transform: `rotate(${turn}deg)` }} className="block max-w-none origin-center" />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button aria-label="Réduire" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}>
          −
        </Button>
        <Button aria-label="Agrandir" onClick={() => setZoom(Math.min(4, zoom + 0.25))}>
          +
        </Button>
        <Button aria-label="Pivoter" onClick={() => setTurn((turn + 90) % 360)}>
          ↻
        </Button>
        {photos.length > 1 && (
          <>
            <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
              ‹ Page
            </Button>
            <Button disabled={page >= photos.length - 1} onClick={() => setPage(page + 1)}>
              Page ›
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
