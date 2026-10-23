import { Logger } from '@nestjs/common';

/**
 * Alertes du serveur sur Telegram (sans bibliothèque : un appel HTTPS à l'API des bots).
 * Réglages dans api/.env : TELEGRAM_BOT_TOKEN (donné par @BotFather) et TELEGRAM_CHAT_ID (votre conversation).
 * Sans ces deux valeurs, rien n'est envoyé. Guide : docs/ALERTES_TELEGRAM.md.
 *
 * Jamais de donnée personnelle dans une alerte : adresse de la page sans ses paramètres, identifiant du compte
 * (pas son nom), message d'erreur raccourci. Une même alerte n'est envoyée qu'une fois par 10 minutes (les
 * répétitions sont comptées et annoncées à l'envoi suivant), et au plus 30 alertes par heure.
 */
export type AlertLevel = 'error' | 'warn' | 'info';

const REPEAT_MS = 10 * 60_000;
const MAX_PER_HOUR = 30;
const ICON: Record<AlertLevel, string> = { error: '🔴', warn: '🟠', info: '🟢' };

const logger = new Logger('Alertes');
const seen = new Map<string, { at: number; repeats: number }>();
let sentThisHour: number[] = [];
let errorsToday = 0;

const config = () => ({
  token: process.env.TELEGRAM_BOT_TOKEN?.trim(),
  chat: process.env.TELEGRAM_CHAT_ID?.trim(),
  base: (process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org').replace(/\/$/, ''), // autre adresse : tests seulement
});

export const alertsEnabled = () => {
  const c = config();
  return Boolean(c.token && c.chat);
};

/** Nombre d'erreurs signalées depuis le dernier résumé (remis à zéro par takeErrorCount). */
export function takeErrorCount(): number {
  const n = errorsToday;
  errorsToday = 0;
  return n;
}

/** Retire les adresses email et les numéros de téléphone qu'un message d'erreur pourrait contenir. */
export const hidePersonal = (text: string) =>
  text.replace(/[^\s<>@()'"]+@[^\s<>@()'"]+/g, '<email>').replace(/(?<![\w.-])\+?\d[\d .-]{7,}\d(?![\w.-])/g, '<numéro>');

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Nom de l'instance dans le titre (démo, production…) : ALERT_INSTANCE, sinon le nom du service Render. */
const instance = () => process.env.ALERT_INSTANCE ?? process.env.RENDER_SERVICE_NAME ?? 'TCSAY';

/**
 * Envoie une alerte (sans jamais lever d'erreur ni bloquer la requête en cours).
 * `key` regroupe les alertes identiques (par défaut : le titre).
 */
export async function alert(level: AlertLevel, title: string, lines: string[] = [], key = title): Promise<boolean> {
  if (level === 'error') errorsToday++;
  const c = config();
  if (!c.token || !c.chat) return false;

  const now = Date.now();
  const prev = seen.get(key);
  if (prev && now - prev.at < REPEAT_MS) {
    prev.repeats++;
    return false;
  }
  sentThisHour = sentThisHour.filter((t) => now - t < 3_600_000);
  if (sentThisHour.length >= MAX_PER_HOUR) return false;
  seen.set(key, { at: now, repeats: 0 });
  sentThisHour.push(now);
  if (seen.size > 500) for (const [k, v] of seen) if (now - v.at > REPEAT_MS) seen.delete(k);

  const repeats = prev?.repeats ? [`(répétée ${prev.repeats} fois depuis la dernière alerte)`] : [];
  const time = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Tunis' });
  const text = short(hidePersonal([`${ICON[level]} ${instance()} · ${title}`, ...lines, ...repeats, time].join('\n')), 3500);
  try {
    const res = await fetch(`${c.base}/bot${c.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: c.chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) logger.warn(`Telegram a refusé l'alerte (${res.status}) : vérifiez TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID.`);
    return res.ok;
  } catch (e) {
    logger.warn(`Alerte Telegram non envoyée : ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** Description courte d'une erreur : message et premières lignes de la pile qui viennent du code du club. */
export function describeError(e: unknown): string[] {
  if (!(e instanceof Error)) return [short(String(e), 300)];
  const stack = (e.stack ?? '')
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at ') && !l.includes('node_modules') && !l.includes('node:'))
    .slice(0, 3)
    .map((l) => short(l.replace(/\(.*[\\/](src|dist)[\\/]/, '($1/'), 160));
  return [`${e.name} : ${short(e.message.replace(/\s+/g, ' ').trim(), 300)}`, ...stack];
}

/** Remet les compteurs à zéro (tests). */
export function resetAlerts() {
  seen.clear();
  sentThisHour = [];
  errorsToday = 0;
}
