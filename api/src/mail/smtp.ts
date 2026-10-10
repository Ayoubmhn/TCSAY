import { randomUUID } from 'node:crypto';
import { isIP, connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

/**
 * Client SMTP fait main (aucune bibliothèque) : TLS direct (465), STARTTLS (587) ou sans chiffrement (Mailpit),
 * authentification PLAIN ou LOGIN. Fonctionne avec Gmail, Brevo, OVH, l'hébergeur du domaine…
 */
export type SmtpSecurity = 'tls' | 'starttls' | 'none';

export type SmtpConfig = {
  host: string;
  port: number;
  security: SmtpSecurity;
  user?: string;
  pass?: string;
  from: string;
  fromName: string;
  replyTo?: string;
  heloName: string;
  /** false seulement pour un serveur de test au certificat auto-signé. */
  rejectUnauthorized: boolean;
  timeoutMs: number;
};

export type MailMessage = { to: string; subject: string; text: string; html?: string };

/** Lit la configuration dans api/.env (voir .env.example). */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const port = Number(env.SMTP_PORT || 1025);
  const raw = (env.SMTP_SECURITY ?? '').trim().toLowerCase();
  const security: SmtpSecurity =
    raw === 'tls' || raw === 'starttls' || raw === 'none' ? raw : port === 465 ? 'tls' : port === 587 ? 'starttls' : 'none';
  const from = (env.MAIL_FROM || 'no-reply@tennisclubdesayada.tn').trim();
  return {
    host: (env.SMTP_HOST || 'localhost').trim(),
    port,
    security,
    user: env.SMTP_USER?.trim() || undefined,
    pass: env.SMTP_PASS || undefined,
    from,
    fromName: (env.MAIL_FROM_NAME || 'Tennis Club de Sayada').trim(),
    replyTo: env.MAIL_REPLY_TO?.trim() || undefined,
    heloName: (env.SMTP_HELO || from.split('@')[1] || 'tcsay.local').trim(),
    rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
    timeoutMs: Number(env.SMTP_TIMEOUT_MS || 15000),
  };
}

const isLocalHost = (host: string) => ['localhost', '127.0.0.1', '::1', 'mailpit'].includes(host.toLowerCase());

type Reply = { code: number; lines: string[] };

/** Une connexion SMTP : lecture des réponses (multi-lignes « 250-… » puis « 250 … »), commandes, passage en TLS. */
class SmtpSession {
  private socket?: Socket | TLSSocket;
  private buffer = '';
  private pendingLines: string[] = [];
  private replies: Reply[] = [];
  private waiter?: { resolve: (r: Reply) => void; reject: (e: Error) => void };
  private failure?: Error;
  secure = false;

  constructor(private readonly config: SmtpConfig) {}

  async open(): Promise<void> {
    const { host, port, security } = this.config;
    const socket =
      security === 'tls'
        ? tlsConnect({ host, port, ...this.tlsOptions() })
        : netConnect({ host, port });
    await new Promise<void>((resolve, reject) => {
      socket.once(security === 'tls' ? 'secureConnect' : 'connect', () => resolve());
      socket.once('error', reject);
      socket.setTimeout(this.config.timeoutMs, () => reject(new Error(`connexion à ${host}:${port} : délai dépassé`)));
    });
    this.secure = security === 'tls';
    this.attach(socket);
    await this.expect(await this.read(), [220], 'connexion');
  }

  /** STARTTLS accepté : la même connexion passe en TLS. */
  async upgrade(): Promise<void> {
    const plain = this.socket!;
    plain.removeAllListeners('data');
    plain.removeAllListeners('timeout');
    plain.removeAllListeners('error');
    plain.setTimeout(0);
    const secured = tlsConnect({ socket: plain, ...this.tlsOptions() });
    await new Promise<void>((resolve, reject) => {
      secured.once('secureConnect', () => resolve());
      secured.once('error', reject);
    });
    this.secure = true;
    this.buffer = '';
    this.attach(secured);
  }

  /** EHLO : renvoie les extensions annoncées (STARTTLS, AUTH PLAIN LOGIN…). */
  async ehlo(): Promise<Map<string, string>> {
    const reply = await this.command(`EHLO ${this.config.heloName}`, [250]);
    const caps = new Map<string, string>();
    for (const line of reply.lines.slice(1)) {
      const [key, ...rest] = line.replace('=', ' ').split(' ');
      caps.set(key.toUpperCase(), rest.join(' ').toUpperCase());
    }
    return caps;
  }

  /** Envoie une commande et vérifie le code de réponse ; `label` remplace la commande dans les erreurs (mot de passe). */
  async command(line: string, codes: number[], label = line.split(' ')[0]): Promise<Reply> {
    if (this.failure) throw this.failure;
    this.socket!.write(`${line}\r\n`);
    return this.expect(await this.read(), codes, label);
  }

  close(): void {
    this.socket?.destroy();
  }

  private tlsOptions() {
    const { host, rejectUnauthorized } = this.config;
    return { rejectUnauthorized, ...(isIP(host) ? {} : { servername: host }) };
  }

