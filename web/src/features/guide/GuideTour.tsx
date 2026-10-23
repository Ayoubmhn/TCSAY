import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { useAuth, useMe } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Logo } from '../../components/ui/Brand';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { stepsFor, type GuideStep } from './steps';

/** Demande de revoir le guide (Paramètres › Aide). */
export const REPLAY_EVENT = 'tcsay:guide';
export const replayGuide = () => window.dispatchEvent(new Event(REPLAY_EVENT));

const LOCAL_KEY = 'tcsay-guide-seen';

/** Étapes vues gardées aussi sur l'appareil : sans réseau, le guide ne revient pas avant d'être enregistré sur le compte. */
function readLocal(userId: string): string[] {
  try {
    return (JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, string[]>)[userId] ?? [];
  } catch {
    return [];
  }
}

function writeLocal(userId: string, ids: string[]) {
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, string[]>;
    all[userId] = [...new Set([...(all[userId] ?? []), ...ids])];
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {
    /* non mémorisé */
  }
}

type Tour = { steps: GuideStep[]; mark: string[]; fresh: boolean };

/** Rectangle visible à l'écran (les liens du tiroir fermé ou d'une barre masquée ne comptent pas). */
function visible(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  if (r.right <= 0 || r.left >= window.innerWidth || r.bottom <= 0 || r.top >= window.innerHeight) return null;
  return r;
}

/**
 * Élément montré par l'étape : le lien (ou l'élément `data-guide`) lui-même, sinon sa catégorie repliée du menu, sinon le
 * bouton du menu (téléphone, lien absent des onglets du bas), sinon rien (bulle au centre).
 */
function locate(target: string | undefined, scroll: boolean): { rect: DOMRect; viaMenu: boolean } | null {
  if (!target) return null;
  for (const el of document.querySelectorAll(`[data-guide="${target}"]`)) {
    if (scroll) el.scrollIntoView({ block: 'nearest' });
    const rect = visible(el);
    if (rect) return { rect, viaMenu: false };
  }
  for (const el of document.querySelectorAll('[data-guide-children]')) {
    if (!(el.getAttribute('data-guide-children') ?? '').split(' ').includes(target)) continue;
    if (scroll) el.scrollIntoView({ block: 'nearest' });
    const rect = visible(el);
    if (rect) return { rect, viaMenu: false };
  }
  // Élément de l'écran (ex. liste des enfants) absent : bulle au centre. Lien absent des onglets : bouton du menu.
  if (!target.startsWith('/')) return null;
  const menu = document.querySelector('[data-guide="menu"]');
  const rect = menu && visible(menu);
  return rect ? { rect, viaMenu: true } : null;
}

/** Contour arrondi : voile sur tout l'écran avec un trou autour du bouton montré (SVG, sans ombre). */
function holePath(w: number, h: number, r: DOMRect | null) {
  const outer = `M0 0H${w}V${h}H0Z`;
  if (!r) return outer;
  const p = 6;
  const x = r.left - p;
  const y = r.top - p;
  const rw = r.width + 2 * p;
  const rh = r.height + 2 * p;
  const k = Math.min(18, rw / 2, rh / 2);
  return `${outer}M${x + k} ${y}H${x + rw - k}A${k} ${k} 0 0 1 ${x + rw} ${y + k}V${y + rh - k}A${k} ${k} 0 0 1 ${x + rw - k} ${y + rh}H${x + k}A${k} ${k} 0 0 1 ${x} ${y + rh - k}V${y + k}A${k} ${k} 0 0 1 ${x + k} ${y}Z`;
}

/**
 * Guide de première utilisation : à la première connexion de chaque espace, quelques étapes qui montrent les vrais
 * boutons (« Suivant », « Passer » à tout moment). Une seule fois par compte (`User.guideSeen`, même sur un autre
 * téléphone) ; une étape nouvelle (module rallumé, autorisation ajoutée) s'affiche seule plus tard. Revoir : Paramètres › Aide.
 */
