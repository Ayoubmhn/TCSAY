import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Notifications push sur cet appareil (service worker + clé VAPID du serveur, aucune bibliothèque). */

export type PushState = 'unsupported' | 'dev' | 'ios-install' | 'denied' | 'off' | 'on';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

async function currentState(): Promise<PushState> {
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!supported()) return ios && !standalone ? 'ios-install' : 'unsupported';
  if (!import.meta.env.PROD) return 'dev';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? 'on' : 'off';
}

export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.get<{ publicKey: string }>('/push/key');
  let sub = await reg.pushManager.getSubscription();
  // Clé du serveur changée : on refait l'abonnement.
  const current = sub?.options.applicationServerKey;
  if (sub && current) {
    const bytes = new Uint8Array(current);
    const wanted = base64UrlToBytes(publicKey);
    if (bytes.length !== wanted.length || bytes.some((b, i) => b !== wanted[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent.slice(0, 300) });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return 'off';
}

/** Désabonne l'appareil à la déconnexion (les notifications d'un compte ne doivent pas arriver chez le suivant). */
export async function unsubscribeOnLogout(): Promise<void> {
  try {
    // Désabonnement local seulement (le jeton est déjà effacé) : le serveur supprime l'abonnement au prochain envoi (410).
    const reg = await registration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    await sub?.unsubscribe();
  } catch {
    /* sans effet */
  }
}

export function usePush() {
  const [state, setState] = useState<PushState | null>(null);
  const refresh = useCallback(() => void currentState().then(setState), []);
  useEffect(refresh, [refresh]);
  return { state, setState, refresh };
}
