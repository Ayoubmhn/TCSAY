import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PayMode, Role, StaffPosition } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { dt, num } from '../common/money';
import { assertVersion, fullName, notFound } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';
import { view as salaryView } from '../salaries/salaries.controller';

const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);

export const POSITION_LABEL: Record<StaffPosition, string> = {
  ADMIN_AGENT: 'Agent administratif',
  TECHNICAL_DIRECTOR: 'Directeur technique',
};

class StaffFields {
  @IsString()
  @IsNotEmpty({ message: 'Prénom obligatoire.' })
  @MaxLength(60)
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Nom obligatoire.' })
  @MaxLength(60)
  lastName: string;

  @IsString()
  @Matches(/^[0-9A-Za-z]{6,12}$/, { message: 'CIN obligatoire (6 à 12 caractères).' })
  cin: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsEnum(StaffPosition, { message: 'Fonction obligatoire.' })
  position: StaffPosition;

  @IsEnum(PayMode)
  payMode: PayMode;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  payRate: number;
}

class CreateStaffDto extends StaffFields {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail({}, { message: 'Email invalide.' })
  email?: string;
}

class UpdateStaffDto extends StaffFields {
  @IsInt()
  @Min(1)
  version: number;
}

/** Personnel du club (agents administratifs, directeur technique…) : fonctions à compléter par le club. */
@ApiTags('Personnel')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('staff')
export class StaffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const users = await this.prisma.user.findMany({ where: { role: Role.STAFF }, orderBy: [{ position: 'asc' }, { firstName: 'asc' }] });
    return users.map(view);
  }

  @Get(':id/profile')
  async profile(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.find(id);
    const salaries = await this.prisma.salary.findMany({
      where: { employeeId: id },
      include: { employee: { select: { id: true, firstName: true, lastName: true, email: true, role: true, position: true, coach: { select: { id: true, color: true } } } }, season: { select: { id: true, label: true, status: true } } },
      orderBy: { month: 'desc' },
    });
    return { ...view(user), salaries: salaries.map(salaryView) };
  }

  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() dto: CreateStaffDto) {
    const { user, password } = await this.prisma.$transaction(async (tx) => {
      const created = await this.accounts.create(tx, { ...dto, role: Role.STAFF });
      await this.audit.log(
        actor.id,
        { action: 'Personnel créé', entity: 'User', entityId: created.user.id, target: fullName(created.user), after: POSITION_LABEL[dto.position] },
        tx,
      );
      return created;
    });
    return { id: user.id, ...(await this.accounts.sendCredentials(user, password)) };
  }

  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto) {
    const user = await this.find(id);
    assertVersion(user, dto.version, 'Ce compte');
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        cin: dto.cin.trim(),
        phone: dto.phone?.trim() || null,
        position: dto.position,
        payMode: dto.payMode,
        payRate: dto.payRate,
        version: { increment: 1 },
      },
    });
    await this.audit.log(actor.id, {
      action: 'Personnel modifié',
      entity: 'User',
      entityId: id,
      target: fullName(updated),
      before: `${user.position ? POSITION_LABEL[user.position] : '—'} · ${dt(num(user.payRate))}`,
      after: `${POSITION_LABEL[dto.position]} · ${dt(dto.payRate)}`,
    });
    return view(updated);
  }

  @Post(':id/deactivate')
  async deactivate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.find(id);
    return this.accounts.setActive(actor.id, id, false);
  }

  @Post(':id/activate')
  async activate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.find(id);
    return this.accounts.setActive(actor.id, id, true);
  }

  private async find(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.role !== Role.STAFF) throw notFound('Membre du personnel');
    return user;
  }
}

function view(u: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  cin: string | null;
  position: StaffPosition | null;
  payMode: PayMode | null;
  payRate: { toNumber(): number } | null;
  isActive: boolean;
  version: number;
}) {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone,
    cin: u.cin,
    position: u.position,
    positionLabel: u.position ? POSITION_LABEL[u.position] : null,
    payMode: u.payMode,
    payRate: num(u.payRate as never),
    isActive: u.isActive,
    version: u.version,
  };
}
