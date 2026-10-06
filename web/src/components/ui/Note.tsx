import type { ReactNode } from 'react';

/** Note de règle en bas d'écran : fond --dr, rayon 18px. */
export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-[18px] border-[1.5px] border-line bg-dr px-5 py-4 text-sm text-mut">{children}</div>;
}
