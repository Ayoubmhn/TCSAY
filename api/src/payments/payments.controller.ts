import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DiscountKind, PaymentMethod, PaymentPlan, Role } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { PaymentConfigService } from './payment-config.service';
import { AuthUser, can, CurrentUser, Perm, Roles } from '../auth/auth-user';
import { rule } from '../common/rules';
import { PaymentsService } from './payments.service';

class InstallmentsQuery {
  @IsOptional()
  @IsUUID()
  seasonId?: string;

  @IsOptional()
  @IsUUID()
  playerId?: string;

  /** Recherche : nom du joueur ou du parent (administration). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;
}

class CashDto {
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Saisissez un montant positif.' })
  @Min(0.001, { message: 'Saisissez un montant positif.' })
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  /** Espèces (par défaut), chèque ou virement, saisis par l'admin (modes acceptés : configuration des paiements). */
  @IsOptional()
  @IsIn([PaymentMethod.CASH, PaymentMethod.CHEQUE, PaymentMethod.TRANSFER], { message: 'Mode : espèces, chèque ou virement.' })
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  chequeNumber?: string;

  /** Montant supérieur au restant : réparti sur les tranches suivantes (un seul reçu). */
  @IsOptional()
  @IsBoolean()
  spread?: boolean;

  /** N° pré-imprimé du carnet : le reçu est émis avec l'encaissement (obligatoire si le club l'exige). */
  @IsOptional()
  @IsInt({ message: 'N° de reçu invalide.' })
  @Min(1)
  @Max(99_999_999)
  receiptNumber?: number;
}

class ConfigDto {
  @IsObject()
  config: Record<string, unknown>;
}

class PreviewDto {
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deposit?: number;
}

class PlanPreviewQuery {
  @IsEnum(PaymentPlan)
  plan: PaymentPlan;

  @IsOptional()
  @IsUUID()
  playerId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;
}

class RescheduleDto {
  @IsString()
  @IsNotEmpty({ message: 'Le motif est obligatoire.' })
  @MaxLength(300)
  reason: string;
}

class MembershipDto {
  @IsUUID()
  playerId: string;

  @IsEnum(PaymentPlan, { message: 'Mode de paiement : comptant, par semestre, par trimestre, par mois ou modèle du club.' })
  paymentPlan: PaymentPlan;

  /** Modèle d'échéancier du club (mode CUSTOM). */
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsUUID()
  seasonId?: string;
}

class PlanDto {
  @IsUUID()
  playerId: string;

  @IsEnum(PaymentPlan, { message: 'Mode de paiement : comptant, par semestre, par trimestre, par mois ou modèle du club.' })
  paymentPlan: PaymentPlan;

  /** Modèle d'échéancier du club (mode CUSTOM). */
  @IsOptional()
  @IsUUID()
  templateId?: string;

  /** Obligatoire si des paiements sont déjà encaissés ou si des dates sont choisies (R7). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  /** Dates choisies pour ce joueur (une par nouvelle tranche, AAAA-MM-JJ). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true, message: 'Date invalide.' })
  dueDates?: string[];
}

class DiscountDto {
  @IsUUID()
  playerId: string;

  /** null : retire la réduction. */
  @IsOptional()
  @IsEnum(DiscountKind)
  kind: DiscountKind | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  percent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

class DueDateDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date limite invalide.' })
  dueDate: string;

  @IsString()
  @IsNotEmpty({ message: 'Le motif est obligatoire.' })
  @MaxLength(300)
  reason: string;
}

class MissingDto {
  @IsEnum(PaymentPlan, { message: 'Mode de paiement : comptant, par semestre, par trimestre, par mois ou modèle du club.' })
  paymentPlan: PaymentPlan;

  /** Modèle d'échéancier du club (mode CUSTOM). */
  @IsOptional()
  @IsUUID()
  templateId?: string;
}

