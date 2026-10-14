import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EmailKind, SeasonStatus } from '@prisma/client';
import { dayFromIso, isoDay, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

/** Vérification des retards toutes les heures (et au démarrage). */
const EVERY_MS = 60 * 60 * 1000;

/**
 * Tranches en retard : dès qu'une échéance est dépassée sans paiement complet, la famille concernée
 * (parents actifs liés au joueur, ou le joueur s'il a son propre compte) reçoit une notification, une seule fois
 * par échéance. Personne d'autre n'est prévenu. Le statut « En retard » est, lui, calculé à chaque affichage.
 */
@Injectable()
export class LateInstallmentsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Retards');
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    setTimeout(() => void this.run(), 5_000);
    this.timer = setInterval(() => void this.run(), EVERY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Prévient les familles des tranches nouvellement en retard ; renvoie le nombre de tranches signalées. */
  async run(): Promise<number> {
    try {
      const rows = await this.prisma.installment.findMany({
        where: {
          dueDate: { lt: dayFromIso(todayIso()) },
          lateNotifiedAt: null,
          membership: { enrollment: { season: { status: SeasonStatus.ACTIVE }, player: { archivedAt: null } } },
        },
        include: {
          payments: { select: { amount: true } },
          membership: {
            select: {
              enrollment: {
                select: {
                  player: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      userId: true,
                      parentLinks: { where: { parent: { isActive: true } }, select: { parentId: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });
      let count = 0;
      for (const i of rows) {
        const remaining = Math.round((num(i.amount) - i.payments.reduce((t, p) => t + num(p.amount), 0)) * 1000) / 1000;
        if (remaining <= 0) {
          await this.prisma.installment.update({ where: { id: i.id }, data: { lateNotifiedAt: new Date() } });
          continue;
        }
        const p = i.membership.enrollment.player;
        const users = [...new Set([...p.parentLinks.map((l) => l.parentId), ...(p.userId ? [p.userId] : [])])];
        const name = `${p.firstName} ${p.lastName}`.trim();
        await this.prisma.$transaction([
          ...(users.length
            ? [
                this.prisma.notification.createMany({
                  data: users.map((userId) => ({
                    userId,
                    kind: EmailKind.REMINDER,
                    title: `Paiement en retard : tranche ${i.number}/${i.count} de ${p.firstName}`,
                    body: `La tranche ${i.number}/${i.count} de ${name} était à régler avant le ${isoDay(i.dueDate)} : ${dt(remaining)} restant. Le paiement se fait au club.`,
                    link: '/paiements',
                  })),
                }),
              ]
            : []),
          this.prisma.installment.update({ where: { id: i.id }, data: { lateNotifiedAt: new Date() } }),
        ]);
        count++;
      }
      if (count) this.log.log(`${count} tranche(s) en retard signalée(s) aux familles.`);
      return count;
    } catch (e) {
      this.log.warn(`Vérification des retards impossible : ${e instanceof Error ? e.message : e}`);
      return 0;
    }
  }
}
