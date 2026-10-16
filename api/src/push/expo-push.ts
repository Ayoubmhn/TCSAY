/**
 * Notifications de l'application mobile (APK) par le service push d'Expo, qui les remet à Firebase Cloud Messaging
 * (Android) ou à APNs (iPhone). Simple requête HTTPS, aucune bibliothèque. Jeton d'accès facultatif : EXPO_ACCESS_TOKEN.
 */
export type ExpoMessage = { to: string; title: string; body: string; data: Record<string, string> };

/** Résultat par message, dans l'ordre : envoyé, appareil désinscrit (jeton à supprimer) ou autre erreur. */
export type ExpoResult = { ok: true } | { ok: false; unregistered: boolean; error: string };

const URL = 'https://exp.host/--/api/v2/push/send';
/** Le service accepte 100 messages par requête. */
const BATCH = 100;

export const isExpoToken = (token: string) => /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/.test(token);

type Ticket = { status: 'ok' | 'error'; message?: string; details?: { error?: string } };

export async function sendExpoPush(messages: ExpoMessage[], accessToken = process.env.EXPO_ACCESS_TOKEN): Promise<ExpoResult[]> {
  const results: ExpoResult[] = [];
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(batch.map((m) => ({ ...m, sound: 'default', channelId: 'default', priority: 'high' }))),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => null)) as { data?: Ticket[]; errors?: { message?: string }[] } | null;
    if (!res.ok || !Array.isArray(json?.data)) {
      const error = json?.errors?.[0]?.message ?? `réponse ${res.status}`;
      results.push(...batch.map(() => ({ ok: false as const, unregistered: false, error })));
      continue;
    }
    for (const t of json.data) {
      if (t.status === 'ok') results.push({ ok: true });
      else results.push({ ok: false, unregistered: t.details?.error === 'DeviceNotRegistered', error: t.details?.error ?? t.message ?? 'erreur' });
    }
  }
  return results;
}
