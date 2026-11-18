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
  /** Service qui a donné la prévision (Open-Meteo, MET Norway). */
  source?: string;
  /** Prévision absente ou ancienne : raison (ex. « réponse 429 », « délai dépassé »), pour vérifier l'installation. */
  error?: string;
}

const TTL = 30 * 60_000; // relu toutes les 30 min
const RETRY = 10 * 60_000; // services en échec : nouvel essai dans 10 min
const STALE = 24 * 3600_000; // dernière bonne prévision gardée 24 h

/**
 * Météo à l'emplacement du club, lue chez Open-Meteo, ou MET Norway en secours (gratuits, sans clé, aucune donnée
 * personnelle envoyée : seulement les coordonnées du club). Une seule lecture toutes les 30 min pour tous les comptes.
 * Réglages (api/.env) : `WEATHER=off` coupe la météo, `WEATHER_LAT` / `WEATHER_LON` (Sayada par défaut),
 * `WEATHER_PLACE` ; `WEATHER_BASE_URL` / `WEATHER_MET_URL` ne servent qu'aux tests (faux serveurs locaux).
 */
@Injectable()
export class WeatherService {
  private readonly log = new Logger('Météo');
  /** Prévisions gardées par lieu (« lat,lon » arrondis) : le club et les positions demandées par les familles. */
  private readonly cells = new Map<string, { next: number; data: Weather; good?: Weather }>();
  private readonly pending = new Map<string, Promise<Weather>>();

  private get place() {
    return process.env.WEATHER_PLACE?.trim() || 'Sayada';
  }

  /** Coordonnées du club (publiques : c'est l'adresse du club). */
  get club() {
    return { lat: Number(process.env.WEATHER_LAT ?? 35.6717), lon: Number(process.env.WEATHER_LON ?? 10.8936) };
  }

  private off(place: string, error?: string): Weather {
    return { available: false, place, updatedAt: null, current: null, hours: [], ...(error ? { error } : {}) };
  }

  /** Météo du club. */
  async get(): Promise<Weather & { lat: number; lon: number }> {
    const { lat, lon } = this.club;
    return { ...(await this.at(lat, lon, this.place)), lat, lon };
  }

  /**
   * Météo à la position d'une personne (bouton « Ma position »). Arrondie à 0,1° (environ 10 km) avant tout usage :
   * la position exacte n'est jamais envoyée au service météo, jamais enregistrée ni écrite dans les journaux.
   */
  async here(lat: number, lon: number): Promise<Weather> {
    const r = (x: number) => Math.round(x * 10) / 10;
    return this.at(r(lat), r(lon), 'Votre position');
  }

  private async at(lat: number, lon: number, place: string): Promise<Weather> {
    if (process.env.WEATHER?.trim().toLowerCase() === 'off') return this.off(place, 'météo coupée (WEATHER=off)');
    const key = `${lat},${lon}`;
    const cell = this.cells.get(key);
    if (cell && Date.now() < cell.next) return this.trim(cell.data);
    let p = this.pending.get(key);
    if (!p) {
      p = this.refresh(key, lat, lon, place).finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return this.trim(await p);
  }

  /** Retire les heures déjà passées (la prévision gardée peut dater de plusieurs heures). */
  private trim(w: Weather): Weather {
    if (!w.available) return w;
    const now = localHour(new Date());
    const hours = w.hours.filter((h) => h.time >= now);
    return hours.length ? { ...w, hours } : this.off(w.place, w.error ?? 'prévision trop ancienne');
  }

  /**
   * Open-Meteo d'abord, MET Norway en secours (l'adresse IP de sortie d'un hébergeur gratuit est partagée :
   * Open-Meteo peut répondre 429). Les deux en échec : dernière bonne prévision gardée 24 h, nouvel essai dans 10 min.
   */
  private async refresh(key: string, lat: number, lon: number, place: string): Promise<Weather> {
    const errors: string[] = [];
    const old = this.cells.get(key);
    for (const [name, read] of [
      ['Open-Meteo', () => readOpenMeteo(lat, lon)],
      ['MET Norway', () => readMetNorway(lat, lon)],
    ] as const) {
      try {
        const data = { ...(await read()), place };
        this.keep(key, { next: Date.now() + TTL, data, good: data });
        return data;
      } catch (e) {
        errors.push(`${name} : ${reasonOf(e)}`);
      }
    }
    const error = `prévision injoignable (${errors.join(' ; ')})`;
    this.log.warn(place === this.place ? error : `${error} (position d'une personne)`);
    const good = old?.good && Date.now() - new Date(old.good.updatedAt ?? 0).getTime() < STALE ? old.good : undefined;
    const data = good ? { ...good, error } : this.off(place, error);
    this.keep(key, { next: Date.now() + RETRY, data, good });
    return data;
  }

  /** 300 lieux au plus en mémoire (les plus anciens oubliés). */
  private keep(key: string, cell: { next: number; data: Weather; good?: Weather }) {
    this.cells.delete(key);
    this.cells.set(key, cell);
    while (this.cells.size > 300) this.cells.delete(this.cells.keys().next().value!);
  }
}

const reasonOf = (e: unknown) => {
  const err = e as Error & { cause?: { code?: string } };
  return err.name === 'TimeoutError' ? 'délai dépassé (8 s)' : [err.message, err.cause?.code].filter(Boolean).join(' · ');
};

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`réponse ${res.status}`);
  return res.json();
}

