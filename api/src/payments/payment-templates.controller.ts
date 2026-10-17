import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { todayIso } from '../common/dates';
import { assertVersion, notFound } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentConfigService } from './payment-config.service';
import { templateError, templateInstallments, type TemplateLine, type TemplateSpec } from './payment-plan';

class LineDto {
  /** « ENROLL » (à l'inscription) ou « MM-JJ ». */
  @Matches(/^(ENROLL|(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))$/, { message: 'Date de tranche invalide.' })
  date: string;

  @IsIn(['PERCENT', 'AMOUNT', 'REST'])
  mode: 'PERCENT' | 'AMOUNT' | 'REST';

  @IsNumber()
  @Min(0)
  @Max(100000)
  value: number;
}

class TemplateDto {
  @IsString()
  @IsNotEmpty({ message: 'Le nom du modèle est obligatoire.' })
  @MaxLength(80)
  name: string;

  @IsIn(['FIXED', 'MONTHLY'])
  kind: 'FIXED' | 'MONTHLY';

  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines: LineDto[];

  @IsInt()
  @Min(1)
  @Max(28)
  monthlyDay: number;

  @IsArray()
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  months: number[];

  @IsBoolean()
  deposit: boolean;

  @IsIn(['ALL', 'COMPETITIVE', 'LEISURE'])
  scope: 'ALL' | 'COMPETITIVE' | 'LEISURE';

  @IsBoolean()
  visible: boolean;

  @IsIn(['MERGE', 'SPREAD'])
  lateMode: 'MERGE' | 'SPREAD';
}

class UpdateTemplateDto extends TemplateDto {
  @IsInt()
  @Min(1)
  version: number;
}

class PreviewDto {
  @IsObject()
  @ValidateNested()
  @Type(() => TemplateDto)
  template: TemplateDto;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deposit?: number;

  /** Date d'inscription simulée (AAAA-MM-JJ), sinon aujourd'hui. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  on?: string;
}

const spec = (d: TemplateDto): TemplateSpec => ({
  kind: d.kind,
  lines: d.kind === 'FIXED' ? d.lines.map((l) => ({ date: l.date, mode: l.mode, value: Number(l.value) })) : [],
  monthlyDay: d.monthlyDay,
  months: [...new Set(d.months)].sort((a, b) => a - b),
  deposit: d.deposit,
  lateMode: d.lateMode,
});

const describe = (t: { kind: string; lines: unknown; months: number[]; monthlyDay: number }) =>
  t.kind === 'MONTHLY'
    ? `mensuel le ${t.monthlyDay}, mois ${t.months.join(', ')}`
    : (t.lines as TemplateLine[]).map((l) => `${l.date === 'ENROLL' ? 'inscription' : l.date} : ${l.mode === 'REST' ? 'le reste' : l.mode === 'PERCENT' ? `${l.value} %` : `${l.value} DT`}`).join(' · ');

/** Modèles d'échéancier du club (Configuration des paiements › Modèles du club). Suppression = archivage (R8). */
@ApiTags('Cotisations et paiements')
@ApiBearerAuth()
@Controller('payments/templates')
export class PaymentTemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly config: PaymentConfigService,
  ) {}

  /** Modèles (actifs puis archivés) avec le nombre de cotisations de la saison active qui les utilisent. */
  @Get()
  @Perm('payments.collect', 'players.manage', 'fees.manage', 'permissions.manage')
  async list() {
    const season = await this.access.activeSeason();
    const rows = await this.prisma.paymentTemplate.findMany({
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
      include: { _count: { select: { memberships: { where: { enrollment: { seasonId: season.id } } } } } },
    });
    return rows.map(({ _count, ...t }) => ({ ...t, used: _count.memberships }));
  }

  /** Aperçu d'un modèle (en cours de saisie) pour un montant, sur la saison active. */
  @Post('preview')
  @HttpCode(200)
  @Perm('payments.collect', 'players.manage', 'fees.manage', 'permissions.manage')
  async preview(@Body() dto: PreviewDto) {
    const t = spec(dto.template);
    const error = templateError(t);
    if (error) return { error, schedule: [] };
    const season = await this.access.activeSeason();
    return { error: null, schedule: templateInstallments(t, dto.amount, dto.deposit ?? 0, season, dto.on ?? todayIso(), await this.config.get()) };
  }

  @Post()
  @Perm('permissions.manage')
  async create(@CurrentUser() user: AuthUser, @Body() dto: TemplateDto) {
    const t = spec(dto);
    const error = templateError(t);
    if (error) throw new BadRequestException(error);
    const row = await this.prisma.paymentTemplate.create({
      data: { name: dto.name.trim(), kind: t.kind, lines: t.lines, monthlyDay: t.monthlyDay, months: t.months, deposit: t.deposit, scope: dto.scope, visible: dto.visible, lateMode: t.lateMode, createdById: user.id },
    });
    await this.audit.log(user.id, { action: 'Modèle d’échéancier créé', entity: 'PaymentTemplate', entityId: row.id, target: row.name, after: describe(row) });
    return row;
  }

  /** Ne change que les nouvelles inscriptions (sauf « Refaire les échéanciers non payés »). R13 : version. */
  @Patch(':id')
  @Perm('permissions.manage')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTemplateDto) {
    const before = await this.prisma.paymentTemplate.findUnique({ where: { id } });
    if (!before) throw notFound('Modèle');
    assertVersion(before, dto.version, 'Ce modèle');
    const t = spec(dto);
    const error = templateError(t);
    if (error) throw new BadRequestException(error);
    const row = await this.prisma.paymentTemplate.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        kind: t.kind,
        lines: t.lines,
        monthlyDay: t.monthlyDay,
        months: t.months,
        deposit: t.deposit,
        scope: dto.scope,
        visible: dto.visible,
        lateMode: t.lateMode,
        version: { increment: 1 },
      },
    });
    await this.audit.log(user.id, { action: 'Modèle d’échéancier modifié', entity: 'PaymentTemplate', entityId: id, target: row.name, before: describe(before), after: describe(row) });
    return row;
  }

  /** R8 : un modèle n'est jamais supprimé ; archivé, il n'est plus proposé (les cotisations gardent leurs tranches). */
  @Post(':id/archive')
  @HttpCode(200)
  @Perm('permissions.manage')
  async archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const t = await this.prisma.paymentTemplate.findUnique({ where: { id } });
    if (!t) throw notFound('Modèle');
    await this.prisma.paymentTemplate.update({ where: { id }, data: { archivedAt: t.archivedAt ? null : new Date(), version: { increment: 1 } } });
    await this.audit.log(user.id, { action: t.archivedAt ? 'Modèle d’échéancier restauré' : 'Modèle d’échéancier archivé', entity: 'PaymentTemplate', entityId: id, target: t.name });
    return { archived: !t.archivedAt };
  }
}
