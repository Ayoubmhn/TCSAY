import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsOptional, Matches } from 'class-validator';
import { Perm } from '../auth/auth-user';
import { todayIso } from '../common/dates';
import { AuditService } from './audit.service';

/** Rôle affiché pour l'auteur d'une action (le plus « administratif » de ses rôles). */
const ORDER: Role[] = [Role.PRESIDENT, Role.ADMIN_AGENT, Role.SUPERVISOR, Role.TECH_DIRECTOR, Role.COACH, Role.PARENT, Role.PLAYER];

class MonthQuery {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Mois au format AAAA-MM.' })
  month?: string;
}

/**
 * Historique des actions (administration, entraîneurs, personnel) : jamais modifié ni supprimé
 * (déclencheur en base). Consultable par mois et par jour pour le compte rendu mensuel.
 */
@ApiTags('Journal d’audit')
@ApiBearerAuth()
@Perm('audit.view')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(@Query() q: MonthQuery) {
    const rows = await this.audit.month(q.month ?? todayIso().slice(0, 7));
    return rows.map(({ user, ...row }) => ({
      ...row,
      who: user ? `${user.firstName} ${user.lastName}`.trim() : 'Système',
      role: user ? (ORDER.find((r) => user.roles.includes(r)) ?? null) : null,
      roles: user?.roles ?? [],
    }));
  }
}
