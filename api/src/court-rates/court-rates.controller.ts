import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsInt, IsNumber, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { dt } from '../common/money';
import { assertVersion, notFound } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';

class UpdateRateDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Prix invalide.' })
  @Min(0)
  pricePerHour: number;
}

export const TYPE_LABEL = { LEISURE: 'Loisir', PRIVATE: 'Séance privée' } as const;
export const PERIOD_LABEL = { DAY: 'Jour', NIGHT: 'Nuit' } as const;

@ApiTags('Tarifs terrains')
@ApiBearerAuth()
@Controller('court-rates')
export class CourtRatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.prisma.courtRate.findMany({ orderBy: [{ type: 'asc' }, { period: 'asc' }] });
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRateDto) {
    const rate = await this.prisma.courtRate.findUnique({ where: { id } });
    if (!rate) throw notFound('Tarif');
    assertVersion(rate, dto.version, 'Ce tarif');
    const updated = await this.prisma.courtRate.update({
      where: { id },
      data: { pricePerHour: dto.pricePerHour, version: { increment: 1 } },
    });
    await this.audit.log(user.id, {
      action: 'Tarif terrain modifié',
      entity: 'CourtRate',
      entityId: id,
      target: `${TYPE_LABEL[rate.type]} · ${PERIOD_LABEL[rate.period]}`,
      before: `${dt(rate.pricePerHour)} / h`,
      after: `${dt(updated.pricePerHour)} / h`,
    });
    return updated;
  }
}
