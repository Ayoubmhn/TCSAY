import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PayMode, Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm, Roles } from '../auth/auth-user';
import { isoDay, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { assertVersion, fullName, notFound } from '../common/rules';
import { slotInclude, slotView } from '../groups/groups.controller';
import { PrismaService } from '../prisma/prisma.service';
import { view as salaryView } from '../salaries/salaries.controller';
import { SalariesService } from '../salaries/salaries.service';

const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);
const COLOR = /^#[0-9a-fA-F]{6}$/;

class CoachFields {
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

  @IsEnum(PayMode, { message: 'Rémunération : à l’heure ou au mois.' })
  payMode: PayMode;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Taux de rémunération invalide.' })
  @Min(0)
  payRate: number;

  @IsOptional()
  @Matches(COLOR, { message: 'Couleur au format #RRGGBB.' })
  color?: string;
}

class CreateCoachDto extends CoachFields {
  /** Facultatif : sans email, l'identifiant est la CIN et le mot de passe est remis en main propre. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail({}, { message: 'Email invalide.' })
  email?: string;
}

class UpdateCoachDto extends CoachFields {
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

const COLORS = ['#00b050', '#ed7d31', '#00b0f0', '#ff00ff', '#ffd966', '#7030a0', '#c00000', '#4472c4'];

@ApiTags('Entraîneurs')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('coaches')
export class CoachesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly salaries: SalariesService,
  ) {}

  @Get()
  async list() {
    const season = await this.prisma.season.findFirst({ where: { status: 'ACTIVE', archivedAt: null } });
    const coaches = await this.prisma.coach.findMany({
      include: {
        user: true,
        slots: { where: { slot: { group: { seasonId: season?.id, archivedAt: null } } }, include: { slot: { include: { group: { select: { id: true, name: true } } } } } },
      },
      orderBy: { user: { firstName: 'asc' } },
    });
    return coaches.map((c) => {
      const groups = new Map<string, { id: string; name: string }>();
      for (const s of c.slots) groups.set(s.slot.group.id, s.slot.group);
      return { ...this.base(c), groups: [...groups.values()], sessionsPerWeek: c.slots.length };
    });
  }

  /** Profil d'un entraîneur : infos, groupes et créneaux, salaires (historique et à venir), absences. */
  @Get(':id/profile')
  @Perm('coaches.manage', 'salaries.manage', 'groups.manage', 'absences.manage')
  async profile(@Param('id', ParseUUIDPipe) id: string) {
    const coach = await this.prisma.coach.findUnique({ where: { id }, include: { user: true } });
    if (!coach) throw notFound('Entraîneur');
    const season = await this.access.activeSeason().catch(() => null);
    const [slots, salaries, absences] = await Promise.all([
      this.prisma.groupSlot.findMany({
        where: { coaches: { some: { coachId: id } }, group: { seasonId: season?.id, archivedAt: null } },
        include: { ...slotInclude, group: { select: { id: true, name: true } } },
        orderBy: [{ day: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.salary.findMany({
        where: { employeeId: coach.userId },
        include: { employee: { select: { id: true, firstName: true, lastName: true, email: true, roles: true, coach: { select: { id: true, color: true } } } }, season: { select: { id: true, label: true, status: true } } },
        orderBy: { month: 'desc' },
      }),
      this.prisma.coachAbsence.findMany({
        where: { coachId: id },
        include: { slot: { select: { startTime: true, group: { select: { name: true } } } } },
        orderBy: { date: 'desc' },
        take: 50,
      }),
    ]);
    const month = todayIso().slice(0, 7);
    return {
      ...this.base(coach),
      slots: slots.map((s) => ({ ...slotView(s), group: s.group })),
      salaries: salaries.map(salaryView),
      estimate: await this.salaries.estimate(coach.userId, month),
      absences: absences.map((a) => ({
        id: a.id,
        date: isoDay(a.date),
        reason: a.reason,
        status: a.status,
        slot: a.slot ? { startTime: a.slot.startTime, group: a.slot.group.name } : null,
      })),
    };
  }

  @Post()
  @Perm('coaches.manage')
  async create(@CurrentUser() actor: AuthUser, @Body() dto: CreateCoachDto) {
    const count = await this.prisma.coach.count();
    const { coach, user, password } = await this.prisma.$transaction(async (tx) => {
      const { user, password } = await this.accounts.create(tx, {
        email: dto.email,
        cin: dto.cin,
        role: Role.COACH,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        payMode: dto.payMode,
        payRate: dto.payRate,
      });
      // Compte existant (ex. directeur technique) : sa fiche entraîneur est créée ou réutilisée.
      const coach =
        (await tx.coach.findUnique({ where: { userId: user.id } })) ??
        (await tx.coach.create({ data: { userId: user.id, color: dto.color ?? COLORS[count % COLORS.length] } }));
      await this.audit.log(
        actor.id,
        {
          action: 'Entraîneur créé',
          entity: 'Coach',
          entityId: coach.id,
          target: fullName(user),
          after: `${dto.payMode === 'HOURLY' ? 'À l’heure' : 'Au mois'} : ${dt(dto.payRate)}`,
        },
        tx,
      );
      return { coach, user, password };
    });
    const credentials = await this.accounts.sendCredentials(user, password, Role.COACH);
    return { id: coach.id, ...credentials };
  }

  /** Modification, y compris la condition de rémunération (à l'heure / au mois, taux) propre à chaque entraîneur. */
  @Patch(':id')
  @Perm('coaches.manage')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCoachDto) {
    const coach = await this.prisma.coach.findUnique({ where: { id }, include: { user: true } });
    if (!coach) throw notFound('Entraîneur');
    assertVersion(coach, dto.version, 'Cet entraîneur');
    const before = `${fullName(coach.user)} · CIN ${coach.user.cin ?? '—'} · ${payLabel(coach.user.payMode, num(coach.user.payRate))}`;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: coach.userId },
        data: {
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          cin: dto.cin.trim(),
          phone: dto.phone?.trim() || null,
          payMode: dto.payMode,
          payRate: dto.payRate,
          version: { increment: 1 },
        },
      }),
      this.prisma.coach.update({ where: { id }, data: { color: dto.color ?? coach.color, version: { increment: 1 } } }),
    ]);
    const credentials = await this.accounts.changeEmail(actor.id, coach.userId, dto.email);
    await this.audit.log(actor.id, {
      action: 'Entraîneur modifié',
      entity: 'Coach',
      entityId: id,
      target: `${dto.firstName} ${dto.lastName}`,
      before,
      after: `${dto.firstName} ${dto.lastName} · CIN ${dto.cin} · ${payLabel(dto.payMode, dto.payRate)}`,
    });
    return { ok: true, credentials };
  }

  @Post(':id/deactivate')
  @Perm('coaches.manage')
  async deactivate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const coach = await this.prisma.coach.findUnique({ where: { id } });
    if (!coach) throw notFound('Entraîneur');
    return this.accounts.setRoleActive(actor.id, coach.userId, Role.COACH, false);
  }

  @Post(':id/activate')
  @Perm('coaches.manage')
  async activate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const coach = await this.prisma.coach.findUnique({ where: { id } });
    if (!coach) throw notFound('Entraîneur');
    return this.accounts.setRoleActive(actor.id, coach.userId, Role.COACH, true);
  }

  private base(c: { id: string; color: string; version: number; user: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; cin: string | null; isActive: boolean; roles: Role[]; payMode: PayMode | null; payRate: { toNumber(): number } | null } }) {
    return {
      id: c.id,
      userId: c.user.id,
      firstName: c.user.firstName,
      lastName: c.user.lastName,
      email: c.user.email,
      phone: c.user.phone,
      cin: c.user.cin,
      isActive: c.user.isActive && c.user.roles.includes(Role.COACH),
      otherRoles: c.user.roles.filter((r) => r !== Role.COACH),
      color: c.color,
      payMode: c.user.payMode,
      payRate: num(c.user.payRate as never),
      version: c.version,
    };
  }
}

function payLabel(mode: PayMode | null, rate: number): string {
  return mode === 'HOURLY' ? `${dt(rate)} / heure` : mode === 'MONTHLY' ? `${dt(rate)} / mois` : '—';
}
