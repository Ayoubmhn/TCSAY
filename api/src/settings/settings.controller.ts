import { BadRequestException, Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { minutesOf } from '../common/dates';
import { DAY_LONG } from '../common/sessions';
import { rule } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles, Perm } from '../auth/auth-user';
import { SettingsService } from './settings.service';

class SetValueDto {
  @IsInt()
  value: number;
}

/** Horaires du club : ouverture, fermeture, début de la nuit (éclairage), délai d'annulation. */
class HoursDto {
  @IsInt()
  @Min(0)
  @Max(23)
  openingHour: number;

  @IsInt()
  @Min(1)
  @Max(24)
  closingHour: number;

  @IsInt()
  @Min(0)
  @Max(24)
  nightStartHour: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(72)
  cancelDelayHours?: number;
}

const h = (n: number) => `${String(n).padStart(2, '0')}:00`;

@ApiTags('Paramètres')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  all() {
    return this.settings.all();
  }

  /**
   * Horaires du club (grille de l'emploi du temps, planning, réservations). Refusé si des séances habituelles, des séances
   * de vacances à venir ou des réservations à venir tombent en dehors des nouveaux horaires (à déplacer d'abord).
   */
  @Put('hours')
  @Perm('reservations.manage', 'courts.manage')
  async hours(@CurrentUser() user: AuthUser, @Body() dto: HoursDto) {
    if (dto.closingHour <= dto.openingHour) throw new BadRequestException('La fermeture doit suivre l’ouverture.');
    if (dto.nightStartHour < dto.openingHour || dto.nightStartHour > dto.closingHour) {
      throw new BadRequestException('Le début de la nuit doit être entre l’ouverture et la fermeture.');
    }
    const open = dto.openingHour * 60;
    const close = dto.closingHour * 60;
    const slots = await this.prisma.groupSlot.findMany({
      where: {
        group: { archivedAt: null, season: { status: { in: ['ACTIVE', 'DRAFT'] } } },
        OR: [{ scheduleId: null }, { schedule: { archivedAt: null, endDate: { gte: new Date() } } }],
      },
      select: { day: true, startTime: true, endTime: true, group: { select: { name: true } } },
    });
    const outside = slots.filter((s) => minutesOf(s.startTime) < open || minutesOf(s.endTime) > close);
    if (outside.length) {
      const ex = outside[0];
      throw rule.conflict(
        'R10',
        `${outside.length} séance${outside.length > 1 ? 's' : ''} hors de ces horaires (ex. « ${ex.group.name} » le ${DAY_LONG[ex.day]} ${ex.startTime}–${ex.endTime}) : déplacez-les d’abord sur la grille de l’emploi du temps.`,
      );
    }
    const future = await this.prisma.reservation.findMany({
      where: { activeKey: { not: null }, startTime: { gte: new Date() } },
      select: { startTime: true, endTime: true },
    });
    const toMin = (d: Date) => d.getHours() * 60 + d.getMinutes();
    const late = future.filter((r) => toMin(r.startTime) < open || (toMin(r.endTime) || 24 * 60) > close);
    if (late.length) {
      throw rule.conflict('R10', `${late.length} réservation${late.length > 1 ? 's' : ''} à venir hors de ces horaires : annulez-les ou attendez qu’elles soient passées.`);
    }
    const before = await this.settings.all();
    for (const key of ['openingHour', 'closingHour', 'nightStartHour', 'cancelDelayHours'] as const) {
      if (dto[key] !== undefined) await this.settings.set(key, dto[key]!);
    }
    const after = await this.settings.all();
    await this.audit.log(user.id, {
      action: 'Horaires du club modifiés',
      entity: 'Setting',
      entityId: 'hours',
      target: 'Horaires du club',
      before: `${h(before.openingHour)}–${h(before.closingHour)} · nuit ${h(before.nightStartHour)} · annulation ${before.cancelDelayHours} h`,
      after: `${h(after.openingHour)}–${h(after.closingHour)} · nuit ${h(after.nightStartHour)} · annulation ${after.cancelDelayHours} h`,
    });
    return after;
  }

  @Patch(':key')
  @Perm('reservations.manage', 'courts.manage')
  async set(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() dto: SetValueDto) {
    const before = await this.settings.all();
    const after = await this.settings.set(key, dto.value);
    await this.audit.log(user.id, {
      action: 'Paramètre modifié',
      entity: 'Setting',
      entityId: key,
      target: key,
      before: String(before[key as keyof typeof before]),
      after: String(dto.value),
    });
    return after;
  }
}
