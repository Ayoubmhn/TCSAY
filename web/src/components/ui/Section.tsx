import type { ReactNode } from 'react';

/** Section (.sect) : titre h2 puis contenu, 28px sous le bloc précédent. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7 flex flex-col gap-3.5">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
