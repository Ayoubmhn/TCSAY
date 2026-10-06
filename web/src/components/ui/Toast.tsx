import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ToastFn = (message: string) => void;

const ToastContext = createContext<ToastFn | null>(null);

const DURATION_MS = 3600;

/** Toast (.toast) : pilule --fg, texte --bg, 3,6 s. Toutes les erreurs métier passent par ici. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const nextId = useRef(0);

  const toast = useCallback<ToastFn>((message) => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, message }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-[calc(24px+env(safe-area-inset-bottom,0px))] left-1/2 z-[80] flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 flex-col gap-2"
      >
        {toasts.map((t) => (
          <div key={t.id} role="status" className="toast-in rounded-full bg-fg px-5 py-3 text-sm font-medium text-bg">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast doit être utilisé dans <ToastProvider>.');
  return toast;
}
