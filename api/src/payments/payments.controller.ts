import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PaymentPlan, Role } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
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
}

class MembershipDto {
  @IsUUID()
  playerId: string;

  @IsEnum(PaymentPlan, { message: 'Mode de paiement : comptant, par semestre ou par mois.' })
  paymentPlan: PaymentPlan;

  @IsOptional()
  @IsUUID()
  seasonId?: string;
}

/** Cotisations : C, R, U (pas de D) ; paiements : C (espèces) et R seulement (R7). Coach : 403. */
@ApiTags('Cotisations et paiements')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

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
  cash(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CashDto) {
    return this.payments.cash(user, id, dto.amount, dto.note);
  }

  @Post('installments/:id/remind')
  @Perm('payments.collect')
  remind(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.remind(user, id);
  }

  @Post('memberships')
  @Perm('payments.collect', 'players.manage')
  createMembership(@CurrentUser() user: AuthUser, @Body() dto: MembershipDto) {
    return this.payments.createMembership(user, dto.playerId, dto.paymentPlan, dto.seasonId);
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
