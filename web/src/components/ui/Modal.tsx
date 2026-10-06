import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './Button';

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Boutons alignés à droite (Annuler + action). */
  footer?: ReactNode;
};

/** Modale (.ov + .modal) : voile --veil, 540px max, rayon 28px, Échap / clic voile pour fermer, focus piégé. */
export function Modal({ open, title, onClose, children, footer }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Référence stable : l'effet ne dépend que de « open » (sinon le focus sauterait à chaque rendu).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('input, select, textarea, [data-primary]');
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'Tab' && panel) {
        const items = panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
        );
        if (items.length === 0) return;
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-veil p-4" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[88vh] w-full max-w-[540px] flex-col gap-3.5 overflow-y-auto rounded-[28px] bg-card p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2.5">
          <h2 id={titleId}>{title}</h2>
          <IconButton aria-label="Fermer" onClick={onClose}>
            ✕
          </IconButton>
        </div>
        {children}
        {footer && <div className="flex flex-wrap justify-end gap-1.5">{footer}</div>}
      </div>
    </div>
  );
}
