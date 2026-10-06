import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/** Libellé de formulaire (label.lb) : 12px 500 gris, champ en dessous. */
function Label({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return (
    <label className={`flex flex-col gap-1.5 text-xs font-medium text-mut ${full ? 'col-span-full' : ''}`}>
      {label}
      {children}
    </label>
  );
}

type Common = { label: string; full?: boolean };

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Common>(
  ({ label, full, className = '', ...props }, ref) => (
    <Label label={label} full={full}>
      <input ref={ref} className={`fld text-[15px] text-fg ${className}`} {...props} />
    </Label>
  ),
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Common>(
  ({ label, full, className = '', rows = 2, ...props }, ref) => (
    <Label label={label} full={full}>
      <textarea ref={ref} rows={rows} className={`fld resize-none text-[15px] text-fg ${className}`} {...props} />
    </Label>
  ),
);

export const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Common>(
  ({ label, full, className = '', children, ...props }, ref) => (
    <Label label={label} full={full}>
      <select ref={ref} className={`sel text-[15px] text-fg ${className}`} {...props}>
        {children}
      </select>
    </Label>
  ),
);

/** Select de filtre (.sel) : libellé accessible via aria-label. */
export function FilterSelect({ label, className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return <select aria-label={label} className={`sel text-fg ${className}`} {...props} />;
}

/** Barre de filtres (.filters). */
export function Filters({ children }: { children: ReactNode }) {
  return <div className="mt-5 mb-1.5 flex flex-wrap items-center gap-2.5">{children}</div>;
}

/** Formulaire en deux colonnes (.form), une colonne sous 520px. */
export function FormGrid({ children, ...props }: React.FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form noValidate className="grid grid-cols-1 gap-3 min-[521px]:grid-cols-2" {...props}>
      {children}
    </form>
  );
}
