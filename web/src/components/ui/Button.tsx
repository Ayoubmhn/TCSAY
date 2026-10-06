import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-pri text-white hover:opacity-90',
  secondary: 'bg-btn text-fg hover:opacity-80',
  ghost: 'bg-transparent text-fg hover:bg-fld',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

/** Bouton pilule (rayon 99px). Une seule couleur d'action : indigo --pri. */
export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
