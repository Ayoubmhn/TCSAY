import { useEffect, useState } from 'react';
import { api } from './api';
import { isInApp } from './pwa';

/**
 * Notifications du téléphone dans l'application mobile (APK, `mobile/src/app/index.tsx`).
 * L'application demande l'autorisation, obtient le jeton push de l'appareil et le dépose dans `window.__TCSAY_PUSH__`
 * (événement « tcsay-native-push ») ; le site le rattache au compte connecté.
 */
export type NativePush = { status: 'granted' | 'denied' | 'unavailable'; token?: string; platform?: 'android' | 'ios'; error?: string };

declare global {
  interface Window {
    __TCSAY_PUSH__?: NativePush;
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }
}

const EVENT = 'tcsay-native-push';
const read = (): NativePush | null => (isInApp() ? (window.__TCSAY_PUSH__ ?? null) : null);

/** Rattache le jeton de l'appareil au compte connecté (sans effet hors de l'application). */
export async function registerNativePush(): Promise<void> {
  const push = read();
  if (!push?.token) return;
  await api.post('/push/native', { token: push.token, platform: push.platform ?? 'android' }).catch(() => undefined);
}

/** Déconnexion : l'appareil ne reçoit plus les notifications de ce compte. */
export function removeNativePush(): void {
  const push = read();
  if (push?.token) void api.post('/push/native/remove', { token: push.token }).catch(() => undefined);
}

/** Demande à l'application : « enable » (redemander l'autorisation) ou « settings » (ouvrir les réglages Android). */
export function askApp(action: 'enable' | 'settings'): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify({ type: `push-${action}` }));
}

/** Rattache le jeton quand l'application le fournit (souvent après le chargement de la page). */
export function onNativePush(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

export function useNativePush(): NativePush | null {
  const [state, setState] = useState(read);
  useEffect(() => onNativePush(() => setState(read())), []);
  return state;
}
