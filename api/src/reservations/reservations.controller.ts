import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReservationType, Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { fullName } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';
import { BookingRulesService, type Origin } from './booking-rules.service';
import { AuthUser, CurrentUser, Roles, Perm } from '../auth/auth-user';
import { localDayOf, todayIso } from '../common/dates';
import { ReservationsService } from './reservations.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);

class DayQuery {
  @IsOptional()
  @Matches(DATE, { message: 'Date au format AAAA-MM-JJ.' })
  date?: string;

  @IsOptional()
  @IsUUID()
  playerId?: string;
}

class CreateReservationDto {
  @IsUUID('all', { message: 'Terrain obligatoire.' })
  courtId: string;

  @Matches(DATE, { message: 'Date au format AAAA-MM-JJ.' })
  date: string;

  /** Départ « HH:MM », à l'heure pile ou à la demi-heure (ex. « 17:30 »). */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):(00|30)$/, { message: 'Heure de départ au format HH:MM (heure pile ou demi-heure).' })
  time?: string;

  /** Durée en minutes : de 60 à 240, par tranches de 30 (par défaut 60). */
  @IsOptional()
  @IsInt({ message: 'Durée en minutes.' })
  @Min(60, { message: 'Durée : 1 h au moins.' })
  @Max(240, { message: 'Durée : 4 h au plus.' })
  duration?: number;

  /** Ancien format (heure pile) : utiliser « time ». */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  playerId?: string;

  @IsOptional()
  @IsIn([ReservationType.LEISURE, ReservationType.PRIVATE])
  type?: ReservationType;
}

class RulesDto {
  @IsInt() @Min(0) @Max(20) maxUpcomingAccount: number;
  @IsInt() @Min(0) @Max(30) maxUpcomingFamily: number;
  @IsInt() @Min(0) @Max(60) maxHoursWeek: number;
  @IsInt() @Min(0) @Max(10) maxPerDayPlayer: number;
  @IsInt() @Min(1) @Max(60) advanceDays: number;
  @IsInt() @Min(0) @Max(14) peakPerWeek: number;
  @IsInt() @Min(0) @Max(30) cancelsPerMonth: number;
  @IsInt() @Min(0) @Max(10) noShowLimit: number;
  @IsInt() @Min(1) @Max(180) blockDays: number;
  @IsInt() @Min(0) @Max(200) attemptsPerHour: number;
  @IsBoolean() noArrears: boolean;
}

class BlockDto {
  @IsUUID() userId: string;
  @IsString() @IsNotEmpty({ message: 'Le motif est obligatoire.' }) @MaxLength(200) reason: string;
  @IsInt() @Min(1) @Max(365) days: number;
}

class CancelDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

