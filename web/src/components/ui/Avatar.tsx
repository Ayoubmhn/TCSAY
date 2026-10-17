import { apiUrl } from '../../lib/api';
import { initials } from '../../lib/format';

/** Avatar (.av) : 40px, rayon 14px ; photo de profil si elle existe, sinon initiales sur fond --fld. */
export function Avatar({ first, last, photo, size = 40 }: { first: string; last?: string; photo?: string | null; size?: number }) {
  const src = apiUrl(photo);
  return (
    <div
      aria-hidden="true"
      className="grid flex-none place-items-center overflow-hidden rounded-[14px] bg-fld text-sm font-semibold"
      style={{ width: size, height: size }}
    >
      {src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" /> : initials(first, last)}
    </div>
  );
}

/** Grand avatar d'accueil (.bigav) : 60×68px, rayon 22px, point vert « en ligne ». */
export function BigAvatar({ first, last, photo }: { first: string; last?: string; photo?: string | null }) {
  const src = apiUrl(photo);
  return (
    <div
      aria-hidden="true"
      className="relative grid h-[68px] w-[60px] flex-none place-items-center rounded-[22px] bg-pb text-xl font-semibold text-ink"
    >
      {src ? <img src={src} alt="" className="h-full w-full rounded-[22px] object-cover" /> : initials(first, last)}
      <span className="absolute -end-[3px] bottom-1.5 h-3.5 w-3.5 rounded-full border-[3px] border-bg bg-[#3aa84a]" />
    </div>
  );
}
