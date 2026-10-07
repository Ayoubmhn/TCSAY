import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { dt } from '../common/money';
import { LOCKED_SEASON, assertVersion, notFound, rule } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';

const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);

class CreateFeeDto {
  @IsOptional()
  @IsUUID()
  seasonId?: string;

  @IsUUID('all', { message: 'Catégorie obligatoire.' })
  categoryId: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  groupId?: string;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Montant invalide.' })
  @Min(0)
  amount: number;

  /** Acompte demandé à l'inscription (paiement par semestre ou par mois). */
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Acompte invalide.' })
  @Min(0)
  depositAmount: number;
}

class UpdateFeeDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Montant invalide.' })
  @Min(0)
  amount: number;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Acompte invalide.' })
  @Min(0)
  depositAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

class CategoryQuery {
  @IsUUID()
  categoryId: string;
}

class ListQuery {
  @IsOptional()
  @IsUUID()
  seasonId?: string;
}

/** Tarifs d'entraînement par catégorie et par groupe (montants : base, jamais inventés). */
@ApiTags('Tarifs d’entraînement')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('fees')
export class FeesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query() q: ListQuery) {
    const season = await this.access.seasonOrActive(q.seasonId);
    return this.prisma.feeSchedule.findMany({
      where: { seasonId: season.id },
      include: {
        category: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        season: { select: { id: true, label: true, status: true } },
      },
      orderBy: { category: { sortOrder: 'asc' } },
    });
  }

  /** Tarif applicable à une catégorie sur la saison active (montant + acompte), pour le formulaire joueur. */
  @Get('for-category')
  async forCategory(@Query() q: CategoryQuery) {
    const season = await this.access.activeSeason();
    const fee =
      (await this.prisma.feeSchedule.findFirst({ where: { seasonId: season.id, categoryId: q.categoryId, groupId: null } })) ??
      (await this.prisma.feeSchedule.findFirst({ where: { seasonId: season.id, categoryId: q.categoryId } }));
    return fee ? { id: fee.id, amount: fee.amount, depositAmount: fee.depositAmount, season: season.label } : null;
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateFeeDto) {
    const season = await this.access.seasonOrActive(dto.seasonId);
    if (LOCKED_SEASON.includes(season.status)) {
      throw rule.conflict('R1', `Saison ${season.label} verrouillée : création de tarif impossible.`);
    }
    const fee = await this.prisma.feeSchedule.create({
      data: {
        seasonId: season.id,
        categoryId: dto.categoryId,
        groupId: dto.groupId ?? null,
        amount: dto.amount,
        depositAmount: Math.min(dto.depositAmount, dto.amount),
      },
      include: { category: true, group: true },
    });
    await this.audit.log(user.id, {
      action: 'Tarif créé',
      entity: 'FeeSchedule',
      entityId: fee.id,
      target: `${fee.category.name}${fee.group ? ' · ' + fee.group.name : ''} · ${season.label}`,
      after: `${dt(fee.amount)} · acompte ${dt(fee.depositAmount)}`,
    });
    return fee;
  }

  /** R6 : sur saison clôturée, motif obligatoire ; anciennes valeurs conservées dans l'audit. */
  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFeeDto) {
    const fee = await this.prisma.feeSchedule.findUnique({
      where: { id },
      include: { season: true, category: true, group: true },
    });
    if (!fee) throw notFound('Tarif');
    assertVersion(fee, dto.version, 'Ce tarif');
    const reason = dto.reason?.trim() || null;
    if (LOCKED_SEASON.includes(fee.season.status) && !reason) {
      throw rule.bad('R6', `Saison ${fee.season.label} clôturée : motif obligatoire pour modifier ce tarif.`);
    }
    const updated = await this.prisma.feeSchedule.update({
      where: { id },
      data: { amount: dto.amount, depositAmount: Math.min(dto.depositAmount, dto.amount), version: { increment: 1 } },
    });
    await this.audit.log(user.id, {
      action: LOCKED_SEASON.includes(fee.season.status) ? 'Tarif modifié (saison clôturée)' : 'Tarif modifié',
      entity: 'FeeSchedule',
      entityId: id,
      target: `${fee.category.name}${fee.group ? ' · ' + fee.group.name : ''} · ${fee.season.label}`,
      before: `${dt(fee.amount)} · acompte ${dt(fee.depositAmount)}`,
      after: `${dt(updated.amount)} · acompte ${dt(updated.depositAmount)}`,
      reason,
    });
    return updated;
  }
}