export function GuideTour() {
  const me = useMe();
  const { refresh } = useAuth();
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [tour, setTour] = useState<Tour | null>(null);
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<{ rect: DOMRect; viaMenu: boolean } | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const all = useMemo(() => stepsFor(me), [me]);

  // Premier parcours, ou étapes nouvelles seulement (mini-guide), 1 s après l'ouverture de l'écran.
  useEffect(() => {
    if (tour || pathname.startsWith('/impression')) return;
    const seen = new Set([...(me.guideSeen ?? []), ...readLocal(me.id)]);
    const welcome = all.find((s) => s.welcome);
    let next: Tour | null = null;
    if (welcome && !seen.has(welcome.id)) next = { steps: all.filter((s) => !s.extra), mark: all.map((s) => s.id), fresh: true };
    else {
      const pending = all.filter((s) => !seen.has(s.id));
      if (pending.length) next = { steps: pending, mark: pending.map((s) => s.id), fresh: false };
    }
    if (!next) return;
    const timer = setTimeout(() => {
      setIndex(0);
      setTour(next);
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, me.id, me.guideSeen]);

  // Paramètres › Aide › « Revoir le guide » : tout le parcours de l'espace.
  useEffect(() => {
    const onReplay = () => {
      setIndex(0);
      setTour({ steps: all, mark: all.map((s) => s.id), fresh: true });
    };
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, [all]);

  const step = tour?.steps[index];

  // Position du bouton montré : recalculée au redimensionnement et au défilement.
  useLayoutEffect(() => {
    if (!step) return;
    const update = (scroll = false) => {
      setSize({ w: window.innerWidth, h: window.innerHeight });
      setSpot(locate(step.target, scroll));
    };
    update(true);
    const onChange = () => update();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [step]);

  // Focus sur le bouton principal de la bulle (clavier, lecteur d'écran).
  useEffect(() => document.querySelector<HTMLButtonElement>('[data-guide-primary]')?.focus(), [step]);

  const close = useCallback(() => {
    if (!tour) return;
    writeLocal(me.id, tour.mark);
    setTour(null);
    api
      .post('/auth/guide', { steps: tour.mark })
      .then(() => refresh())
      .catch(() => undefined); // sans réseau : gardé sur l'appareil, renvoyé à la prochaine fin de guide
  }, [tour, me.id, refresh]);

  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tour, close]);

  if (!tour || !step) return null;
  const last = index === tour.steps.length - 1;
  const rect = spot?.rect ?? null;
  const width = Math.min(360, size.w - 32);

  // Bulle : à droite d'un lien du menu latéral (ordinateur), sinon au-dessus ou au-dessous du bouton.
  let box: React.CSSProperties;
  let arrow: React.CSSProperties | null = null;
  if (!rect || step.welcome) {
    box = { left: (size.w - width) / 2, top: Math.max(16, size.h / 2 - 210) };
  } else if (rect.right < size.w * 0.4 && size.w >= 860) {
    const top = Math.min(Math.max(16, rect.top + rect.height / 2 - 90), size.h - 300);
    box = { left: rect.right + 18, top };
    arrow = { left: rect.right + 10, top: rect.top + rect.height / 2 - 8 };
  } else {
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), size.w - width - 16);
    const ax = Math.min(Math.max(left + 20, rect.left + rect.width / 2 - 8), left + width - 36);
    if (rect.top > size.h / 2) {
      box = { left, bottom: size.h - rect.top + 18 };
      arrow = { left: ax, top: rect.top - 26 };
    } else {
      box = { left, top: rect.bottom + 18 };
      arrow = { left: ax, top: rect.bottom + 10 };
    }
  }

  const counter = tour.fresh ? `${t('Étape')} ${index + 1} ${t('sur')} ${tour.steps.length}` : `${t('Nouveau')} · ${index + 1} ${t('sur')} ${tour.steps.length}`;
  const text = spot?.viaMenu ? `${t(step.text)} ${t('(dans le menu, bouton en haut à gauche)')}` : t(step.text);

  return (
    <div className="no-print fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-labelledby="guide-title" aria-describedby="guide-text">
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <path d={holePath(size.w, size.h, step.welcome ? null : rect)} fillRule="evenodd" fill="rgba(10, 10, 20, 0.58)" />
        {rect && !step.welcome && (
          <rect x={rect.left - 6} y={rect.top - 6} width={rect.width + 12} height={rect.height + 12} rx={Math.min(18, (rect.height + 12) / 2)} fill="none" stroke="#fff" strokeWidth={3} />
        )}
      </svg>
      {arrow && <span aria-hidden="true" className="absolute h-4 w-4 rotate-45 bg-card" style={arrow} />}
      <div className={`absolute rounded-[24px] bg-card p-5 ${step.welcome ? 'text-center' : ''}`} style={{ ...box, width }}>
        {step.welcome && (
          <div className="mb-2 flex justify-center">
            <Logo size={76} />
          </div>
        )}
        {!step.welcome && <div className="mb-1.5 text-[12px] font-semibold text-pri">{counter}</div>}
        <h2 id="guide-title" className={`font-semibold ${step.welcome ? 'text-[20px]' : 'text-[16px]'}`}>
          {t(step.title)}
        </h2>
        <p id="guide-text" className="mt-1.5 text-[13.5px] leading-relaxed text-fg/85">
          {text}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          {index > 0 ? (
            <Button onClick={() => setIndex(index - 1)}>← Retour</Button>
          ) : (
            <button type="button" onClick={close} className="rounded-full px-2 py-2 text-[13px] font-medium text-mut hover:text-fg">
              {t('Passer')}
            </button>
          )}
          <span className="flex gap-1" aria-hidden="true">
            {tour.steps.map((s, i) => (
              <i key={s.id} className={`h-[7px] rounded-full ${i === index ? 'w-[18px] bg-pri' : 'w-[7px] bg-line'}`} />
            ))}
          </span>
          <Button data-guide-primary variant="primary" onClick={() => (last ? close() : setIndex(index + 1))}>
            {last ? 'Terminer ✓' : step.welcome ? 'Commencer' : 'Suivant →'}
          </Button>
        </div>
        {index > 0 && !last && (
          <div className="mt-2 text-center">
            <button type="button" onClick={close} className="text-[12.5px] text-mut hover:text-fg">
              {t('Passer le guide')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
