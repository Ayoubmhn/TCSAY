import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth/AuthContext';
import { api } from '../lib/api';
import { addDays, todayIso } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { CoachSession, Planning, PlayerSession } from '../lib/types';
import { hourText, rainDuring, rainWindow, sky, useWeather, windowText, type Weather } from '../lib/weather';
import { IconWind } from './ui/Icons';

type Concerned = { key: string; text: string };

/** « A, B, C et 4 autres » : trois séances au plus dans la fenêtre. */
const shortList = (items: string[], t: (s: string) => string) =>
  items.length <= 3 ? items.join(', ') : `${items.slice(0, 3).join(', ')} ${t('et')} ${items.length - 3} ${t(items.length - 3 > 1 ? 'autres' : 'autre')}`;

/**
 * Météo de Sayada en haut à droite (à côté de la cloche) : icône et température, fond rose si de la pluie est prévue
 * aujourd'hui ; toucher ouvre le détail (heures à venir, vent, séances concernées). Information seulement :
 * l'annulation d'une séance reste une décision de la direction (« Annuler la séance » dans le planning).
 */
export function WeatherButton() {
  const { t } = useI18n();
  const me = useMe();
  const q = useWeather();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const w = q.data;
  const today = todayIso();
  const rain = rainWindow(w, today);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  if (!w?.available || !w.current) return null;
  const now = sky(w.current.code);
  const Icon = rain ? sky(61).icon : now.icon;
  const status = rain ? (rain.from <= new Date().getHours() ? t('Pluie') : `${t('Pluie à')} ${hourText(rain.from)}`) : t(now.label);
  const label = `${t('Météo à')} ${w.place} : ${w.current.temp} °C, ${status}`;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`relative flex h-[42px] items-center gap-1.5 rounded-[15px] px-3 text-[14px] font-medium text-fg ${rain ? 'bg-topay' : 'bg-btn'}`}
      >
        <Icon size={22} />
        <span className="font-semibold tabular-nums">{w.current.temp}°</span>
        <span className="hidden whitespace-nowrap text-mut nav:inline">{status}</span>
        {rain && <span aria-hidden="true" className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-pr nav:hidden" />}
      </button>
      {open && <WeatherPanel id={id} w={w} me={me} />}
    </div>
  );
}

function WeatherPanel({ id, w, me }: { id: string; w: Weather; me: ReturnType<typeof useMe> }) {
  const { t } = useI18n();
  const today = todayIso();
  const tomorrow = addDays(today, 1);
  const rain = rainWindow(w, today);
  const rainTomorrow = rain ? null : rainWindow(w, tomorrow);
  const now = sky(w.current!.code);
  const Icon = now.icon;
  const concerned = useConcerned(me, w, !!rain);
  const staff = me.space === 'admin';

  return (
    <div
      id={id}
      role="dialog"
      aria-label={`${t('Météo à')} ${w.place}`}
      className="fixed inset-x-4 top-[calc(66px+env(safe-area-inset-top,0px))] z-40 rounded-[24px] nav:absolute nav:inset-x-auto nav:end-0 nav:top-[50px] nav:w-[370px] border-[1.5px] border-line bg-card p-4 text-fg"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-[46px] w-[46px] flex-none place-items-center rounded-[15px] bg-fld">
          <Icon size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-mut">
            {t('Météo à')} {w.place} · {t('maintenant')}
          </div>
          <div className="text-[19px] font-semibold">
            {w.current!.temp} °C <span className="text-[14px] font-medium">· {t(now.label)}</span>
          </div>
        </div>
        <div className="flex-none text-end text-[12.5px] leading-snug text-mut">
          <span className="inline-flex items-center gap-1">
            <IconWind size={14} /> {w.current!.wind} km/h
          </span>
          <br />
          {t('Pluie')} {w.current!.rain} %
        </div>
      </div>

      <div className="mt-3 flex gap-1" aria-label={t('Heures à venir')}>
        {w.hours.slice(0, 7).map((h) => {
          const s = sky(h.code);
          const H = s.icon;
          const wet = h.rain >= 50;
          return (
            <div key={h.time} className={`flex flex-1 flex-col items-center rounded-[13px] px-0.5 py-1.5 ${wet ? 'bg-topay' : 'bg-fld'}`} title={`${t(s.label)}, ${t('pluie')} ${h.rain} %`}>
              <span className="text-[11px] text-mut">{hourText(Number(h.time.slice(11, 13)))}</span>
              <H size={17} className="my-0.5" />
              <b className="text-[13px] font-semibold tabular-nums">{h.temp}°</b>
              <span className={`text-[10.5px] tabular-nums ${wet ? 'font-semibold text-fg' : 'text-mut'}`}>{h.rain} %</span>
            </div>
          );
        })}
      </div>

      {rain ? (
        <div className="mt-3 rounded-[16px] bg-topay px-3 py-2.5 text-[13px] leading-snug">
          <b className="font-semibold">
            {t('Pluie prévue')} {windowText(rain)} ({rain.max} %).
          </b>{' '}
          {concerned === undefined
            ? ''
            : staff
              ? concerned.length
                ? `${concerned.length} ${t(concerned.length > 1 ? 'séances concernées' : 'séance concernée')} : ${shortList(concerned.map((c) => c.text), t)}. ${t('L’annulation reste votre décision.')}`
                : t('Aucune séance concernée.')
              : concerned.length
                ? `${concerned.map((c) => c.text).join(', ')} : ${t('pluie probable. Si la séance est annulée, vous serez prévenu.')}`
                : ''}
          {staff && me.permissions.some((p) => p === 'planning.view' || p === 'groups.manage') && (
            <>
              {' '}
              <Link to="/admin/planning" className="font-semibold underline">
                {t('Voir le planning')}
              </Link>
            </>
          )}
        </div>
      ) : rainTomorrow ? (
        <p className="m-0 mt-3 text-[13px] text-mut">
          {t('Demain : pluie prévue')} {windowText(rainTomorrow)} ({rainTomorrow.max} %).
        </p>
      ) : (
        <p className="m-0 mt-3 text-[12.5px] text-mut">{t('Pas de pluie prévue aujourd’hui.')}</p>
      )}
      <p className="m-0 mt-2 text-[11.5px] text-mut">
        {t('Prévisions')} {w.source ?? 'Open-Meteo'}, {t('mises à jour toutes les 30 min.')}
      </p>
    </div>
  );
}

