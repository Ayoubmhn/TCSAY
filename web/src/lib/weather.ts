import { useQuery } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { IconCloud, IconCloudSun, IconRain, IconStorm, IconSun } from '../components/ui/Icons';
import { api } from './api';

/** Météo de Sayada renvoyée par l'API (`GET /weather`, lue chez Open-Meteo toutes les 30 min). */
export type WeatherHour = { time: string; temp: number; code: number; rain: number };
export type Weather = {
  available: boolean;
  place: string;
  updatedAt: string | null;
  current: { time: string; temp: number; code: number; wind: number; rain: number } | null;
  hours: WeatherHour[];
};

/** À partir de cette probabilité, une heure est « pluie prévue ». */
export const RAIN_PCT = 50;

export function useWeather() {
  return useQuery({
    queryKey: ['weather'],
    queryFn: () => api.get<Weather>('/weather'),
    staleTime: 15 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: false,
  });
}

type Sky = { label: string; icon: ComponentType<{ size?: number; className?: string }>; wet: boolean };

/** Code météo OMM → libellé français et icône. */
export function sky(code: number): Sky {
  if (code === 0) return { label: 'Ciel dégagé', icon: IconSun, wet: false };
  if (code <= 2) return { label: 'Peu nuageux', icon: IconCloudSun, wet: false };
  if (code === 3) return { label: 'Couvert', icon: IconCloud, wet: false };
  if (code === 45 || code === 48) return { label: 'Brouillard', icon: IconCloud, wet: false };
  if (code >= 51 && code <= 57) return { label: 'Bruine', icon: IconRain, wet: true };
  if (code >= 61 && code <= 67) return { label: 'Pluie', icon: IconRain, wet: true };
  if (code >= 71 && code <= 77) return { label: 'Neige', icon: IconCloud, wet: true };
  if (code >= 80 && code <= 82) return { label: 'Averses', icon: IconRain, wet: true };
  if (code >= 95) return { label: 'Orage', icon: IconStorm, wet: true };
  return { label: 'Nuageux', icon: IconCloud, wet: false };
}

const hourOf = (t: string) => Number(t.slice(11, 13));
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Heures d'un jour (AAAA-MM-JJ) encore à venir dans la prévision. */
export const hoursOn = (w: Weather | undefined, date: string) => (w?.available ? w.hours.filter((h) => h.time.startsWith(date)) : []);

/** Pluie prévue pendant un créneau (« 17:30 » → « 19:00 ») : probabilité la plus forte, ou null sous le seuil. */
export function rainDuring(w: Weather | undefined, date: string, start: string, end: string): number | null {
  const a = toMin(start);
  const b = toMin(end);
  const max = Math.max(0, ...hoursOn(w, date).filter((h) => hourOf(h.time) * 60 < b && hourOf(h.time) * 60 + 60 > a).map((h) => h.rain));
  return max >= RAIN_PCT ? max : null;
}

/** Première période de pluie d'un jour (heures consécutives au-dessus du seuil), ex. { from: 17, to: 20, max: 90 }. */
export function rainWindow(w: Weather | undefined, date: string): { from: number; to: number; max: number } | null {
  const wet = hoursOn(w, date).filter((h) => h.rain >= RAIN_PCT);
  if (!wet.length) return null;
  const from = hourOf(wet[0].time);
  let to = from + 1;
  let max = wet[0].rain;
  for (const h of wet.slice(1)) {
    if (hourOf(h.time) !== to) break;
    to += 1;
    max = Math.max(max, h.rain);
  }
  return { from, to, max };
}

/** « 17 h » / « de 17 h à 20 h ». */
export const hourText = (h: number) => `${h} h`;
export const windowText = (r: { from: number; to: number }) => (r.to - r.from <= 1 ? `vers ${hourText(r.from)}` : `de ${hourText(r.from)} à ${hourText(r.to)}`);
