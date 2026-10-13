import { ForbiddenException, Injectable } from '@nestjs/common';
import { SeasonStatus } from '@prisma/client';
import { addDaysIso, dayFromIso, isoDay, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

/** Modules fermés au joueur / parent tant qu'une tranche échue n'est pas payée (paiements et notifications restent ouverts). */
export const ACCESS_MODULES = ['sessions', 'progress', 'exercises', 'reservation'] as const;
export type AccessModule = (typeof ACCESS_MODULES)[number];

export const ACCESS_MODULE_LABEL: Record<AccessModule, string> = {
  sessions: 'Planning, séances et absences',
  progress: 'Suivi, notes et bilans',
  exercises: 'Exercices',
  reservation: 'Réservation de terrain',
};

export type PaymentAccessConfig = { enabled: boolean; graceDays: number; modules: Record<AccessModule, boolean> };

export const ACCESS_SETTING_KEY = 'access.payment';

/** Désactivé par défaut : le président l'active (réglage à valider avec le bureau). */
export const DEFAULT_ACCESS_CONFIG: PaymentAccessConfig = {
  enabled: false,
  graceDays: 7,
  modules: { sessions: true, progress: true, exercises: true, reservation: false },
};

@Injectable()
export class PaymentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async config(): Promise<PaymentAccessConfig> {
    const row = await this.prisma.setting.findUnique({ where: { key: ACCESS_SETTING_KEY } });
    if (!row) return DEFAULT_ACCESS_CONFIG;
    try {
      const v = JSON.parse(row.value) as Partial<PaymentAccessConfig>;
      return {
        enabled: Boolean(v.enabled),
        graceDays: Number.isInteger(v.graceDays) ? (v.graceDays as number) : DEFAULT_ACCESS_CONFIG.graceDays,
        modules: { ...DEFAULT_ACCESS_CONFIG.modules, ...(v.modules ?? {}) },
      };
    } catch {
      return DEFAULT_ACCESS_CONFIG;
    }
  }

  async save(config: PaymentAccessConfig) {
    const value = JSON.stringify(config);
    await this.prisma.setting.upsert({ where: { key: ACCESS_SETTING_KEY }, create: { key: ACCESS_SETTING_KEY, value }, update: { value } });
    return config;
  }

  /** Plus ancienne tranche de la saison active échue depuis plus que le délai de grâce et pas entièrement payée. */
  async overdue(playerId: string, graceDays: number) {
    const limit = dayFromIso(addDaysIso(todayIso(), -graceDays));
    const rows = await this.prisma.installment.findMany({
      where: {
        dueDate: { lt: limit },
        membership: { enrollment: { playerId, season: { status: SeasonStatus.ACTIVE } } },
      },
      orderBy: { dueDate: 'asc' },
      include: { payments: { select: { amount: true } } },
    });
    for (const i of rows) {
      const remaining = Math.round((num(i.amount) - i.payments.reduce((t, p) => t + num(p.amount), 0)) * 1000) / 1000;
      if (remaining > 0) return { number: i.number, count: i.count, dueDate: isoDay(i.dueDate), remaining };
    }
    return null;
  }

  /** État d'accès d'un joueur : modules fermés, tranche en cause, exception éventuelle. */
  async status(playerId: string) {
    const config = await this.config();
    const none = Object.fromEntries(ACCESS_MODULES.map((m) => [m, false])) as Record<AccessModule, boolean>;
    if (!config.enabled) return { enabled: false, locked: none, overdue: null, exempt: null };
    const player = await this.prisma.player.findUnique({ where: { id: playerId }, select: { accessExemptReason: true } });
    if (player?.accessExemptReason) return { enabled: true, locked: none, overdue: null, exempt: player.accessExemptReason };
    const overdue = await this.overdue(playerId, config.graceDays);
    const locked = Object.fromEntries(ACCESS_MODULES.map((m) => [m, Boolean(overdue) && config.modules[m]])) as Record<AccessModule, boolean>;
    return { enabled: true, locked, overdue, exempt: null };
  }

  /** Refuse l'accès à un module (joueur / parent) si une tranche est en retard ; jamais pour l'entraîneur ni la direction. */
  async assert(playerId: string, module: AccessModule) {
    const s = await this.status(playerId);
    if (!s.locked[module] || !s.overdue) return;
    const o = s.overdue;
    throw new ForbiddenException(
      `Accès fermé : la tranche ${o.number}/${o.count} (échéance ${o.dueDate.split('-').reverse().join('/')}) reste à régler (${dt(o.remaining)}). ` +
        'Le planning, le suivi et les exercices s’ouvrent après le paiement au club.',
    );
  }
}
