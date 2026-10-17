import type { QueryKey } from '@tanstack/react-query';
import { useRef } from 'react';
import { api } from '../lib/api';
import { squarePhoto } from '../lib/photo';
import { useAction } from '../lib/useAction';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';

/**
 * Photo de profil : aperçu, « Changer la photo » (galerie ou appareil photo du téléphone), « Retirer ».
 * `path` : /photos/me, /photos/players/:id (parent, joueur, administration) ou /photos/users/:id (administration).
 */
export function PhotoEditor({
  first,
  last,
  photo,
  path,
  invalidate = [],
  hint,
}: {
  first: string;
  last?: string;
  photo?: string | null;
  path: string;
  invalidate?: QueryKey[];
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const keys = [['me'], ...invalidate];
  const save = useAction(async (file: File) => api.upload(path, await squarePhoto(file), {}, 'PUT'), { invalidate: keys, success: 'Photo enregistrée.' });
  const remove = useAction(() => api.delete(path), { invalidate: keys, success: 'Photo retirée.' });
  const busy = save.isPending || remove.isPending;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Avatar first={first || '?'} last={last} photo={photo} size={72} />
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => input.current?.click()} disabled={busy}>
            {save.isPending ? 'Envoi…' : photo ? 'Changer la photo' : 'Ajouter une photo'}
          </Button>
          {photo && (
            <Button variant="danger" onClick={() => remove.mutate()} disabled={busy}>
              Retirer
            </Button>
          )}
        </div>
        <span className="text-xs text-mut">{hint ?? 'Photo carrée, visible des seuls membres du club.'}</span>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Choisir une photo"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) save.mutate(f);
        }}
      />
    </div>
  );
}
