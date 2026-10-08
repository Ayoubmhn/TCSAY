import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, Role } from '@prisma/client';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm, Roles } from '../auth/auth-user';
import { dayFromIso, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { LOCKED_SEASON, assertVersion, fullName, notFound, rule } from '../common/rules';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalariesService } from './salaries.service';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Types de salariés : un même compte peut en cumuler plusieurs (ex. directeur technique et entraîneur). */
export const EMPLOYEE_TYPES = ['COACH', 'ADMIN_AGENT', 'SUPERVISOR', 'TECH_DIRECTOR'] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];

class ListQuery {
  @IsOptional()
  @IsIn(EMPLOYEE_TYPES)
  type?: EmployeeType;

  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

class EstimateQuery {
  @IsUUID()
  employeeId: string;

  @Matches(MONTH, { message: 'Mois au format AAAA-MM.' })
  month: string;
}

class CreateSalaryDto {
  @IsUUID('all', { message: 'Employé obligatoire.' })
  employeeId: string;

  @Matches(MONTH, { message: 'Mois au format AAAA-MM.' })
  month: string;

  /** Facultatif : sinon montant calculé (séances animées, absences, forfait). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Montant invalide.' })
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  hours?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
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

const include = {
  employee: {
    select: { id: true, firstName: true, lastName: true, email: true, roles: true, coach: { select: { id: true, color: true } } },
  },
  season: { select: { id: true, label: true, status: true } },
} satisfies Prisma.SalaryInclude;

type Row = Prisma.SalaryGetPayload<{ include: typeof include }>;

/** Types de salarié d'un compte, du plus « administratif » au terrain. */
export function employeeTypes(u: { roles: Role[] }): EmployeeType[] {
  return (['TECH_DIRECTOR', 'ADMIN_AGENT', 'SUPERVISOR', 'COACH'] as const).filter((t) => u.roles.includes(t as Role));
}

export function employeeType(u: { roles: Role[] }): EmployeeType | null {
  return employeeTypes(u)[0] ?? null;
}

/** Salaires des employés : entraîneurs, agents administratifs, directeur technique. */
@ApiTags('Salaires')
@ApiBearerAuth()
@Controller('salaries')
export class SalariesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly salaries: SalariesService,
  ) {}

