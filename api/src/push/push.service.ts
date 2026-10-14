import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateVapidKeys, sendWebPush, type VapidKeys } from './web-push';

const SETTING_KEY = 'push.vapid';
/** Les nouvelles notifications partent en push toutes les 15 secondes. */
const EVERY_MS = 15_000;

/**
 * Notifications push : chaque notification créée dans l'application (paiement en retard, séance déplacée, match,
 * message du club…) est aussi envoyée aux appareils abonnés de son destinataire. Clés VAPID : VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY, VAPID_SUBJECT dans api/.env ; à défaut, générées une fois et gardées en base (développement).
 */
@Injectable()
export class PushService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Push');
  private timer?: NodeJS.Timeout;
  private keys?: VapidKeys;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  async vapid(): Promise<VapidKeys> {
    if (this.keys) return this.keys;
    const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = process.env;
    if (pub && priv) return (this.keys = { publicKey: pub, privateKey: priv, subject: subject || 'mailto:contact@tennisclubdesayada.tn' });
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (row) return (this.keys = JSON.parse(row.value) as VapidKeys);
    const keys = generateVapidKeys(subject || 'mailto:contact@tennisclubdesayada.tn');
    await this.prisma.setting.create({ data: { key: SETTING_KEY, value: JSON.stringify(keys) } });
    this.log.warn('Clés VAPID générées et gardées en base : en production, définissez VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY dans api/.env.');
    return (this.keys = keys);
  }

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.flush(), EVERY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Envoie les notifications pas encore poussées (par lots), puis les marque. */
  async flush(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const rows = await this.prisma.notification.findMany({
        where: { pushedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: { id: true, userId: true, title: true, body: true, link: true, createdAt: true },
      });
      if (!rows.length) return 0;
      const subs = await this.prisma.pushSubscription.findMany({ where: { userId: { in: [...new Set(rows.map((r) => r.userId))] } } });
      const keys = subs.length ? await this.vapid() : null;
      for (const n of rows) {
        // Trop ancienne (serveur arrêté longtemps) : pas de push en retard, seulement dans la cloche.
        const fresh = Date.now() - n.createdAt.getTime() < 6 * 3600_000;
        for (const s of fresh && keys ? subs.filter((x) => x.userId === n.userId) : []) {
          try {
            const status = await sendWebPush(s, { title: n.title, body: n.body.slice(0, 300), link: n.link ?? '/notifications', tag: n.id }, keys!);
            if (status === 404 || status === 410) await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
            else if (status < 300) {
              sent++;
              await this.prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } });
            } else this.log.warn(`Service de push : réponse ${status}.`);
          } catch (e) {
            this.log.warn(`Push impossible : ${e instanceof Error ? e.message : e}`);
          }
        }
      }
      await this.prisma.notification.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { pushedAt: new Date() } });
      return sent;
    } catch (e) {
      this.log.warn(`Envoi des notifications push : ${e instanceof Error ? e.message : e}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
