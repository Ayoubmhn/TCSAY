import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_PAYMENT_CONFIG, normalizePaymentConfig, PAYMENT_CONFIG, PAYMENT_CONFIG_KEY, type PaymentConfig } from './payment-config';

/**
 * Lecture et enregistrement de la configuration des paiements. Copie en mémoire (relue au démarrage, toutes les
 * 5 minutes et à chaque enregistrement) pour les calculs synchrones (statut « En retard » d'une tranche).
 */
@Injectable()
export class PaymentConfigService implements OnApplicationBootstrap {
  private cache: PaymentConfig = DEFAULT_PAYMENT_CONFIG;
  private loadedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.get().catch(() => undefined);
  }

  /** Dernière configuration connue (sans accès à la base). */
  current(): PaymentConfig {
    if (Date.now() - this.loadedAt > PAYMENT_CONFIG.refreshMs) void this.get().catch(() => undefined);
    return this.cache;
  }

  async get(): Promise<PaymentConfig> {
    const row = await this.prisma.setting.findUnique({ where: { key: PAYMENT_CONFIG_KEY } });
    let raw: unknown = null;
    try {
      raw = row ? JSON.parse(row.value) : null;
    } catch {
      raw = null;
    }
    this.cache = normalizePaymentConfig(raw);
    this.loadedAt = Date.now();
    return this.cache;
  }

  async save(raw: unknown): Promise<PaymentConfig> {
    const cfg = normalizePaymentConfig(raw);
    const value = JSON.stringify(cfg);
    await this.prisma.setting.upsert({ where: { key: PAYMENT_CONFIG_KEY }, create: { key: PAYMENT_CONFIG_KEY, value }, update: { value } });
    this.cache = cfg;
    this.loadedAt = Date.now();
    return cfg;
  }
}
