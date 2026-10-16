import { buildMessage, type MailMessage, type SmtpConfig } from './smtp';

/**
 * Envoi par API HTTPS (port 443), sans bibliothèque : pour les hébergeurs qui bloquent les ports SMTP
 * (Render gratuit bloque 25, 465 et 587 depuis septembre 2025).
 * - `gmail-api` : API Gmail avec un jeton OAuth (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN).
 * - `brevo` : API transactionnelle Brevo (BREVO_API_KEY).
 */
export type MailTransport = 'smtp' | 'gmail-api' | 'brevo';

export function mailTransportFromEnv(env: NodeJS.ProcessEnv = process.env): MailTransport {
  const raw = (env.MAIL_TRANSPORT ?? '').trim().toLowerCase();
  return raw === 'gmail-api' || raw === 'brevo' ? raw : 'smtp';
}

/** Paramètres manquants pour le mode choisi (affichés dans l'écran Emails envoyés). */
export function missingHttpSettings(transport: MailTransport, env: NodeJS.ProcessEnv = process.env): string[] {
  const need =
    transport === 'gmail-api' ? ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'] : transport === 'brevo' ? ['BREVO_API_KEY'] : [];
  return need.filter((k) => !env[k]?.trim());
}

const TIMEOUT_MS = 15000;

async function post(url: string, init: { headers: Record<string, string>; body: string }, label: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Error(`${label} injoignable : ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detail = errorDetail(json) ?? text.slice(0, 200);
    throw new Error(`${label} a refusé l'envoi (${res.status}) : ${detail}`);
  }
  return json;
}

function errorDetail(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const err = o.error;
  if (typeof err === 'string') return typeof o.error_description === 'string' ? `${err} (${o.error_description})` : err;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') return (err as { message: string }).message;
  return typeof o.message === 'string' ? o.message : null;
}

/** Jeton d'accès Gmail (valable environ 1 h), gardé en mémoire. */
let gmailToken: { value: string; expiresAt: number } | null = null;

async function gmailAccessToken(env: NodeJS.ProcessEnv): Promise<string> {
  if (gmailToken && gmailToken.expiresAt > Date.now() + 60_000) return gmailToken.value;
  const json = (await post(
    'https://oauth2.googleapis.com/token',
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GMAIL_CLIENT_ID?.trim() ?? '',
        client_secret: env.GMAIL_CLIENT_SECRET?.trim() ?? '',
        refresh_token: env.GMAIL_REFRESH_TOKEN?.trim() ?? '',
        grant_type: 'refresh_token',
      }).toString(),
    },
    'Google (jeton OAuth)',
  )) as { access_token?: string; expires_in?: number } | null;
  if (!json?.access_token) throw new Error('Google (jeton OAuth) : réponse sans jeton');
  gmailToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return gmailToken.value;
}

async function sendGmailApi(config: SmtpConfig, msg: MailMessage, env: NodeJS.ProcessEnv): Promise<void> {
  const token = await gmailAccessToken(env);
  const raw = Buffer.from(buildMessage(config, msg, { dotStuffing: false }), 'utf8').toString('base64url');
  await post(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) },
    'Gmail',
  );
}

async function sendBrevo(config: SmtpConfig, msg: MailMessage, env: NodeJS.ProcessEnv): Promise<void> {
  await post(
    'https://api.brevo.com/v3/smtp/email',
    {
      headers: { 'api-key': env.BREVO_API_KEY?.trim() ?? '', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: config.fromName, email: config.from },
        to: [{ email: msg.to }],
        ...(config.replyTo ? { replyTo: { email: config.replyTo } } : {}),
        subject: msg.subject,
        textContent: msg.text,
        ...(msg.html ? { htmlContent: msg.html } : {}),
      }),
    },
    'Brevo',
  );
}

/** Envoie par l'API choisie ; lève une erreur lisible (en français) en cas d'échec. */
export async function sendHttp(transport: Exclude<MailTransport, 'smtp'>, config: SmtpConfig, msg: MailMessage, env: NodeJS.ProcessEnv = process.env) {
  const missing = missingHttpSettings(transport, env);
  if (missing.length) throw new Error(`réglage manquant : ${missing.join(', ')}`);
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(msg.to)) throw new Error(`adresse email invalide : ${msg.to}`);
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(config.from)) throw new Error(`adresse email invalide : ${config.from}`);
  if (transport === 'gmail-api') await sendGmailApi(config, msg, env);
  else await sendBrevo(config, msg, env);
}
