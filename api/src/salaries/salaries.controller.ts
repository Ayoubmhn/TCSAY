import { NIL_UUID } from '../common/rules';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { dayFromIso, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { LOCKED_SEASON, assertVersion, fullName, notFound, rule } from '../common/rules';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

class CreateSalaryDto {
  @IsUUID('all', { message: 'Entraîneur obligatoire.' })
  coachId: string;

  @IsOptional()
  @IsUUID()
  seasonId?: string;

  @IsString()
  @IsNotEmpty({ message: 'Période obligatoire (ex. Octobre 2026).' })
  @MaxLength(40)
  period: string;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Montant invalide.' })
  @Min(0)
  amount: number;
}

class UpdateSalaryDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Montant invalide.' })
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

class ListQuery {
  @IsOptional()
  @IsUUID()
  coachId?: string;
}

const include = {
  coach: { select: { id: true, user: { select: { firstName: true, lastName: true, email: true } } } },
  season: { select: { id: true, label: true, status: true } },
};

/** Salaires des entraîneurs : saisis par l'admin ; le coach consulte ses salaires versés. */
@ApiTags('Salaires')
@ApiBearerAuth()
@Controller('salaries')
export class SalariesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  @Get()
  @Roles(Role.ADMIN)
  async list(@Query() q: ListQuery) {
    const rows = await this.prisma.coachFee.findMany({
      where: { coachId: q.coachId },
      include,
      orderBy: [{ paidAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    });
    return rows.map(view);
  }

  @Get('mine')
  @Roles(Role.COACH)
  async mine(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.coachFee.findMany({
      where: { coachId: user.coachId ?? NIL_UUID, paidAt: { not: null } },
      include,
      orderBy: { paidAt: 'desc' },
    });
    return rows.map(view);
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalaryDto) {
    const season = await this.access.seasonOrActive(dto.seasonId);
    const fee = await this.prisma.coachFee.create({
      data: { coachId: dto.coachId, seasonId: season.id, period: dto.period.trim(), amount: dto.amount },
      include,
    });
    await this.audit.log(user.id, {
      action: 'Salaire saisi',
      entity: 'CoachFee',
      entityId: fee.id,
      target: `${fullName(fee.coach.user)} · ${fee.period}`,
      after: dt(fee.amount),
    });
    return view(fee);
  }

  /** R6 : modifiable sur saison en cours ou à venir ; sur saison clôturée, motif obligatoire. */
  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSalaryDto) {
    const fee = await this.find(id);
    assertVersion(fee, dto.version, 'Ce salaire');
    const reason = dto.reason?.trim() || null;
    if (LOCKED_SEASON.includes(fee.season.status) && !reason) {
      throw rule.bad('R6', `Saison ${fee.season.label} clôturée : motif obligatoire.`);
    }
    const updated = await this.prisma.coachFee.update({
      where: { id },
      data: { amount: dto.amount, version: { increment: 1 } },
      include,
    });
    await this.audit.log(user.id, {
      action: 'Salaire modifié',
      entity: 'CoachFee',
      entityId: id,
      target: `${fullName(fee.coach.user)} · ${fee.period}`,
      before: dt(fee.amount),
      after: dt(updated.amount),
      reason,
    });
    return view(updated);
  }

  @Post(':id/pay')
  @HttpCode(200)
  @Roles(Role.ADMIN)
  async pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const fee = await this.find(id);
    if (fee.paidAt) throw rule.conflict('R6', 'Ce salaire est déjà marqué versé.');
    const updated = await this.prisma.coachFee.update({
      where: { id },
      data: { paidAt: dayFromIso(todayIso()), version: { increment: 1 } },
      include,
    });
    const target = `${fullName(fee.coach.user)} · ${fee.period}`;
    await this.audit.log(user.id, {
      action: 'Salaire marqué versé',
      entity: 'CoachFee',
      entityId: id,
      target,
      before: 'À verser',
      after: 'Versé',
    });
    await this.mail.send(
      fee.coach.user.email,
      `Votre salaire (${fee.period}) est versé`,
      `Bonjour ${fee.coach.user.firstName},\n\nVotre salaire de ${fee.period} (${dt(fee.amount)}) a été versé.\n\nLe bureau du TCSAY`,
      'SALARY',
    );
    return view(updated);
  }

  private async find(id: string) {
    const fee = await this.prisma.coachFee.findUnique({ where: { id }, include });
    if (!fee) throw notFound('Salaire');
    return fee;
  }
}

function view(f: {
  id: string;
  period: string;
  amount: { toNumber(): number };
  paidAt: Date | null;
  version: number;
  coach: { id: string; user: { firstName: string; lastName: string } };
  season: { id: string; label: string; status: string };
}) {
  return {
    id: f.id,
    period: f.period,
    amount: num(f.amount as never),
    paidAt: f.paidAt,
    paid: Boolean(f.paidAt),
    version: f.version,
    coach: { id: f.coach.id, firstName: f.coach.user.firstName, lastName: f.coach.user.lastName },
    season: f.season,
  };
}
