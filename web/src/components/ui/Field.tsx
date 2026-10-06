import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const CONTROL =
  'w-full rounded-[20px] border-[1.5px] border-transparent bg-fld px-4 py-2.5 text-[15px] text-fg placeholder:text-mut focus:border-pri focus:outline-none aria-[invalid=true]:border-pill-rose';

function Wrapper({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-mut">
        {label}
      </label>
      {children}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="self-start rounded-full bg-pill-rose px-2.5 py-0.5 text-[11px] font-medium text-pill-ink"
        >
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string };

export const TextField = forwardRef<HTMLInputElement, InputProps>(({ label, error, id, ...props }, ref) => {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Wrapper id={fieldId} label={label} error={error}>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={CONTROL}
        {...props}
      />
    </Wrapper>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string };

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ label, error, id, ...props }, ref) => {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Wrapper id={fieldId} label={label} error={error}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={3}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={`${CONTROL} resize-none`}
        {...props}
      />
    </Wrapper>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string };

export const SelectField = forwardRef<HTMLSelectElement, SelectProps>(({ label, error, id, children, ...props }, ref) => {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Wrapper id={fieldId} label={label} error={error}>
      <select ref={ref} id={fieldId} aria-invalid={Boolean(error)} className={CONTROL} {...props}>
        {children}
      </select>
    </Wrapper>
  );
});

/** Filtre de liste : select gris arrondi, libellé accessible mais masqué. */
export function FilterSelect({ label, className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <select
      aria-label={label}
      className={`rounded-[20px] bg-fld px-4 py-2.5 text-sm font-medium text-fg focus:outline-none focus-visible:outline-2 focus-visible:outline-pri ${className}`}
      {...props}
    />
  );
}