/** Cotisations : C, R, U (pas de D) ; paiements : C (espèces ou chèque) et R seulement (R7). Coach : 403. */
@ApiTags('Cotisations et paiements')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly config: PaymentConfigService,
    private readonly receipts: ReceiptsService,
    private readonly audit: AuditService,
  ) {}

  /** Configuration des paiements (modes, échéances, acompte, rappels, encaissement). */
  @Get('payments/config')
  @Perm('payments.collect', 'players.manage', 'fees.manage', 'permissions.manage')
  getConfig() {
    return this.config.get();
  }

  @Put('payments/config')
  @Perm('permissions.manage')
  async saveConfig(@CurrentUser() user: AuthUser, @Body() dto: ConfigDto) {
    const before = await this.config.get();
    const saved = await this.config.save(dto.config);
    await this.audit.log(user.id, {
      action: 'Configuration des paiements modifiée',
      entity: 'Setting',
      entityId: 'payment.config',
      target: 'Configuration des paiements',
      before: JSON.stringify(before),
      after: JSON.stringify(saved),
    });
    return saved;
  }

  /** Aperçu des échéanciers d'une configuration (en cours de saisie) pour un montant. */
  @Post('payments/config/preview')
  @Perm('payments.collect', 'players.manage', 'fees.manage', 'permissions.manage')
  previewConfig(@Body() dto: PreviewDto) {
    return this.payments.previewConfig(dto.config, dto.amount, dto.deposit ?? 0);
  }

  /** Refait les tranches non payées de la saison active selon la configuration (R7 : motif, tranches payées gardées). */
  @Post('payments/config/reschedule')
  @Perm('permissions.manage')
  reschedule(@CurrentUser() user: AuthUser, @Body() dto: RescheduleDto) {
    return this.payments.rescheduleAll(user, dto.reason.trim());
  }

  /** Aperçu de l'échéancier dans la fiche joueur (mode choisi). */
  @Get('memberships/preview')
  @Perm('payments.collect', 'players.manage')
  previewPlan(@Query() q: PlanPreviewQuery) {
    return this.payments.previewPlan(q.plan, q.playerId, q.categoryId, q.templateId);
  }

  @Get('installments')
  @Roles(Role.ADMIN, Role.PLAYER, Role.PARENT)
  installments(@CurrentUser() user: AuthUser, @Query() q: InstallmentsQuery) {
    if (user.role === Role.ADMIN && !can(user, 'payments.collect', 'players.manage')) {
      throw new ForbiddenException('Accès refusé : autorisation « paiements » manquante.');
    }
    return this.payments.installments(user, q.seasonId, q.playerId, { q: q.q, parentId: q.parentId, groupId: q.groupId });
  }

  @Post('installments/:id/payments')
  @Perm('payments.collect')
  async cash(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CashDto) {
    const cfg = await this.config.get();
    if (dto.method && !cfg.collect.methods.includes(dto.method)) throw new BadRequestException('Mode de paiement non accepté par le club (Configuration des paiements).');
    if (cfg.collect.receiptRequired && !dto.receiptNumber) throw new BadRequestException('Saisissez le n° du reçu du carnet (obligatoire à l’encaissement).');
    if (dto.receiptNumber) await this.receipts.assertNumberFree(dto.receiptNumber);
    const result = await this.payments.cash(user, id, dto.amount, dto.note, dto.method, dto.chequeNumber, dto.spread);
    if (!dto.receiptNumber) return result;
    // Reçu émis avec l'encaissement, valeurs proposées (payeur, montant en lettres, tranche, date).
    const { draft } = await this.receipts.forPayment(result.paymentId);
    const receipt = await this.receipts.create(user, result.paymentId, { ...draft, number: dto.receiptNumber });
    return { ...result, receiptId: receipt.id };
  }

  @Patch('installments/:id/due-date')
  @Perm('payments.collect')
  dueDate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DueDateDto) {
    return this.payments.changeDueDate(user, id, dto.dueDate, dto.reason.trim());
  }

  @Post('installments/:id/remind')
  @Perm('payments.collect')
  remind(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.remind(user, id);
  }

  @Post('memberships')
  @Perm('payments.collect', 'players.manage')
  createMembership(@CurrentUser() user: AuthUser, @Body() dto: MembershipDto) {
    return this.payments.createMembership(user, dto.playerId, dto.paymentPlan, dto.seasonId, dto.templateId);
  }

  @Put('memberships/plan')
  @Perm('payments.collect', 'players.manage')
  changePlan(@CurrentUser() user: AuthUser, @Body() dto: PlanDto) {
    return this.payments.changePlan(user, dto.playerId, dto.paymentPlan, dto.reason, undefined, dto.dueDates, dto.templateId);
  }

  @Put('memberships/discount')
  @Perm('payments.collect', 'players.manage')
  setDiscount(@CurrentUser() user: AuthUser, @Body() dto: DiscountDto) {
    return this.payments.setDiscount(user, dto.playerId, { kind: dto.kind ?? null, percent: dto.percent, amount: dto.amount, reason: dto.reason });
  }

  @Get('memberships/player/:playerId')
  @Perm('payments.collect', 'players.manage')
  membershipInfo(@Param('playerId', ParseUUIDPipe) playerId: string) {
    return this.payments.membershipInfo(playerId);
  }

  @Get('memberships/missing')
  @Perm('payments.collect', 'players.manage')
  missing() {
    return this.payments.missingCount();
  }

  @Post('memberships/missing')
  @Perm('payments.collect', 'players.manage')
  createMissing(@CurrentUser() user: AuthUser, @Body() dto: MissingDto) {
    return this.payments.createMissing(user, dto.paymentPlan);
  }

  @Get('payments')
  @Perm('payments.collect')
  list(@Query() q: InstallmentsQuery) {
    return this.payments.payments(q.seasonId);
  }

  /** R7 : un paiement encaissé n'est jamais modifié. */
  @Patch('payments/:id')
  @Perm('payments.collect')
  update() {
    throw rule.conflict('R7', 'Un paiement encaissé ne peut pas être modifié. Créez un remboursement ou une écriture corrective.');
  }

  /** R7 : un paiement encaissé n'est jamais supprimé. */
  @Delete('payments/:id')
  @Perm('payments.collect')
  remove() {
    throw rule.conflict('R7', 'Un paiement encaissé ne peut pas être supprimé. Créez un remboursement ou une écriture corrective.');
  }
}
