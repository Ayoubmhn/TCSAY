import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CourtSurface, Role } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { dayFromIso, isoDay, todayIso } from '../common/dates';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles, Perm } from '../auth/auth-user';
import { assertVersion, notFound, rule } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';

export const SURFACE_LABEL: Record<CourtSurface, string> = { CLAY: 'Terre battue', HARD: 'Dur', GRASS: 'Gazon' };

class CreateCourtDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name: string;

  @IsEnum(CourtSurface, { message: 'Surface : terre battue, dur ou gazon.' })
  surface: CourtSurface;

  @IsBoolean()
  lit: boolean;
}

class UpdateCourtDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsEnum(CourtSurface, { message: 'Surface : terre battue, dur ou gazon.' })
  surface?: CourtSurface;

  @IsOptional()
  @IsBoolean()
  lit?: boolean;

  /** Réservation en ligne : familles, entraîneurs, soir, jours (0 = dimanche), heures. */
  @IsOptional() @IsBoolean() bookFamilies?: boolean;
  @IsOptional() @IsBoolean() bookCoaches?: boolean;
  @IsOptional() @IsBoolean() bookNight?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsIn([0, 1, 2, 3, 4, 5, 6], { each: true }) bookDays?: number[];
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @Matches(/^([01]\d|2[0-3]):(00|30)$/, { message: 'Heure au format HH:MM.' }) bookFrom?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @Matches(/^([01]\d|2[0-3]):(00|30)$/, { message: 'Heure au format HH:MM.' }) bookTo?: string | null;
}

class ClosureDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date de début obligatoire.' }) fromDate: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date de fin obligatoire.' }) toDate: string;
  @IsString() @IsNotEmpty({ message: 'Le motif est obligatoire.' }) @MaxLength(120) reason: string;
}

class MaintenanceDto {
  @IsBoolean()
  maintenance: boolean;
}

