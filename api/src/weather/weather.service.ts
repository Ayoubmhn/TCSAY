import { Injectable, Logger } from '@nestjs/common';

/** Une heure de prévision (heure locale du club, ex. « 2026-11-18T17:00 »). */
export interface WeatherHour {
  time: string;
  temp: number;
  /** Code météo OMM (0 ciel dégagé, 61 pluie, 95 orage…). */
  code: number;
  /** Probabilité de pluie en %. */
  rain: number;
}

export interface Weather {
  available: boolean;
  place: string;
  updatedAt: string | null;
  current: { time: string; temp: number; code: number; wind: number; rain: number } | null;
  /** De l'heure en cours à la fin du surlendemain. */
  hours: WeatherHour[];
}

const TTL = 30 * 60_000; // relu toutes les 30 min
const STALE = 3 * 3600_000; // service injoignable : dernière prévision gardée 3 h

/**
 * Météo à l'emplacement du club, lue chez Open-Meteo (gratuit, sans clé, aucune donnée personnelle envoyée :
 * seulement les coordonnées du club). Une seule lecture toutes les 30 min pour tous les comptes.
 * Réglages (api/.env) : `WEATHER=off` coupe la météo, `WEATHER_LAT` / `WEATHER_LON` (Sayada par défaut),
 * `WEATHER_PLACE` ; `WEATHER_BASE_URL` ne sert qu'aux tests (faux serveur local).
 */
@Injectable()
export class WeatherService {
  private readonly log = new Logger('Météo');
  private cache: { at: number; data: Weather } | null = null;
  private pending: Promise<Weather> | null = null;

  private get place() {
    return process.env.WEATHER_PLACE?.trim() || 'Sayada';
  }

  private off(): Weather {
    return { available: false, place: this.place, updatedAt: null, current: null, hours: [] };
  }

  async get(): Promise<Weather> {
    if (process.env.WEATHER?.trim().toLowerCase() === 'off') return this.off();
    if (this.cache && Date.now() - this.cache.at < TTL) return this.trim(this.cache.data);
    this.pending ??= this.fetch().finally(() => (this.pending = null));
    return this.trim(await this.pending);
  }

  /** Retire les heures déjà passées (le cache peut avoir 30 min). */
  private trim(w: Weather): Weather {
    if (!w.available) return w;
    const now = localHour(new Date());
    return { ...w, hours: w.hours.filter((h) => h.time >= now) };
  }

  private async fetch(): Promise<Weather> {
    const lat = Number(process.env.WEATHER_LAT ?? 35.6717);
    const lon = Number(process.env.WEATHER_LON ?? 10.8936);
    const base = (process.env.WEATHER_BASE_URL?.trim() || 'https://api.open-meteo.com').replace(/\/$/, '');
    const url =
      `${base}/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=Africa%2FTunis&forecast_days=3` +
      '&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code';
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`réponse ${res.status}`);
      const data = parse(await res.json());
      this.cache = { at: Date.now(), data: { ...data, place: this.place } };
      return this.cache.data;
    } catch (e) {
      this.log.warn(`Prévision indisponible : ${(e as Error).message}`);
      if (this.cache && Date.now() - this.cache.at < STALE) return this.cache.data;
      // Nouvel essai dans 5 min seulement (pas d'appel à chaque requête quand le service est injoignable).
      this.cache = { at: Date.now() - TTL + 5 * 60_000, data: this.off() };
      return this.cache.data;
    }
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Heure locale du serveur (fuseau du club) au format Open-Meteo, minutes à zéro. */
export const localHour = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;

interface OpenMeteo {
  current?: { time?: string; temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
  hourly?: { time?: string[]; temperature_2m?: number[]; precipitation_probability?: (number | null)[]; weather_code?: number[] };
}

/** Réponse d'Open-Meteo → format du club (valeurs arrondies, heures manquantes ignorées). */
export function parse(raw: unknown): Weather {
  const r = raw as OpenMeteo;
  const h = r.hourly;
  if (!r.current || !h?.time?.length) throw new Error('réponse inattendue');
  const hours: WeatherHour[] = h.time
    .map((time, i) => ({
      time,
      temp: Math.round(h.temperature_2m?.[i] ?? NaN),
      code: h.weather_code?.[i] ?? NaN,
      rain: Math.round(h.precipitation_probability?.[i] ?? 0),
    }))
    .filter((x) => Number.isFinite(x.temp) && Number.isFinite(x.code));
  const time = r.current.time ?? localHour(new Date());
  const hour = hours.find((x) => x.time.slice(0, 13) === time.slice(0, 13));
  return {
    available: true,
    place: 'Sayada',
    updatedAt: new Date().toISOString(),
    current: {
      time,
      temp: Math.round(r.current.temperature_2m ?? hour?.temp ?? 0),
      code: r.current.weather_code ?? hour?.code ?? 0,
      wind: Math.round(r.current.wind_speed_10m ?? 0),
      rain: hour?.rain ?? 0,
    },
    hours,
  };
}
