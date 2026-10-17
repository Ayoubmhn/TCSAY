import { api, errorMessage } from '../../lib/api';
import { albumPhoto } from '../../lib/photo';

/** Envoie des photos dans un album, une par une (réduites sur l'appareil) ; renvoie le nombre envoyé et les erreurs. */
export async function uploadPhotos(albumId: string, files: File[], onProgress: (done: number, total: number) => void) {
  let ok = 0;
  const errors: string[] = [];
  onProgress(0, files.length);
  for (const [i, f] of files.entries()) {
    try {
      const p = await albumPhoto(f);
      const form = new FormData();
      form.append('file', p.full, 'photo.jpg');
      form.append('thumb', p.thumb, 'vignette.jpg');
      form.append('width', String(p.width));
      form.append('height', String(p.height));
      await api.post(`/albums/${albumId}/photos`, form);
      ok++;
    } catch (e) {
      errors.push(errorMessage(e));
    }
    onProgress(i + 1, files.length);
  }
  return { ok, errors };
}
