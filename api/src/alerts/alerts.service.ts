import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EmailStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { alert, alertsEnabled, describeError, takeErrorCount } from './telegram';

const EVERY_MS = 10 * 60_000;
const SUMMARY_HOUR = 8; // résumé du jour à 8 h (heure de Tunis)

/**
 * Surveillance du serveur, envoyée sur Telegram : démarrage (redémarrage après un plantage compris), base de données
 * injoignable, file d'emails bloquée, et résumé du matin (erreurs de la veille, emails en échec).
 * Un serveur arrêté ne peut rien envoyer lui-même : UptimeRobot s'en charge (docs/ALERTES_TELEGRAM.md).
 */
@Injectable()
export class AlertsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Alertes');
  private timer?: NodeJS.Timeout;
  private readonly startedAt = new Date();
  private lastSummary: string | null = null;
  private dbDown = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (!alertsEnabled()) return;
    this.log.log('Alertes Telegram activées.');
    if (process.env.ALERT_ON_START !== 'false') {
      const commit = process.env.RENDER_GIT_COMMIT?.slice(0, 7);
      void alert('info', 'Serveur démarré', [
        `Base : ${this.dbName()}${commit ? ` · version ${commit}` : ''}`,
        'Si vous ne l’avez pas redémarré, il a pu s’arrêter tout seul : regardez les logs de l’hébergeur.',
      ]);
    }
    // Résumé du jour déjà passé : pas de second résumé après un redémarrage dans la matinée.
    if (this.tunisHour() >= SUMMARY_HOUR) this.lastSummary = this.tunisDay();
    this.timer = setInterval(() => void this.check(), EVERY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private dbName() {
    try {
      return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1) || '?';
    } catch {
      return '?';
    }
  }

  private tunisDay() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });
  }

  private tunisHour() {
    return Number(new Date().toLocaleString('en-GB', { timeZone: 'Africa/Tunis', hour: '2-digit', hour12: false }));
  }

  /** Vérification toutes les 10 minutes (jamais d'erreur qui remonte). */
  async check(): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      if (this.dbDown) void alert('info', 'Base de données de nouveau joignable');
      this.dbDown = false;
    } catch (e) {
      if (!this.dbDown) void alert('error', 'Base de données injoignable', ['Le site ne peut plus lire ni enregistrer.', ...describeError(e)], 'db-down');
      this.dbDown = true;
      return;
    }
    try {
      const stuck = await this.prisma.emailLog.count({
        where: { status: EmailStatus.PENDING, createdAt: { lt: new Date(Date.now() - 30 * 60_000) } },
      });
      if (stuck) void alert('warn', 'File d’emails bloquée', [`${stuck} email(s) en attente depuis plus de 30 minutes.`], 'mail-stuck');
      if (this.tunisHour() >= SUMMARY_HOUR && this.lastSummary !== this.tunisDay()) {
        this.lastSummary = this.tunisDay();
        await this.summary();
      }
    } catch (e) {
      this.log.warn(`Vérification interrompue : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Résumé du matin : tout va bien, ou ce qui demande votre attention. */
  async summary(): Promise<boolean> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [failed, pending] = await Promise.all([
      this.prisma.emailLog.count({
        where: { status: EmailStatus.FAILED, createdAt: { gte: since }, NOT: { to: { endsWith: '@a-completer.invalid' } } },
      }),
      this.prisma.emailLog.count({ where: { status: EmailStatus.PENDING } }),
    ]);
    const errors = takeErrorCount();
    const days = Math.floor((Date.now() - this.startedAt.getTime()) / 86_400_000);
    const ok = !errors && !failed;
    return alert(ok ? 'info' : 'warn', ok ? 'Résumé du jour : tout va bien' : 'Résumé du jour : à regarder', [
      `Erreurs du serveur (500) : ${errors}`,
      `Emails en échec (24 h) : ${failed}${pending ? ` · en attente : ${pending}` : ''}`,
      `Base : ${this.dbName()} · en marche depuis ${days ? `${days} j` : 'moins d’un jour'}`,
    ], `summary:${this.tunisDay()}`);
  }
}