@ApiTags('Réservations')
@ApiBearerAuth()
@Controller('reservations')
export class ReservationsController {
  constructor(
    private readonly reservations: ReservationsService,
    private readonly rules: BookingRulesService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Appareil (identifiant aléatoire du navigateur, en-tête X-Device) et adresse IP de la demande. */
  private origin(req: Request): Origin {
    const d = req.headers['x-device'];
    const deviceId = typeof d === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(d) ? d : null;
    return { ip: req.ip ?? null, deviceId };
  }

  /** Règles de réservation (affichées à tous). */
  @Get('rules')
  getRules() {
    return this.rules.rules();
  }

  @Put('rules')
  @Perm('permissions.manage')
  async setRules(@CurrentUser() user: AuthUser, @Body() dto: RulesDto) {
    const before = await this.rules.rules();
    const saved = await this.rules.saveRules({ ...dto });
    await this.audit.log(user.id, { action: 'Règles de réservation modifiées', entity: 'Setting', entityId: 'reservation.rules', target: 'Règles de réservation', before: JSON.stringify(before), after: JSON.stringify(saved) });
    return saved;
  }

  /** Mes limites (famille) : réservations à venir, heures de la semaine, soir / week-end, blocage. */
  @Get('limits')
  limits(@CurrentUser() user: AuthUser, @Query() q: DayQuery) {
    return this.rules.usage(user, q.date ?? todayIso());
  }

  /** Direction : alertes de sécurité et comptes bloqués. */
  @Get('security')
  @Perm('reservations.manage')
  async security() {
    const [alerts, blocks] = await Promise.all([
      this.rules.alerts(),
      this.prisma.reservationBlock.findMany({
        where: { liftedAt: null, until: { gt: new Date() } },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy: { until: 'desc' },
      }),
    ]);
    const by = await this.prisma.user.findMany({ where: { id: { in: blocks.map((b) => b.createdById).filter((x): x is string => Boolean(x)) } }, select: { id: true, firstName: true, lastName: true } });
    return {
      alerts,
      blocks: blocks.map((b) => ({
        id: b.id,
        user: { id: b.user.id, name: fullName(b.user).trim(), email: b.user.email },
        reason: b.reason,
        until: b.until,
        automatic: b.automatic,
        by: b.automatic ? 'Automatique' : (by.find((u) => u.id === b.createdById) ? fullName(by.find((u) => u.id === b.createdById)!).trim() : null),
      })),
    };
  }

  @Post('blocks')
  @Perm('reservations.manage')
  async block(@CurrentUser() user: AuthUser, @Body() dto: BlockDto) {
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { firstName: true, lastName: true } });
    if (!target) throw new NotFoundException('Compte introuvable.');
    const b = await this.rules.block(dto.userId, dto.reason.trim(), dto.days, user.id);
    await this.audit.log(user.id, { action: 'Réservation suspendue', entity: 'User', entityId: dto.userId, target: fullName(target).trim(), after: `jusqu’au ${localDayOf(b.until)}`, reason: dto.reason });
    return { id: b.id };
  }

  @Post('blocks/:id/lift')
  @HttpCode(200)
  @Perm('reservations.manage')
  async lift(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const b = await this.prisma.reservationBlock.findUnique({ where: { id }, include: { user: { select: { firstName: true, lastName: true } } } });
    if (!b || b.liftedAt) throw new NotFoundException('Blocage introuvable.');
    await this.prisma.reservationBlock.update({ where: { id }, data: { liftedAt: new Date(), liftedById: user.id } });
    await this.audit.log(user.id, { action: 'Réservation débloquée', entity: 'User', entityId: b.userId, target: fullName(b.user).trim(), before: b.reason });
    return { ok: true };
  }

  /** Absence sans annuler (créneau passé) : comptée, blocage automatique au-delà de la limite. */
  @Post(':id/no-show')
  @HttpCode(200)
  @Perm('reservations.manage')
  async noShow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include: { court: { select: { name: true } }, bookedBy: { select: { firstName: true, lastName: true } } } });
    if (!r || !r.activeKey) throw new NotFoundException('Réservation introuvable.');
    if (r.startTime > new Date()) throw new BadRequestException('Le créneau n’a pas encore commencé.');
    if (r.noShowAt) throw new BadRequestException('Absence déjà signalée.');
    await this.prisma.reservation.update({ where: { id }, data: { noShowAt: new Date(), noShowById: user.id } });
    const blocked = await this.rules.afterNoShow(r.bookedById);
    await this.audit.log(user.id, { action: 'Absence sans annuler signalée', entity: 'Reservation', entityId: id, target: `${r.court.name} · ${fullName(r.bookedBy).trim()}`, after: blocked ? `bloqué : ${blocked.reason}` : null });
    return { ok: true, blocked: Boolean(blocked) };
  }

  @Get('grid')
  grid(@CurrentUser() user: AuthUser, @Query() q: DayQuery) {
    return this.reservations.grid(user, q.date ?? todayIso(), q.playerId);
  }

  @Get('mine')
  @Roles(Role.PLAYER, Role.PARENT, Role.COACH)
  mine(@CurrentUser() user: AuthUser, @Query() q: DayQuery) {
    return this.reservations.mine(user, q.playerId);
  }

  @Get()
  @Perm('reservations.manage', 'planning.view')
  byDay(@Query() q: DayQuery) {
    return this.reservations.byDay(q.date ?? todayIso());
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReservationDto, @Req() req: Request) {
    return this.reservations.create(user, dto, this.origin(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.reservations.cancel(user, id, dto.reason);
  }
}