function readOpenMeteo(lat: number, lon: number) {
  const base = (process.env.WEATHER_BASE_URL?.trim() || 'https://api.open-meteo.com').replace(/\/$/, '');
  return getJson(
    `${base}/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=Africa%2FTunis&forecast_days=3` +
      '&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code',
  ).then((raw) => ({ ...parse(raw), source: 'Open-Meteo' }));
}

function readMetNorway(lat: number, lon: number) {
  const base = (process.env.WEATHER_MET_URL?.trim() || 'https://api.met.no').replace(/\/$/, '');
  // MET Norway demande des coordonnées à 4 décimales au plus et un User-Agent qui nomme l'application.
  return getJson(`${base}/weatherapi/locationforecast/2.0/complete?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, {
    'user-agent': 'TCSAY-tennis-club/1.0',
  }).then(parseMet);
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

interface MetNorway {
  properties?: {
    timeseries?: {
      time: string;
      data: {
        instant?: { details?: { air_temperature?: number; wind_speed?: number } };
        next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number; probability_of_precipitation?: number } };
      };
    }[];
  };
}

/** Symbole MET Norway (« lightrainshowers_day ») → code OMM utilisé par le site. */
function metCode(symbol = ''): number {
  const s = symbol.replace(/_(day|night|polartwilight)$/, '');
  if (s.includes('thunder')) return 95;
  if (s.includes('snow') || s.includes('sleet')) return 71;
  if (s.includes('showers')) return 80;
  if (s.includes('rain')) return s.startsWith('heavy') ? 65 : s.startsWith('light') ? 61 : 63;
  return { clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45 }[s] ?? 3;
}

/** Réponse de MET Norway → format du club (heures en UTC converties à l'heure du club ; vent m/s → km/h). */
export function parseMet(raw: unknown): Weather {
  const series = (raw as MetNorway).properties?.timeseries ?? [];
  const hours: WeatherHour[] = series
    .filter((t) => t.data.next_1_hours && t.data.instant?.details?.air_temperature !== undefined)
    .map((t) => {
      const n = t.data.next_1_hours!;
      const amount = n.details?.precipitation_amount ?? 0;
      // Probabilité donnée par MET quand elle existe ; sinon déduite de la quantité prévue (mm dans l'heure).
      const rain = n.details?.probability_of_precipitation ?? (amount >= 0.5 ? 80 : amount >= 0.1 ? 55 : amount > 0 ? 30 : 0);
      return { time: localHour(new Date(t.time)), temp: Math.round(t.data.instant!.details!.air_temperature!), code: metCode(n.summary?.symbol_code), rain: Math.round(rain) };
    });
  if (!hours.length) throw new Error('réponse inattendue');
  const first = series[0].data.instant?.details;
  return {
    available: true,
    place: 'Sayada',
    updatedAt: new Date().toISOString(),
    current: { time: hours[0].time, temp: Math.round(first?.air_temperature ?? hours[0].temp), code: hours[0].code, wind: Math.round((first?.wind_speed ?? 0) * 3.6), rain: hours[0].rain },
    hours,
    source: 'MET Norway',
  };
}
