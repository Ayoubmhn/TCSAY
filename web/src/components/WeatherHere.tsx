import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { appCanLocate, isInApp } from '../lib/pwa';
import { todayIso } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { rainWindow, sky, windowText, type Weather } from '../lib/weather';
import { IconPin } from './ui/Icons';

const KEY = 'tcsay-weather-here';
const NEAR_KM = 5;

const remembered = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
const remember = (on: boolean) => {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible */
  }
};

/** Distance en km entre deux points (formule de haversine), calculée sur l'appareil. */
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

type State = { kind: 'idle' } | { kind: 'asking' } | { kind: 'denied' } | { kind: 'unavailable' } | { kind: 'near' } | { kind: 'here'; lat: number; lon: number; km: number };

/**
 * « Chez vous » dans la fenêtre météo : météo à la position de la personne, comparée au club (ex. soleil chez soi,
 * pluie au club). Seulement si elle l'accepte (bouton, ou localisation déjà autorisée pour le site) ; position
 * arrondie à 0,1° (≈ 10 km) sur l'appareil avant l'envoi, jamais enregistrée ; le choix reste sur l'appareil.
 */
export function WeatherHere({ club }: { club: Weather & { lat?: number; lon?: number } }) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const locate = useCallback(() => {
    if (!supported) return setState({ kind: 'unavailable' });
    setState({ kind: 'asking' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        remember(true);
        const r = (x: number) => Math.round(x * 10) / 10;
        const here = { lat: r(pos.coords.latitude), lon: r(pos.coords.longitude) };
        const d = club.lat !== undefined && club.lon !== undefined ? km(here, { lat: club.lat, lon: club.lon }) : NEAR_KM + 1;
        setState(d < NEAR_KM ? { kind: 'near' } : { kind: 'here', ...here, km: Math.round(d) });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) remember(false);
        setState({ kind: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30 * 60_000 },
    );
  }, [club.lat, club.lon, supported]);

  // Localisation déjà acceptée (sur cet appareil, ou autorisée pour le site) : la comparaison s'affiche d'elle-même.
  useEffect(() => {
    if (!supported) return;
    if (remembered()) return locate();
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => p.state === 'granted' && locate())
      .catch(() => undefined);
  }, [locate, supported]);

  const q = useQuery({
    queryKey: ['weather', 'here', state.kind === 'here' ? `${state.lat},${state.lon}` : ''],
    queryFn: () => api.get<Weather>('/weather/here', state.kind === 'here' ? { lat: state.lat, lon: state.lon } : {}),
    enabled: state.kind === 'here',
    staleTime: 15 * 60_000,
    retry: false,
  });

  const stop = () => {
    remember(false);
    setState({ kind: 'idle' });
  };

  if (!supported) return null;
  const box = 'mt-3 rounded-[16px] bg-fld px-3 py-2.5 text-[13px] leading-snug';

  // Ancienne application Android (avant 0.7) : pas de permission de localisation, la WebView refuse sans rien demander.
  if (isInApp() && !appCanLocate())
    return <p className={`${box} m-0 text-mut`}>{t('Mettez à jour l’application TCSAY (version 0.7 ou plus) pour comparer avec la météo chez vous.')}</p>;
  if (state.kind === 'idle')
    return (
      <button type="button" onClick={locate} className="mt-3 flex w-full items-center gap-2 rounded-[16px] bg-fld px-3 py-2.5 text-start text-[13px] hover:bg-btn">
        <IconPin size={18} />
        <span className="flex-1">
          <b className="block font-semibold">{t('Voir la météo chez moi')}</b>
          <span className="text-[12px] text-mut">{t('Pour comparer avec le club. Position arrondie à 10 km, jamais enregistrée.')}</span>
        </span>
      </button>
    );
  if (state.kind === 'asking') return <p className={`${box} m-0 text-mut`}>{t('Localisation…')}</p>;
  if (state.kind === 'denied')
    return (
      <p className={`${box} m-0 text-mut`}>
        {isInApp()
          ? t('Localisation refusée : Réglages du téléphone › Applications › TCSAY › Autorisations › Position, puis « Position précise ».')
          : t('Localisation refusée : autorisez-la pour ce site dans les réglages du navigateur pour comparer avec le club.')}{' '}
        <button type="button" className="font-semibold text-fg underline" onClick={locate}>
          {t('Réessayer')}
        </button>
      </p>
    );
  if (state.kind === 'unavailable')
    return (
      <p className={`${box} m-0 text-mut`}>
        {t('Position indisponible sur cet appareil.')}{' '}
        <button type="button" className="font-semibold text-fg underline" onClick={locate}>
          {t('Réessayer')}
        </button>
      </p>
    );
  if (state.kind === 'near')
    return (
      <p className={`${box} m-0 flex items-center gap-2`}>
        <IconPin size={16} /> {t('Vous êtes près du club : même météo.')}
      </p>
    );

  const here = q.data;
  if (!here?.available || !here.current || !club.current)
    return <p className={`${box} m-0 text-mut`}>{q.isPending ? t('Météo chez vous…') : t('Météo chez vous indisponible pour le moment.')}</p>;

  const today = todayIso();
  const clubRain = rainWindow(club, today);
  const hereRain = rainWindow(here, today);
  const hereSky = sky(here.current.code);
  const diff = club.current.temp - here.current.temp;
  const [tone, text] = clubRain && !hereRain
    ? ['bg-topay', `${t(hereSky.label)} ${t('chez vous, mais pluie prévue au club')} ${windowText(clubRain)} (${clubRain.max} %).`]
    : hereRain && !clubRain
      ? ['bg-pb text-ink', `${t('Pluie chez vous, mais pas au club : les séances sont maintenues sauf annonce.')}`]
      : hereRain && clubRain
        ? ['bg-topay', t('Pluie prévue chez vous et au club.')]
        : Math.abs(diff) >= 3
          ? ['bg-fld', `${t('Au club :')} ${club.current.temp}° (${diff > 0 ? '+' : ''}${diff}° ${t('par rapport à chez vous')}).`]
          : ['bg-fld', t('Même temps qu’au club.')];
  const Col = ({ title, w }: { title: string; w: Weather }) => {
    const s = sky(w.current!.code);
    const I = s.icon;
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[14px] bg-fld px-2.5 py-2">
        <I size={22} />
        <span className="min-w-0">
          <span className="block truncate text-[11.5px] text-mut">{title}</span>
          <b className="text-[14px] font-semibold tabular-nums">{w.current!.temp}°</b> <span className="text-[12px]">{t(s.label)}</span>
        </span>
      </div>
    );
  };

  return (
    <div className="mt-3">
      <div className="flex gap-1.5">
        <Col title={t('Au club')} w={club} />
        <Col title={`${t('Chez vous')} · ${state.km} km`} w={here} />
      </div>
      <p className={`m-0 mt-1.5 rounded-[14px] px-3 py-2 text-[13px] leading-snug ${tone}`}>{text}</p>
      <button type="button" onClick={stop} className="mt-1 text-[11.5px] text-mut underline">
        {t('Ne plus utiliser ma position')}
      </button>
    </div>
  );
}
