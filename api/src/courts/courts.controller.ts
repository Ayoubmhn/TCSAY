import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CourtSurface, Role } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
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
      },
    });
    return courts.map(({ _count, ...c }) => ({ ...c, futureReservations: _count.reservations }));
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
    const updated = await this.prisma.court.update({
      where: { id },
      data: { name: dto.name?.trim(), surface: dto.surface, lit: dto.lit, version: { increment: 1 } },
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
