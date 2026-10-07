import type { ReactNode } from 'react';

/** Ligne clé / valeur du récapitulatif (.kv). */
export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-2.5 border-b-[1.5px] border-line py-1.5 text-sm last:border-b-0">
      <span className="text-mut">{label}</span>
      <b className="font-semibold">{children}</b>
    </div>
  );
}
