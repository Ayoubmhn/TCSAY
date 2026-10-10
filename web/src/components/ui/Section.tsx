import type { ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';

/** Section (.sect) : titre h2 puis contenu, 28px sous le bloc précédent. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="mt-7 flex flex-col gap-3.5">
      <h2>{t(title)}</h2>
      {children}
    </section>
  );
}