@ApiTags('Terrains')
@ApiBearerAuth()
@Controller('courts')
export class CourtsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Tous les rôles voient les terrains (réservation). */
  @Get()
  async list() {
    const courts = await this.prisma.court.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { reservations: { where: { activeKey: { not: null }, startTime: { gte: new Date() } } } } },
        closures: { where: { toDate: { gte: dayFromIso(todayIso()) } }, orderBy: { fromDate: 'asc' } },
      },
    });
    return courts.map(({ _count, closures, ...c }) => ({
      ...c,
      futureReservations: _count.reservations,
      closures: closures.map((x) => ({ id: x.id, fromDate: isoDay(x.fromDate), toDate: isoDay(x.toDate), reason: x.reason })),
    }));
  }

  @Post()
  @Perm('courts.manage')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateCourtDto) {
    const max = await this.prisma.court.aggregate({ _max: { sortOrder: true } });
    const court = await this.prisma.court.create({
      data: { name: dto.name.trim(), surface: dto.surface, lit: dto.lit, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
    await this.audit.log(user.id, { action: 'Terrain créé', entity: 'Court', entityId: court.id, target: court.name });
    return court;
  }

  @Patch(':id')
  @Perm('courts.manage')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCourtDto) {
    const court = await this.find(id);
    assertVersion(court, dto.version, 'Ce terrain');
    if (dto.bookFrom && dto.bookTo && dto.bookTo <= dto.bookFrom) throw new BadRequestException('L’heure de fin de réservation suit l’heure de début.');
    const updated = await this.prisma.court.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        surface: dto.surface,
        lit: dto.lit,
        bookFamilies: dto.bookFamilies,
        bookCoaches: dto.bookCoaches,
        bookNight: dto.bookNight,
        bookDays: dto.bookDays ? [...new Set(dto.bookDays)].sort() : undefined,
        bookFrom: dto.bookFrom === undefined ? undefined : dto.bookFrom || null,
        bookTo: dto.bookTo === undefined ? undefined : dto.bookTo || null,
        version: { increment: 1 },
      },
    });
    await this.audit.log(user.id, {
      action: 'Terrain modifié',
      entity: 'Court',
      entityId: id,
      target: updated.name,
      before: `${court.name} · ${SURFACE_LABEL[court.surface]} · ${court.lit ? 'éclairé' : 'sans éclairage'}`,
      after: `${updated.name} · ${SURFACE_LABEL[updated.surface]} · ${updated.lit ? 'éclairé' : 'sans éclairage'}`,
    });
    return updated;
  }

  /** Fermeture ponctuelle à la réservation en ligne (les réservations déjà faites restent). */
  @Post(':id/closures')
  @Perm('courts.manage')
  async addClosure(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClosureDto) {
    const court = await this.find(id);
    if (dto.toDate < dto.fromDate) throw new BadRequestException('La date de fin suit la date de début.');
    const c = await this.prisma.courtClosure.create({ data: { courtId: id, fromDate: dayFromIso(dto.fromDate), toDate: dayFromIso(dto.toDate), reason: dto.reason.trim(), createdById: user.id } });
    await this.audit.log(user.id, { action: 'Terrain fermé à la réservation', entity: 'Court', entityId: id, target: court.name, after: `${dto.fromDate} → ${dto.toDate}`, reason: dto.reason });
    return { id: c.id };
  }

  @Delete('closures/:closureId')
  @Perm('courts.manage')
  async removeClosure(@CurrentUser() user: AuthUser, @Param('closureId', ParseUUIDPipe) closureId: string) {
    const c = await this.prisma.courtClosure.findUnique({ where: { id: closureId }, include: { court: { select: { name: true } } } });
    if (!c) throw notFound('Fermeture');
    await this.prisma.courtClosure.delete({ where: { id: closureId } });
    await this.audit.log(user.id, { action: 'Fermeture à la réservation retirée', entity: 'Court', entityId: c.courtId, target: c.court.name, before: `${isoDay(c.fromDate)} → ${isoDay(c.toDate)} · ${c.reason}` });
    return { ok: true };
  }

  @Post(':id/maintenance')
  @Perm('courts.manage')
  async maintenance(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MaintenanceDto) {
    const court = await this.find(id);
    const updated = await this.prisma.court.update({
      where: { id },
      data: { maintenance: dto.maintenance, version: { increment: 1 } },
    });
    await this.audit.log(user.id, {
      action: dto.maintenance ? 'Terrain en entretien' : 'Fin d’entretien',
      entity: 'Court',
      entityId: id,
      target: court.name,
      before: court.maintenance ? 'Entretien' : 'Actif',
      after: dto.maintenance ? 'Entretien' : 'Actif',
    });
    return updated;
  }

  /** R11 : un terrain avec réservations futures ne peut pas être désactivé. */
  @Post(':id/deactivate')
  @Perm('courts.manage')
  async deactivate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const court = await this.find(id);
    const future = await this.prisma.reservation.count({
      where: { courtId: id, activeKey: { not: null }, startTime: { gte: new Date() } },
    });
    if (future > 0) {
      throw rule.conflict('R11', `${court.name} a ${future} réservation(s) à venir : désactivation impossible.`);
    }
    return this.setActive(user, court, false);
  }

  @Post(':id/activate')
  @Perm('courts.manage')
  async activate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.setActive(user, await this.find(id), true);
  }

  private async setActive(user: AuthUser, court: { id: string; name: string; active: boolean }, active: boolean) {
    const updated = await this.prisma.court.update({
      where: { id: court.id },
      data: { active, version: { increment: 1 } },
    });
    await this.audit.log(user.id, {
      action: active ? 'Terrain réactivé' : 'Terrain désactivé',
      entity: 'Court',
      entityId: court.id,
      target: court.name,
      before: court.active ? 'Actif' : 'Désactivé',
      after: active ? 'Actif' : 'Désactivé',
    });
    return updated;
  }

  private async find(id: string) {
    const court = await this.prisma.court.findUnique({ where: { id } });
    if (!court) throw notFound('Terrain');
    return court;
  }
}
