import { Body, ConflictException, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FeeSchedule, Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm, Roles } from '../auth/auth-user';
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

  /** Séance physique incluse dans le tarif. */
  @IsOptional()
  @IsBoolean()
  physicalIncluded?: boolean;

  /** Tarif commun à la paire (garçons et filles), par défaut oui. */
  @IsOptional()
  @IsBoolean()
  pair?: boolean;
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

  /** Séance physique incluse dans le tarif. */
  @IsOptional()
  @IsBoolean()
  physicalIncluded?: boolean;

  /** Applique aussi le montant à l'autre catégorie de la paire (même saison, même groupe), par défaut oui. */
  @IsOptional()
  @IsBoolean()
  pair?: boolean;

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
        category: { select: { id: true, name: true, pairCode: true, gender: true } },
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
    return fee ? { id: fee.id, amount: fee.amount, depositAmount: fee.depositAmount, physicalIncluded: fee.physicalIncluded, season: season.label } : null;
  }

  /** Catégories de la même paire (ex. Lutins et Lutines), la catégorie choisie en premier. */
  private async pairOf(categoryId: string, pair: boolean) {
    const cat = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!cat || cat.archivedAt) throw notFound('Catégorie');
    if (!pair) return [cat];
    const others = await this.prisma.category.findMany({ where: { pairCode: cat.pairCode, id: { not: cat.id }, archivedAt: null }, orderBy: { sortOrder: 'asc' } });
    return [cat, ...others];
  }

  /** Tarif créé pour la paire de catégories (garçons et filles) : un tarif existant de la paire prend le même montant (tarif commun). */
  @Post()
  @Perm('fees.manage')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateFeeDto) {
    const season = await this.access.seasonOrActive(dto.seasonId);
    if (LOCKED_SEASON.includes(season.status)) {
      throw rule.conflict('R1', `Saison ${season.label} verrouillée : création de tarif impossible.`);
    }
    const categories = await this.pairOf(dto.categoryId, dto.pair ?? true);
    const values = { amount: dto.amount, depositAmount: Math.min(dto.depositAmount, dto.amount), physicalIncluded: dto.physicalIncluded ?? false };
    const label = `${dt(values.amount)} · acompte ${dt(values.depositAmount)}${values.physicalIncluded ? ' · séance physique incluse' : ''}`;
    const saved = [];
    for (const c of categories) {
      const existing = await this.prisma.feeSchedule.findFirst({ where: { seasonId: season.id, categoryId: c.id, groupId: dto.groupId ?? null }, include: { group: true } });
      if (existing && categories.length === 1) throw new ConflictException(`Un tarif existe déjà pour ${c.name}${existing.group ? ' · ' + existing.group.name : ''} : modifiez-le.`);
      const fee = existing
        ? await this.prisma.feeSchedule.update({ where: { id: existing.id }, data: { ...values, version: { increment: 1 } }, include: { category: true, group: true } })
        : await this.prisma.feeSchedule.create({ data: { seasonId: season.id, categoryId: c.id, groupId: dto.groupId ?? null, ...values }, include: { category: true, group: true } });
      await this.audit.log(user.id, {
        action: existing ? 'Tarif modifié (tarif commun de la paire)' : 'Tarif créé',
        entity: 'FeeSchedule',
        entityId: fee.id,
        target: `${fee.category.name}${fee.group ? ' · ' + fee.group.name : ''} · ${season.label}`,
        before: existing ? `${dt(existing.amount)} · acompte ${dt(existing.depositAmount)}${existing.physicalIncluded ? ' · séance physique incluse' : ''}` : null,
        after: label,
      });
      saved.push(fee);
    }
    return saved[0];
  }

  /** R6 : sur saison clôturée, motif obligatoire ; anciennes valeurs conservées dans l'audit. Montant commun à la paire. */
  @Patch(':id')
  @Perm('fees.manage')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFeeDto) {
    const fee = await this.prisma.feeSchedule.findUnique({
      where: { id },
      include: { season: true, category: true, group: true },
    });
    if (!fee) throw notFound('Tarif');
    assertVersion(fee, dto.version, 'Ce tarif');
    const reason = dto.reason?.trim() || null;
    const locked = LOCKED_SEASON.includes(fee.season.status);
    if (locked && !reason) {
      throw rule.bad('R6', `Saison ${fee.season.label} clôturée : motif obligatoire pour modifier ce tarif.`);
    }
    const siblings =
      (dto.pair ?? true)
        ? await this.prisma.feeSchedule.findMany({
            where: { seasonId: fee.seasonId, groupId: fee.groupId, id: { not: fee.id }, category: { pairCode: fee.category.pairCode, archivedAt: null } },
            include: { category: true, group: true },
          })
        : [];
    const data = {
      amount: dto.amount,
      depositAmount: Math.min(dto.depositAmount, dto.amount),
      physicalIncluded: dto.physicalIncluded ?? fee.physicalIncluded,
      version: { increment: 1 },
    };
    const text = (f: { amount: unknown; depositAmount: unknown; physicalIncluded: boolean }) =>
      `${dt(f.amount as number)} · acompte ${dt(f.depositAmount as number)}${f.physicalIncluded ? ' · séance physique incluse' : ''}`;
    let updated: FeeSchedule | null = null;
    for (const f of [fee, ...siblings]) {
      const u = await this.prisma.feeSchedule.update({ where: { id: f.id }, data });
      if (f.id === fee.id) updated = u;
      await this.audit.log(user.id, {
        action: locked ? 'Tarif modifié (saison clôturée)' : f.id === fee.id ? 'Tarif modifié' : 'Tarif modifié (tarif commun de la paire)',
        entity: 'FeeSchedule',
        entityId: f.id,
        target: `${f.category.name}${f.group ? ' · ' + f.group.name : ''} · ${fee.season.label}`,
        before: text(f),
        after: text(u),
        reason,
      });
    }
    return updated;
  }
}
