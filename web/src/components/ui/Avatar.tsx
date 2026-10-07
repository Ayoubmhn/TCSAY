import { initials } from '../../lib/format';

/** Avatar à initiales (.av) : 40px, rayon 14px, fond --fld. */
export function Avatar({ first, last }: { first: string; last?: string }) {
  return (
    <div aria-hidden="true" className="grid h-10 w-10 flex-none place-items-center rounded-[14px] bg-fld text-sm font-semibold">
      {initials(first, last)}
    </div>
  );
}

/** Grand avatar d'accueil (.bigav) : 60×68px, rayon 22px, point vert « en ligne ». */
export function BigAvatar({ first, last }: { first: string; last?: string }) {
  return (
    <div
      aria-hidden="true"
      className="relative grid h-[68px] w-[60px] flex-none place-items-center rounded-[22px] bg-pb text-xl font-semibold text-ink"
    >
      {initials(first, last)}
      <span className="absolute -right-[3px] bottom-1.5 h-3.5 w-3.5 rounded-full border-[3px] border-bg bg-[#3aa84a]" />
    </div>
  );
}
