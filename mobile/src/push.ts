import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

/**
 * Notifications du téléphone : autorisation, canal Android, jeton push Expo (FCM sur Android).
 * Le jeton est donné au site (WebView), qui le rattache au compte connecté (`web/src/lib/native-push.ts`).
 */
export type NativePush = { status: 'granted' | 'denied' | 'unavailable'; token?: string; platform: 'android' | 'ios'; error?: string };

const platform = Platform.OS === 'ios' ? 'ios' : 'android';

// Application ouverte : la notification s'affiche quand même en bandeau.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const projectId = (): string | undefined =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;

/** Demande l'autorisation (Android 13+ : fenêtre système) puis obtient le jeton de l'appareil. */
export async function setupPush(ask = true): Promise<NativePush> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'TCSAY',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        lightColor: '#5a5acd',
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && ask) status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return { status: 'denied', platform };
    const id = projectId();
    if (!id) return { status: 'unavailable', platform, error: 'projectId EAS manquant' };
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    return { status: 'granted', token: data, platform };
  } catch (e) {
    return { status: 'unavailable', platform, error: e instanceof Error ? e.message.slice(0, 160) : String(e) };
  }
}

export const openNotificationSettings = () => void Linking.openSettings().catch(() => undefined);

/** Adresse du site à ouvrir pour une notification touchée (`data.link`, ex. « /paiements »). */
export function linkOf(response: Notifications.NotificationResponse | null | undefined): string | null {
  const link = response?.notification.request.content.data?.link;
  return typeof link === 'string' && link.startsWith('/') ? link : null;
}

export { Notifications };
