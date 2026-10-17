import type { ReactNode } from 'react';

/** Note de règle (.note) : fond --fld, rayon 18px, icône ⓘ, texte 13,5px. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="mt-[18px] flex items-start gap-2.5 rounded-[18px] bg-fld px-4 py-[13px] text-[13.5px] text-fg [&_b]:font-semibold">
      <span aria-hidden="true">ⓘ</span>
      <div>{children}</div>
    </div>
  );
}
