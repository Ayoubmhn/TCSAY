import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Paramètres du club (valeurs proposées, à confirmer avec le bureau). */
export const SETTING_DEFAULTS = {
  nightStartHour: 18, // nuit dès 18h
  cancelDelayHours: 24, // annulation refusée à moins de 24 h
  openingHour: 8, // premier créneau
  closingHour: 22, // fin du dernier créneau
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = Record<SettingKey, number>;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async all(): Promise<Settings> {
    const rows = await this.prisma.setting.findMany();
    const out: Settings = { ...SETTING_DEFAULTS };
    for (const row of rows) {
      if (row.key in SETTING_DEFAULTS) out[row.key as SettingKey] = Number(row.value);
    }
    return out;
  }

  async set(key: string, value: number): Promise<Settings> {
    if (!(key in SETTING_DEFAULTS)) throw new NotFoundException('Paramètre inconnu.');
    if (!Number.isInteger(value) || value < 0 || value > 72) throw new BadRequestException('Valeur entière entre 0 et 72 attendue.');
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } });
    return this.all();
  }
}
