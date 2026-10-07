import { NIL_UUID } from '../common/rules';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { assertVersion, fullName, notFound } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';

class CreateCoachDto {
  @IsString()
  @IsNotEmpty({ message: 'Prénom obligatoire.' })
  @MaxLength(60)
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Nom obligatoire.' })
  @MaxLength(60)
  lastName: string;

  @IsEmail({}, { message: 'Email invalide.' })
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  payMode?: string;
}

class UpdateCoachDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  payMode?: string;
}

@ApiTags('Entraîneurs')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('coaches')
export class CoachesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const season = await this.prisma.season.findFirst({ where: { status: 'ACTIVE', archivedAt: null } });
    const coaches = await this.prisma.coach.findMany({
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, isActive: true } },
        groups: {
          where: { seasonId: season?.id ?? NIL_UUID, archivedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { user: { lastName: 'asc' } },
    });
    return coaches.map((c) => ({
      id: c.id,
      userId: c.user.id,
      firstName: c.user.firstName,
      lastName: c.user.lastName,
      email: c.user.email,
      phone: c.user.phone,
      isActive: c.user.isActive,
      payMode: c.payMode,
      version: c.version,
      groups: c.groups,
    }));
  }

  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() dto: CreateCoachDto) {
    const { coach, user, password } = await this.prisma.$transaction(async (tx) => {
      const { user, password } = await this.accounts.create(tx, { ...dto, role: Role.COACH });
      const coach = await tx.coach.create({ data: { userId: user.id, payMode: dto.payMode?.trim() || null } });
      await this.audit.log(actor.id, { action: 'Entraîneur créé', entity: 'Coach', entityId: coach.id, target: fullName(user) }, tx);
      return { coach, user, password };
    });
    await this.accounts.sendCredentials(user, password);
    return { ...coach, email: user.email };
  }

  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCoachDto) {
    const coach = await this.prisma.coach.findUnique({ where: { id }, include: { user: true } });
    if (!coach) throw notFound('Entraîneur');
    assertVersion(coach, dto.version, 'Cet entraîneur');
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: coach.userId },
        data: { firstName: dto.firstName?.trim(), lastName: dto.lastName?.trim(), phone: dto.phone?.trim() },
      }),
      this.prisma.coach.update({ where: { id }, data: { payMode: dto.payMode?.trim(), version: { increment: 1 } } }),
    ]);
    await this.audit.log(actor.id, {
      action: 'Entraîneur modifié',
      entity: 'Coach',
      entityId: id,
      target: fullName(coach.user),
      before: `${fullName(coach.user)} · ${coach.user.phone ?? '—'} · ${coach.payMode ?? '—'}`,
      after: `${dto.firstName ?? coach.user.firstName} ${dto.lastName ?? coach.user.lastName} · ${dto.phone ?? coach.user.phone ?? '—'} · ${dto.payMode ?? coach.payMode ?? '—'}`,
    });
    return { ok: true };
  }

  @Post(':id/deactivate')
  async deactivate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const coach = await this.prisma.coach.findUnique({ where: { id } });
    if (!coach) throw notFound('Entraîneur');
    return this.accounts.setActive(actor.id, coach.userId, false);
  }

  @Post(':id/activate')
  async activate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const coach = await this.prisma.coach.findUnique({ where: { id } });
    if (!coach) throw notFound('Entraîneur');
    return this.accounts.setActive(actor.id, coach.userId, true);
  }
}
