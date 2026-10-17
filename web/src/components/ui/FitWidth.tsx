import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Réduit son contenu (feuille A4, reçu…) pour qu'il tienne dans la largeur de l'écran, sans défilement horizontal.
 * À l'impression, le contenu reprend sa taille réelle (index.css, `.fit-width`).
 */
export function FitWidth({ children, className = '' }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const update = () => {
      const s = Math.min(1, o.clientWidth / Math.max(1, i.offsetWidth));
      setScale(s);
      setHeight(i.offsetHeight * s);
    };
    const ro = new ResizeObserver(update);
    ro.observe(o);
    ro.observe(i);
    update();
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outer} dir="ltr" className={`fit-width overflow-hidden ${className}`} style={{ height }}>
      <div
        ref={inner}
        className="fit-width-inner w-max"
        style={{ transform: `scale(${scale})`, transformOrigin: 'top left', marginInline: scale < 1 ? 0 : 'auto' }}
      >
        {children}
      </div>
    </div>
  );
}
