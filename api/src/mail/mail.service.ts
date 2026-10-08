import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { EmailKind, EmailStatus, type EmailLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sendSmtp, smtpConfigFromEnv, type SmtpConfig } from './smtp';
import { renderHtml, type MailAction } from './template';

const LIST_SELECT = {
  id: true,
  to: true,
  subject: true,
  kind: true,
  status: true,
  error: true,
  attempts: true,
  sentAt: true,
  createdAt: true,
} as const;

/**
 * Envoi d'emails + historique (écran « Emails envoyés »).
 * Chaque email est d'abord enregistré « en attente », puis envoyé en arrière-plan, un par un : l'action métier
 * ne patiente jamais derrière le serveur SMTP et un échec ne l'annule pas. Au démarrage, la file reprend.
 * (Une seule instance de l'API : avec plusieurs instances, passer à BullMQ + Redis.)
 */
@Injectable()
export class MailService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  readonly config: SmtpConfig = smtpConfigFromEnv();
  private readonly appUrl = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173').replace(/\/+$/, '');
  private running = false;
  private dirty = false;
  private stopping = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    const c = this.config;
    this.logger.log(`SMTP ${c.host}:${c.port} (${c.security}${c.user ? ', authentifié' : ''}) · expéditeur ${c.from}`);
    this.kick();
  }

  onModuleDestroy(): void {
    this.stopping = true;
  }

  /** Met l'email en file d'attente (retour immédiat). */
  async send(to: string, subject: string, text: string, kind: EmailKind): Promise<void> {
    await this.prisma.emailLog.create({ data: { to, subject, body: text, kind, status: EmailStatus.PENDING } });
    this.kick();
  }

  credentials(to: string, firstName: string, login: string, password: string) {
    return this.send(
      to,
      'Vos identifiants TCSAY',
      [
        `Bonjour ${firstName},`,
        '',
        'Votre compte sur la plateforme du Tennis Club de Sayada a été créé.',
        `Identifiant : ${login}`,
        `Mot de passe temporaire : ${password}`,
        '',
        'Vous devrez choisir un nouveau mot de passe à la première connexion.',
        '',
        `Adresse de la plateforme : ${this.appUrl}/connexion`,
        '',
        'Le bureau du TCSAY',
      ].join('\n'),
      'CREDENTIALS',
    );
  }

  list(status?: EmailStatus, limit = 200) {
    return this.prisma.emailLog.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: LIST_SELECT,
    });
  }

  /** Configuration en vigueur (sans le mot de passe) et état de la file. */
  async overview() {
    const c = this.config;
    const counts = await this.prisma.emailLog.groupBy({ by: ['status'], _count: true });
    const count = (s: EmailStatus) => counts.find((x) => x.status === s)?._count ?? 0;
    return {
      host: c.host,
      port: c.port,
      security: c.security,
      auth: Boolean(c.user),
      user: c.user ? maskEmail(c.user) : null,
      passwordSet: Boolean(c.pass),
      from: c.from,
      fromName: c.fromName,
      replyTo: c.replyTo ?? null,
      appUrl: this.appUrl,
      devCapture: c.port === 1025 && !c.user,
      pending: count(EmailStatus.PENDING),
      sent: count(EmailStatus.SENT),
      failed: count(EmailStatus.FAILED),
    };
  }

  /** Email de test envoyé tout de suite (pas de file) pour afficher l'erreur SMTP exacte à l'administrateur. */
  async test(to: string) {
    const subject = 'Test de la messagerie TCSAY';
    const text = [
      'Bonjour,',
      '',
      'Cet email confirme que la plateforme du Tennis Club de Sayada peut envoyer des emails.',
      `Serveur : ${this.config.host}:${this.config.port} (${this.config.security}).`,
      '',
      'Le bureau du TCSAY',
    ].join('\n');
    const row = await this.prisma.emailLog.create({ data: { to, subject, body: text, kind: EmailKind.OTHER, status: EmailStatus.PENDING } });
    const error = await this.deliver(row);
    if (error) throw new BadRequestException(`Email non envoyé : ${error}`);
    return { sentTo: to };
  }

  /** Remet un email en échec dans la file. */
  async resend(id: string) {
    const row = await this.prisma.emailLog.findUnique({ where: { id }, select: { status: true } });
    if (!row) throw new NotFoundException('Email introuvable.');
    if (row.status !== EmailStatus.FAILED) throw new ConflictException('Seul un email en échec peut être renvoyé.');
    await this.prisma.emailLog.update({ where: { id }, data: { status: EmailStatus.PENDING, error: null } });
    this.kick();
    return { queued: 1 };
  }

  /** Remet tous les emails en échec dans la file (après correction de la configuration). */
  async resendFailed() {
    const { count } = await this.prisma.emailLog.updateMany({
      where: { status: EmailStatus.FAILED },
      data: { status: EmailStatus.PENDING, error: null },
    });
    this.kick();
    return { queued: count };
  }

  private kick(): void {
    this.dirty = true;
    if (this.running) return;
    this.running = true;
    setImmediate(() => void this.drain());
  }

  private async drain(): Promise<void> {
    try {
      while (this.dirty && !this.stopping) {
        this.dirty = false;
        for (;;) {
          if (this.stopping) return;
          const next = await this.prisma.emailLog.findFirst({ where: { status: EmailStatus.PENDING }, orderBy: { createdAt: 'asc' } });
          if (!next) break;
          await this.deliver(next);
        }
      }
    } catch (e) {
      this.logger.error(`File d'emails interrompue : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }

  /** Envoie un email enregistré et met à jour son statut ; renvoie l'erreur éventuelle. */
  private async deliver(row: EmailLog): Promise<string | null> {
    let error: string | null = null;
    try {
      await sendSmtp(this.config, {
        to: row.to,
        subject: row.subject,
        text: row.body,
        html: renderHtml(row.subject, row.body, this.actionFor(row.kind), this.logoUrl()),
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Email non envoyé à ${row.to} : ${error}`);
    }
    await this.prisma.emailLog.update({
      where: { id: row.id },
      data: {
        status: error ? EmailStatus.FAILED : EmailStatus.SENT,
        error,
        attempts: { increment: 1 },
        sentAt: error ? null : new Date(),
      },
    });
    return error;
  }

  /** Logo seulement si le site est public : Gmail, Outlook… ne peuvent pas charger une image de localhost. */
  private logoUrl(): string | undefined {
    return /^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.)/i.test(this.appUrl) ? undefined : `${this.appUrl}/logo-tcsay.png`;
  }

  private actionFor(kind: EmailKind): MailAction {
    return kind === EmailKind.CREDENTIALS
      ? { label: 'Se connecter', url: `${this.appUrl}/connexion` }
      : { label: 'Ouvrir mon espace', url: `${this.appUrl}/` };
  }
}

function maskEmail(value: string): string {
  const [name, domain] = value.split('@');
  const shown = name.slice(0, 2);
  return domain ? `${shown}${'•'.repeat(Math.max(name.length - 2, 1))}@${domain}` : `${shown}•••`;
}
