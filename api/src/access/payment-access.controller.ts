import { Body, Controller, ForbiddenException, Get, NotFoundException, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role, SeasonStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, can, CurrentUser, Roles } from '../auth/auth-user';
import { addDaysIso, dayFromIso, isoDay, todayIso } from '../common/dates';
import { num } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from './access.service';
import { ACCESS_MODULE_LABEL, ACCESS_MODULES, PaymentAccessService } from './payment-access.service';

class ModulesDto {
  @IsBoolean() sessions: boolean;
  @IsBoolean() progress: boolean;
  @IsBoolean() exercises: boolean;
  @IsBoolean() reservation: boolean;
}

class ConfigDto {
  @IsBoolean()
  enabled: boolean;

  @Type(() => Number)
  @IsInt()
  @IsIn([0, 3, 7, 15, 30], { message: 'Délai de grâce : 0, 3, 7, 15 ou 30 jours.' })
  graceDays: number;

  @ValidateNested()
  @Type(() => ModulesDto)
  modules: ModulesDto;
}

class PlayerQuery {
  @IsOptional()
  @IsUUID()
  playerId?: string;
}

class ExemptionDto {
  @IsUUID()
  playerId: string;

  /** Motif de l'exception ; vide = retirer l'exception. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * Accès après paiement : le président règle les modules fermés au joueur et au parent tant qu'une tranche échue
 * (délai de grâce passé) n'est pas payée ; exception par joueur avec motif. Paiements, reçus et notifications restent ouverts ;
 * l'entraîneur garde toujours le joueur dans ses présences.
 */
@ApiTags('Accès après paiement')
@ApiBearerAuth()
@Controller('access/payment')
export class PaymentAccessController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly gate: PaymentAccessService,
    private readonly audit: AuditService,
  ) {}

  private assertAdmin(user: AuthUser, write = false) {
    const ok = write ? can(user, 'permissions.manage') : can(user, 'permissions.manage', 'payments.collect');
    if (!ok) throw new ForbiddenException(write ? 'Réservé au président.' : 'Accès refusé : autorisation « paiements » manquante.');
  }

  @Get('config')
  @Roles(Role.ADMIN)
  async getConfig(@CurrentUser() user: AuthUser) {
    this.assertAdmin(user);
    return { ...(await this.gate.config()), labels: ACCESS_MODULE_LABEL };
  }

  @Put('config')
  @Roles(Role.ADMIN)
  async setConfig(@CurrentUser() user: AuthUser, @Body() dto: ConfigDto) {
    this.assertAdmin(user, true);
    const before = await this.gate.config();
    const saved = await this.gate.save({ enabled: dto.enabled, graceDays: dto.graceDays, modules: { ...dto.modules } });
    const describe = (c: typeof saved) =>
      c.enabled ? `Activé · grâce ${c.graceDays} j · ${ACCESS_MODULES.filter((m) => c.modules[m]).map((m) => ACCESS_MODULE_LABEL[m]).join(', ') || 'aucun module'}` : 'Désactivé';
    await this.audit.log(user.id, { action: 'Accès après paiement réglé', entity: 'Setting', target: 'access.payment', before: describe(before), after: describe(saved) });
    return saved;
  }

  /** Joueur / parent : modules fermés pour ce joueur. */
  @Get('status')
  @Roles(Role.PLAYER, Role.PARENT)
  async status(@CurrentUser() user: AuthUser, @Query() q: PlayerQuery) {
    const playerId = await this.access.resolvePlayer(user, q.playerId);
    return this.gate.status(playerId);
  }

  /** Joueurs dont l'accès est fermé (ou qui ont une exception), saison active. */
  @Get('locked')
  @Roles(Role.ADMIN)
  async locked(@CurrentUser() user: AuthUser) {
    this.assertAdmin(user);
    const config = await this.gate.config();
    const limit = dayFromIso(addDaysIso(todayIso(), -config.graceDays));
    const rows = await this.prisma.installment.findMany({
      where: { dueDate: { lt: limit }, membership: { enrollment: { season: { status: SeasonStatus.ACTIVE }, player: { archivedAt: null } } } },
      orderBy: { dueDate: 'asc' },
      include: {
        payments: { select: { amount: true } },
        membership: { select: { enrollment: { select: { player: { select: { id: true, firstName: true, lastName: true, memberCode: true, accessExemptReason: true } } } } } },
      },
    });
    const seen = new Map<string, { id: string; name: string; code: string | null; exempt: string | null; installment: string; dueDate: string; remaining: number }>();
    for (const i of rows) {
      const p = i.membership.enrollment.player;
      if (seen.has(p.id)) continue;
      const remaining = Math.round((num(i.amount) - i.payments.reduce((t, x) => t + num(x.amount), 0)) * 1000) / 1000;
      if (remaining <= 0) continue;
      seen.set(p.id, {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`.trim(),
        code: p.memberCode,
        exempt: p.accessExemptReason,
        installment: `${i.number}/${i.count}`,
        dueDate: isoDay(i.dueDate),
        remaining,
      });
    }
    const exemptOnly = await this.prisma.player.findMany({
      where: { archivedAt: null, accessExemptReason: { not: null }, id: { notIn: [...seen.keys()] } },
      select: { id: true, firstName: true, lastName: true, memberCode: true, accessExemptReason: true },
    });
    return {
      enabled: config.enabled,
      players: [
        ...seen.values(),
        ...exemptOnly.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), code: p.memberCode, exempt: p.accessExemptReason, installment: null, dueDate: null, remaining: 0 })),
      ],
    };
  }

  /** Exception (motif obligatoire) ou retrait de l'exception. */
  @Put('exemption')
  @Roles(Role.ADMIN)
  async exemption(@CurrentUser() user: AuthUser, @Body() dto: ExemptionDto) {
    this.assertAdmin(user);
    const player = await this.prisma.player.findUnique({ where: { id: dto.playerId }, select: { firstName: true, lastName: true, accessExemptReason: true } });
    if (!player) throw new NotFoundException('Joueur introuvable.');
    const reason = dto.reason?.trim() || null;
    await this.prisma.player.update({ where: { id: dto.playerId }, data: { accessExemptReason: reason, accessExemptAt: reason ? new Date() : null } });
    await this.audit.log(user.id, {
      action: reason ? 'Exception d’accès accordée' : 'Exception d’accès retirée',
      entity: 'Player',
      entityId: dto.playerId,
      target: `${player.firstName} ${player.lastName}`.trim(),
      before: player.accessExemptReason ?? undefined,
      after: reason ?? undefined,
      reason: reason ?? undefined,
    });
    return { exempt: reason };
  }
}