/** Séances du jour touchées par la pluie, selon l'espace (lues seulement quand de la pluie est prévue). */
function useConcerned(me: ReturnType<typeof useMe>, w: Weather, rain: boolean): Concerned[] | undefined {
  const today = todayIso();
  const planningPerm = me.space === 'admin' && me.permissions.some((p) => p === 'planning.view' || p === 'groups.manage');
  const planning = useQuery({ queryKey: ['planning', today], queryFn: () => api.get<Planning>('/planning', { date: today }), enabled: rain && planningPerm });
  const coach = useQuery({
    queryKey: ['weather', 'coach-sessions', today],
    queryFn: () => api.get<CoachSession[]>('/sessions', { from: today, to: today }),
    enabled: rain && me.space === 'coach',
  });
  const family = me.space === 'parent' || me.space === 'player' ? me.players : [];
  const kids = useQueries({
    queries: family.map((k) => ({
      queryKey: ['weather', 'player-sessions', k.id],
      queryFn: () => api.get<{ sessions: PlayerSession[] }>('/sessions/player', { playerId: k.id }).catch(() => ({ sessions: [] as PlayerSession[] })),
      enabled: rain,
    })),
  });
  if (!rain) return [];
  if (me.space === 'admin') {
    if (!planningPerm) return [];
    if (!planning.data) return undefined;
    return planning.data.sessions
      .filter((s) => s.resolution !== 'CANCELLED' && rainDuring(w, today, s.startTime, s.endTime) !== null)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((s) => ({ key: s.id, text: `${s.group.name} ${s.startTime}` }));
  }
  if (me.space === 'coach') {
    if (!coach.data) return undefined;
    return coach.data
      .filter((s) => s.date === today && s.resolution !== 'CANCELLED' && rainDuring(w, today, s.startTime, s.endTime) !== null)
      .map((s) => ({ key: s.slotId, text: `${s.groupName} ${s.startTime}` }));
  }
  if (kids.some((k) => !k.data)) return undefined;
  // Une ligne par enfant : « Séances de Yassine à 17:30 et 19:00 ».
  return kids.flatMap((k, i) => {
    const times = (k.data?.sessions ?? [])
      .filter((s) => s.date === today && !s.change && s.resolution !== 'CANCELLED' && rainDuring(w, today, s.startTime, s.endTime) !== null)
      .map((s) => s.startTime)
      .sort();
    if (!times.length) return [];
    const at = times.length > 1 ? `${times.slice(0, -1).join(', ')} et ${times[times.length - 1]}` : times[0];
    const who = me.space === 'parent' ? ` de ${family[i].firstName}` : '';
    return [{ key: family[i].id, text: `${times.length > 1 ? 'Séances' : 'Séance'}${who} à ${at}` }];
  });
}