  private attach(socket: Socket | TLSSocket): void {
    this.socket = socket;
    socket.setTimeout(this.config.timeoutMs);
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('timeout', () => this.fail(new Error('le serveur ne répond plus (délai dépassé)')));
    socket.on('error', (e: Error) => this.fail(e));
    socket.on('close', () => this.fail(new Error('connexion fermée par le serveur')));
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '');
      this.buffer = this.buffer.slice(end + 1);
      this.pendingLines.push(line.slice(4));
      // « 250-… » : la réponse continue ; « 250 … » ou « 250 » : dernière ligne.
      if (/^\d{3}(?: |$)/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), lines: this.pendingLines };
        this.pendingLines = [];
        if (this.waiter) {
          const w = this.waiter;
          this.waiter = undefined;
          w.resolve(reply);
        } else this.replies.push(reply);
      }
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w.reject(error);
    }
  }

  private read(): Promise<Reply> {
    const ready = this.replies.shift();
    if (ready) return Promise.resolve(ready);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => (this.waiter = { resolve, reject }));
  }

  private expect(reply: Reply, codes: number[], label: string): Reply {
    if (!codes.includes(reply.code)) throw new Error(`refus du serveur (${label}) : ${reply.code} ${reply.lines.join(' ').trim()}`);
    return reply;
  }
}

/** Authentification : PLAIN de préférence, sinon LOGIN. */
async function authenticate(session: SmtpSession, caps: Map<string, string>, user: string, pass: string): Promise<void> {
  const mechanisms = (caps.get('AUTH') ?? '').split(/\s+/);
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
  if (mechanisms.includes('PLAIN')) {
    await session.command(`AUTH PLAIN ${b64(`\0${user}\0${pass}`)}`, [235], 'Authentification');
  } else if (mechanisms.includes('LOGIN')) {
    await session.command('AUTH LOGIN', [334], 'Authentification');
    await session.command(b64(user), [334], 'Authentification (utilisateur)');
    await session.command(b64(pass), [235], 'Authentification (mot de passe)');
  } else {
    throw new Error('le serveur ne propose ni AUTH PLAIN ni AUTH LOGIN');
  }
}

/** Mot encodé RFC 2047, découpé en morceaux de 75 caractères au plus (accents, arabe). */
function encodeWord(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words: string[] = [];
  let chunk = '';
  for (const ch of text) {
    if (Buffer.byteLength(chunk + ch) > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
}

const base64Lines = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');

function assertAddress(address: string): void {
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(address)) throw new Error(`adresse email invalide : ${address}`);
}

/** Message MIME : texte seul, ou texte + HTML (multipart/alternative). */
export function buildMessage(config: SmtpConfig, msg: MailMessage): string {
  const boundary = `tcsay-${randomUUID()}`;
  const headers = [
    `From: ${encodeWord(config.fromName.replace(/["\r\n]/g, ''))} <${config.from}>`,
    `To: <${msg.to}>`,
    ...(config.replyTo ? [`Reply-To: <${config.replyTo}>`] : []),
    `Subject: ${encodeWord(msg.subject.replace(/[\r\n]+/g, ' '))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomUUID()}@${config.from.split('@')[1] ?? 'tcsay.local'}>`,
    'MIME-Version: 1.0',
  ];
  const part = (type: string, body: string) =>
    [`Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', base64Lines(body)].join('\r\n');
  const body = msg.html
    ? [
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        part('text/plain', msg.text),
        `--${boundary}`,
        part('text/html', msg.html),
        `--${boundary}--`,
      ].join('\r\n')
    : part('text/plain', msg.text);
  // Transparence SMTP : une ligne commençant par « . » est doublée.
  return `${headers.join('\r\n')}\r\n${body}`.replace(/^\./gm, '..');
}

/** Envoie un email ; lève une erreur lisible (en français) en cas d'échec. */
export async function sendSmtp(config: SmtpConfig, msg: MailMessage): Promise<void> {
  assertAddress(config.from);
  assertAddress(msg.to);
  if (config.replyTo) assertAddress(config.replyTo);
  const session = new SmtpSession(config);
  try {
    await session.open();
    let caps = await session.ehlo();
    if (config.security === 'starttls') {
      if (!caps.has('STARTTLS')) throw new Error('le serveur ne propose pas STARTTLS (essayer SMTP_SECURITY=tls, port 465)');
      await session.command('STARTTLS', [220]);
      await session.upgrade();
      caps = await session.ehlo();
    }
    if (config.user) {
      if (!session.secure && !isLocalHost(config.host)) {
        throw new Error('authentification refusée sans chiffrement : régler SMTP_SECURITY sur tls ou starttls');
      }
      await authenticate(session, caps, config.user, config.pass ?? '');
    }
    await session.command(`MAIL FROM:<${config.from}>`, [250], 'Expéditeur');
    await session.command(`RCPT TO:<${msg.to}>`, [250, 251], 'Destinataire');
    await session.command('DATA', [354]);
    await session.command(`${buildMessage(config, msg)}\r\n.`, [250], 'Message');
    await session.command('QUIT', [221]).catch(() => undefined);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ECONNREFUSED') throw new Error(`connexion refusée par ${config.host}:${config.port} (serveur arrêté ou mauvais port)`);
    if (err.code === 'ENOTFOUND') throw new Error(`serveur introuvable : ${config.host}`);
    throw err;
  } finally {
    session.close();
  }
}
