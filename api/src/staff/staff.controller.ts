import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PayMode, Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsEmail, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { dt, num } from '../common/money';
import { assertVersion, fullName, notFound } from '../common/rules';
import { ROLE_LABEL } from '../permissions/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { view as salaryView } from '../salaries/salaries.controller';

const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);

/** Fonctions du personnel administratif (le rôle de président s'attribue dans « Autorisations »). */
export const STAFF_FUNCTIONS = [Role.ADMIN_AGENT, Role.SUPERVISOR, Role.TECH_DIRECTOR] as const;
const STAFF_SCOPE: Role[] = [Role.PRESIDENT, ...STAFF_FUNCTIONS];

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

  /** Une ou plusieurs fonctions : agent administratif, agent superviseur, directeur technique. */
  @IsArray()
  @ArrayNotEmpty({ message: 'Choisissez au moins une fonction.' })
  @IsIn(STAFF_FUNCTIONS, { each: true, message: 'Fonction inconnue.' })
  functions: Role[];

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

  /** Nouvel email : devient l'identifiant, un nouveau mot de passe temporaire y est envoyé. */
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_o, v) => v !== null)
  @IsEmail({}, { message: 'Email invalide.' })
  email?: string | null;
}

const functionsLabel = (roles: Role[]) =>
  roles
    .filter((r) => STAFF_SCOPE.includes(r))
    .map((r) => ROLE_LABEL[r])
    .join(', ');

/** Personnel du club : président, agents administratifs, agent superviseur, directeur technique. */
@ApiTags('Personnel')
@ApiBearerAuth()
@Perm('staff.manage')
@Controller('staff')
export class StaffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const users = await this.prisma.user.findMany({
      where: { roles: { hasSome: STAFF_SCOPE } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return users.map(view);
  }

  @Get(':id/profile')
  async profile(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.find(id);
    const salaries = await this.prisma.salary.findMany({
      where: { employeeId: id },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, email: true, roles: true, coach: { select: { id: true, color: true } } } },
        season: { select: { id: true, label: true, status: true } },
      },
      orderBy: { month: 'desc' },
    });
    return { ...view(user), salaries: salaries.map(salaryView) };
  }

  /** Création ; si la personne a déjà un compte (même email ou CIN, ex. un entraîneur), les fonctions lui sont ajoutées. */
  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() dto: CreateStaffDto) {
    const [first, ...others] = dto.functions;
    const { user, password } = await this.prisma.$transaction(async (tx) => {
      const created = await this.accounts.create(tx, {
        email: dto.email,
        cin: dto.cin,
        role: first,
        extraRoles: others,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        payMode: dto.payMode,
        payRate: dto.payRate,
      });
      await this.audit.log(
        actor.id,
        { action: 'Personnel créé', entity: 'User', entityId: created.user.id, target: fullName(created.user), after: functionsLabel(dto.functions) },
        tx,
      );
      return created;
    });
    return { id: user.id, ...(await this.accounts.sendCredentials(user, password, first)) };
  }

  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto) {
    const user = await this.find(id);
    assertVersion(user, dto.version, 'Ce compte');
    // Les fonctions du personnel sont remplacées ; les autres rôles (président, entraîneur, joueur, parent) sont conservés.
    const roles = [...user.roles.filter((r) => !(STAFF_FUNCTIONS as readonly Role[]).includes(r)), ...dto.functions];
    if (!roles.length) throw new BadRequestException('Choisissez au moins une fonction.');
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        cin: dto.cin.trim(),
        phone: dto.phone?.trim() || null,
        roles: [...new Set(roles)],
        payMode: dto.payMode,
        payRate: dto.payRate,
        version: { increment: 1 },
      },
    });
    const credentials = await this.accounts.changeEmail(actor.id, id, dto.email);
    await this.audit.log(actor.id, {
      action: 'Personnel modifié',
      entity: 'User',
      entityId: id,
      target: fullName(updated),
      before: `${functionsLabel(user.roles) || '—'} · ${dt(num(user.payRate))}`,
      after: `${functionsLabel(updated.roles)} · ${dt(dto.payRate)}`,
    });
    return { ...view(await this.find(id)), credentials };
  }

  @Post(':id/deactivate')
  async deactivate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.find(id);
    return view(await this.accounts.setActive(actor.id, id, false));
  }

  @Post(':id/activate')
  async activate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.find(id);
    return view(await this.accounts.setActive(actor.id, id, true));
  }

  private async find(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.roles.some((r) => STAFF_SCOPE.includes(r))) throw notFound('Membre du personnel');
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
  roles: Role[];
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
    roles: u.roles,
    functions: u.roles.filter((r) => (STAFF_FUNCTIONS as readonly Role[]).includes(r)),
    functionsLabel: functionsLabel(u.roles),
    payMode: u.payMode,
    payRate: num(u.payRate as never),
    isActive: u.isActive,
    version: u.version,
  };
}