  /** Employés salariés, filtrés par type (sélecteur de la page Salaires). */
  @Get('employees')
  @Perm('salaries.manage')
  async employees(@Query() q: ListQuery) {
    const users = await this.prisma.user.findMany({
      where: this.typeWhere(q.type),
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      include: { coach: { select: { id: true, color: true } } },
    });
    return users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      type: q.type && employeeTypes(u).includes(q.type) ? q.type : employeeType(u),
      types: employeeTypes(u),
      payMode: u.payMode,
      payRate: num(u.payRate),
      isActive: u.isActive,
      coach: u.coach,
    }));
  }

  @Get()
  @Perm('salaries.manage')
  async list(@Query() q: ListQuery) {
    const rows = await this.prisma.salary.findMany({
      where: { employeeId: q.employeeId, employee: this.typeWhere(q.type) },
      include,
      orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(view);
  }

  /** Proposition de salaire pour un mois (séances animées, absences validées, forfait). */
  @Get('estimate')
  @Perm('salaries.manage')
  estimate(@Query() q: EstimateQuery) {
    return this.salaries.estimate(q.employeeId, q.month);
  }

  /** Coach : historique des salaires versés + salaires à venir (mois en cours et suivant). */
  @Get('mine')
  @Roles(Role.COACH, Role.ADMIN)
  async mine(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.salary.findMany({ where: { employeeId: user.id }, include, orderBy: { month: 'desc' } });
    const now = todayIso().slice(0, 7);
    const [y, m] = now.split('-').map(Number);
    const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
    const recorded = new Set(rows.map((r) => r.month));
    const upcoming = await Promise.all(
      [now, next].filter((month) => !recorded.has(month)).map((month) => this.salaries.estimate(user.id, month)),
    );
    return {
      paid: rows.filter((r) => r.paidAt).map(view),
      pending: rows.filter((r) => !r.paidAt).map(view),
      upcoming,
    };
  }

  @Post()
  @Perm('salaries.manage')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateSalaryDto) {
    const employee = await this.prisma.user.findUnique({ where: { id: dto.employeeId } });
    if (!employee || !employeeType(employee)) throw notFound('Employé');
    if (await this.prisma.salary.findUnique({ where: { employeeId_month: { employeeId: dto.employeeId, month: dto.month } } })) {
      throw new BadRequestException(`Le salaire de ${dto.month} est déjà saisi pour cet employé.`);
    }
    const est = await this.salaries.estimate(dto.employeeId, dto.month);
    const hours = dto.hours ?? est.hours;
    const amount = dto.amount ?? (dto.hours !== undefined && employee.payMode === 'HOURLY' ? dto.hours * est.payRate : est.amount);
    const season = await this.prisma.season.findFirst({ where: { status: 'ACTIVE', archivedAt: null } });
    const salary = await this.prisma.salary.create({
      data: {
        employeeId: dto.employeeId,
        seasonId: season?.id ?? null,
        month: dto.month,
        hours,
        absences: est.absentSessions,
        amount,
        note: dto.note?.trim() || null,
      },
      include,
    });
    await this.audit.log(user.id, {
      action: 'Salaire saisi',
      entity: 'Salary',
      entityId: salary.id,
      target: `${fullName(employee).trim()} · ${dto.month}`,
      after: `${dt(amount)}${hours !== null && hours !== undefined ? ` (${hours} h)` : ''}`,
    });
    return view(salary);
  }

  /** R6 : modifiable sur saison en cours ou à venir ; sur saison clôturée, motif obligatoire. */
  @Patch(':id')
  @Perm('salaries.manage')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSalaryDto) {
    const salary = await this.find(id);
    assertVersion(salary, dto.version, 'Ce salaire');
    if (salary.paidAt) throw rule.conflict('R6', 'Salaire déjà versé : il ne peut plus être modifié.');
    const reason = dto.reason?.trim() || null;
    if (salary.season && LOCKED_SEASON.includes(salary.season.status) && !reason) {
      throw rule.bad('R6', `Saison ${salary.season.label} clôturée : motif obligatoire.`);
    }
    const updated = await this.prisma.salary.update({
      where: { id },
      data: { amount: dto.amount, version: { increment: 1 } },
      include,
    });
    await this.audit.log(user.id, {
      action: 'Salaire modifié',
      entity: 'Salary',
      entityId: id,
      target: `${fullName(salary.employee).trim()} · ${salary.month}`,
      before: dt(salary.amount),
      after: dt(updated.amount),
      reason,
    });
    return view(updated);
  }

  @Post(':id/pay')
  @HttpCode(200)
  @Perm('salaries.manage')
  async pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const salary = await this.find(id);
    if (salary.paidAt) throw rule.conflict('R6', 'Ce salaire est déjà marqué versé.');
    const updated = await this.prisma.salary.update({
      where: { id },
      data: { paidAt: dayFromIso(todayIso()), version: { increment: 1 } },
      include,
    });
    await this.audit.log(user.id, {
      action: 'Salaire marqué versé',
      entity: 'Salary',
      entityId: id,
      target: `${fullName(salary.employee).trim()} · ${salary.month}`,
      before: 'À verser',
      after: 'Versé',
    });
    if (salary.employee.email) {
      await this.mail.send(
        salary.employee.email,
        `Votre salaire (${salary.month}) est versé`,
        `Bonjour ${salary.employee.firstName},\n\nVotre salaire de ${salary.month} (${dt(salary.amount)}) a été versé.\n\nLe bureau du TCSAY`,
        'SALARY',
      );
    }
    return view(updated);
  }

  private typeWhere(type?: EmployeeType): Prisma.UserWhereInput {
    if (type) return { roles: { has: type as Role } };
    return { roles: { hasSome: EMPLOYEE_TYPES.map((t) => t as Role) } };
  }

  private async find(id: string) {
    const salary = await this.prisma.salary.findUnique({ where: { id }, include });
    if (!salary) throw notFound('Salaire');
    return salary;
  }
}

export function view(s: Row) {
  return {
    id: s.id,
    month: s.month,
    hours: s.hours === null ? null : num(s.hours),
    absences: s.absences,
    amount: num(s.amount),
    paidAt: s.paidAt,
    paid: Boolean(s.paidAt),
    note: s.note,
    version: s.version,
    employee: {
      id: s.employee.id,
      firstName: s.employee.firstName,
      lastName: s.employee.lastName,
      type: employeeType(s.employee),
      color: s.employee.coach?.color ?? null,
    },
    season: s.season,
  };
}
