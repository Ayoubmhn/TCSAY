import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const VARIANTS: Record<Variant, string> = {
  // .btn : action principale indigo
  primary: 'bg-pri px-5 py-[11px] font-semibold text-white',
  // .btn2 : action secondaire grise
  secondary: 'bg-btn px-4 py-[9px] text-sm font-medium text-fg',
  // .btn2.danger : archiver, désactiver
  danger: 'bg-pr px-4 py-[9px] text-sm font-medium text-ink',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

/** Bouton pilule (rayon 99px), reproduit .btn / .btn2 / .btn2.danger du prototype. */
export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-full disabled:opacity-45 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

/** Bouton icône carré arrondi 42px (.ico du prototype). aria-label obligatoire. */
export function IconButton({ className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { 'aria-label': string }) {
  return (
    <button
      type={type}
      className={`grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[15px] bg-btn text-[17px] ${className}`}
      {...props}
    />
  );
}
