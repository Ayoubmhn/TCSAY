import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EmailKind, Prisma, SeasonStatus } from '@prisma/client';
import { addDaysIso, dayFromIso, isoDay, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentConfigService } from './payment-config.service';

/** Vérification des rappels et des retards toutes les heures (et au démarrage). */
const EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const include = {
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
              email: true,
              parentLinks: { where: { parent: { isActive: true } }, select: { parentId: true, parent: { select: { email: true } } } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.InstallmentInclude;

type Row = Prisma.InstallmentGetPayload<{ include: typeof include }>;

/**
 * Rappels et retards des tranches, selon la configuration des paiements du club :
 * - rappel avant l'échéance (1, 3 ou 7 jours avant), une fois ;
 * - « En retard » après le délai de grâce : la famille est prévenue une fois ;
 * - relances tous les 7 ou 15 jours tant que la tranche n'est pas soldée, au plus le nombre réglé
 *   (ensuite, la direction relance depuis « Familles à relancer »).
 * Seule la famille concernée est prévenue (parents actifs liés, ou le joueur s'il a son compte) ; email en plus au choix.
 */
@Injectable()
export class LateInstallmentsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Retards');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PaymentConfigService,
    private readonly mail: MailService,
  ) {}

  onApplicationBootstrap() {
    setTimeout(() => void this.run(), 5_000);
    this.timer = setInterval(() => void this.run(), EVERY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private remaining(i: Row) {
    return Math.round((num(i.amount) - i.payments.reduce((t, p) => t + num(p.amount), 0)) * 1000) / 1000;
  }

  /** Prévient la famille (notification, et email si réglé). */
  private async tell(i: Row, title: string, body: string, email: boolean) {
    const p = i.membership.enrollment.player;
    const users = [...new Set([...p.parentLinks.map((l) => l.parentId), ...(p.userId ? [p.userId] : [])])];
    if (email) {
      // L'email crée aussi la notification du compte qui a cette adresse.
      const to = [...new Set([...p.parentLinks.map((l) => l.parent.email), ...(p.userId ? [p.email] : [])].filter((x): x is string => Boolean(x)))];
      for (const addr of to) await this.mail.send(addr, title, `Bonjour,\n\n${body}\n\nLe bureau du TCSAY`, EmailKind.REMINDER);
      if (to.length) return;
    }
    if (users.length) {
      await this.prisma.notification.createMany({ data: users.map((userId) => ({ userId, kind: EmailKind.REMINDER, title, body, link: '/paiements' })) });
    }
  }

  /** Rappels, retards et relances ; renvoie le nombre de messages envoyés. */
  async run(): Promise<number> {
    try {
      const cfg = (await this.config.get()).reminders;
      const today = todayIso();
      const active = { membership: { enrollment: { season: { status: SeasonStatus.ACTIVE }, player: { archivedAt: null } } } };
      let count = 0;
      const name = (i: Row) => `${i.membership.enrollment.player.firstName} ${i.membership.enrollment.player.lastName}`.trim();

      // 1. Rappel avant l'échéance.
      if (cfg.beforeDays > 0) {
        const soon = await this.prisma.installment.findMany({
          where: { ...active, remindedAt: null, dueDate: { gte: dayFromIso(today), lte: dayFromIso(addDaysIso(today, cfg.beforeDays)) } },
          include,
        });
        for (const i of soon) {
          const rest = this.remaining(i);
          if (rest > 0) {
            const p = i.membership.enrollment.player;
            await this.tell(i, `Rappel : tranche ${i.number}/${i.count} de ${p.firstName}`, `La tranche ${i.number}/${i.count} de ${name(i)} est à régler avant le ${isoDay(i.dueDate)} : ${dt(rest)}. Le paiement se fait au club.`, cfg.email);
            count++;
          }
          await this.prisma.installment.update({ where: { id: i.id }, data: { remindedAt: new Date() } });
        }
      }

      // 2. En retard (après le délai de grâce) : prévenue une fois.
      const late = await this.prisma.installment.findMany({
        where: { ...active, lateNotifiedAt: null, dueDate: { lt: dayFromIso(addDaysIso(today, -cfg.graceDays)) } },
        include,
      });
      for (const i of late) {
        const rest = this.remaining(i);
        if (rest > 0) {
          const p = i.membership.enrollment.player;
          await this.tell(i, `Paiement en retard : tranche ${i.number}/${i.count} de ${p.firstName}`, `La tranche ${i.number}/${i.count} de ${name(i)} était à régler avant le ${isoDay(i.dueDate)} : ${dt(rest)} restant. Le paiement se fait au club.`, cfg.email);
          count++;
        }
        await this.prisma.installment.update({ where: { id: i.id }, data: { lateNotifiedAt: new Date(), relanceAt: new Date() } });
      }

      // 3. Relances tant que la tranche n'est pas soldée.
      if (cfg.repeatDays > 0 && cfg.maxRepeats > 0) {
        const limit = new Date(Date.now() - cfg.repeatDays * DAY_MS + 60 * 60 * 1000);
        const again = await this.prisma.installment.findMany({
          where: {
            ...active,
            lateNotifiedAt: { not: null },
            relanceCount: { lt: cfg.maxRepeats },
            OR: [{ relanceAt: { lte: limit } }, { relanceAt: null, lateNotifiedAt: { lte: limit } }],
          },
          include,
        });
        for (const i of again) {
          const rest = this.remaining(i);
          if (rest <= 0) continue;
          const p = i.membership.enrollment.player;
          await this.tell(
            i,
            `Relance : tranche ${i.number}/${i.count} de ${p.firstName} toujours à régler`,
            `La tranche ${i.number}/${i.count} de ${name(i)} (échéance du ${isoDay(i.dueDate)}) reste à régler : ${dt(rest)}. Le paiement se fait au club.`,
            cfg.email,
          );
          await this.prisma.installment.update({ where: { id: i.id }, data: { relanceCount: { increment: 1 }, relanceAt: new Date() } });
          count++;
        }
      }
      if (count) this.log.log(`${count} rappel(s) ou relance(s) envoyé(s) aux familles.`);
      return count;
    } catch (e) {
      this.log.warn(`Vérification des retards impossible : ${e instanceof Error ? e.message : e}`);
      return 0;
    }
  }
}
