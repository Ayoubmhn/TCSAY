import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm, Roles } from '../auth/auth-user';
import { ageAtYearEnd } from '../common/dates';
import { assertVersion, fullName, notFound, rule } from '../common/rules';
import { slotInclude, slotView } from '../groups/groups.controller';
import { PrismaService } from '../prisma/prisma.service';

class CreateParentDto {
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

  @IsString()
  @IsNotEmpty({ message: 'Téléphone obligatoire.' })
  @MaxLength(30)
  phone: string;

  @Matches(/^[0-9A-Za-z]{6,12}$/, { message: 'CIN obligatoire (6 à 12 caractères).' })
  cin: string;
}

class UpdateParentDto {
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
  @Matches(/^[0-9A-Za-z]{6,12}$/, { message: 'CIN invalide (6 à 12 caractères).' })
  cin?: string;

  /** Nouvel email : devient l'identifiant, un nouveau mot de passe temporaire y est envoyé. */
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_o, v) => v !== null)
  @IsEmail({}, { message: 'Email invalide.' })
  email?: string | null;
}

class LinkDto {
  @IsUUID()
  playerId: string;
}

@ApiTags('Parents')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('parents')
export class ParentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const parents = await this.prisma.user.findMany({
      where: { roles: { has: Role.PARENT } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
        parentLinks: {
          where: { player: { archivedAt: null } },
          include: { player: { select: { id: true, firstName: true, lastName: true, memberCode: true } } },
        },
      },
    });
    return parents.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email,
      phone: p.phone,
      cin: p.cin,
      isActive: p.isActive && p.roles.includes(Role.PARENT),
      otherRoles: p.roles.filter((r) => r !== Role.PARENT),
      version: p.version,
      players: p.parentLinks.map((l) => l.player),
    }));
  }

  @Post()
  @Perm('parents.manage', 'players.manage')
  async create(@CurrentUser() actor: AuthUser, @Body() dto: CreateParentDto) {
    const { user, password } = await this.prisma.$transaction(async (tx) => {
      const created = await this.accounts.create(tx, { ...dto, role: Role.PARENT });
      await this.audit.log(
        actor.id,
        { action: 'Parent créé', entity: 'User', entityId: created.user.id, target: fullName(created.user) },
        tx,
      );
      return created;
    });
    return { id: user.id, ...(await this.accounts.sendCredentials(user, password, Role.PARENT)) };
  }

  @Patch(':id')
  @Perm('parents.manage', 'players.manage')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateParentDto) {
    const parent = await this.find(id);
    assertVersion(parent, dto.version, 'Ce parent');
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
        phone: dto.phone?.trim(),
        cin: dto.cin?.trim(),
        version: { increment: 1 },
      },
    });
    const credentials = await this.accounts.changeEmail(actor.id, id, dto.email);
    await this.audit.log(actor.id, {
      action: 'Parent modifié',
      entity: 'User',
      entityId: id,
      target: fullName(updated),
      before: `${fullName(parent)} · ${parent.phone ?? '—'}`,
      after: `${fullName(updated)} · ${updated.phone ?? '—'}`,
    });
    return { ok: true, credentials };
  }

  /** Profil d'un parent : informations, enfants et leurs groupes (créneaux). */
  @Get(':id/profile')
  @Perm('parents.manage', 'players.manage', 'payments.collect')
  async profile(@Param('id', ParseUUIDPipe) id: string) {
    const parent = await this.find(id);
    const season = await this.access.activeSeason().catch(() => null);
    const links = await this.prisma.parentLink.findMany({
      where: { parentId: id },
      include: {
        player: {
          include: {
            enrollments: {
              where: { seasonId: season?.id },
              include: {
                category: { select: { name: true } },
                groups: { include: { group: { include: { slots: { include: slotInclude, orderBy: [{ day: 'asc' }, { startTime: 'asc' }] } } } } },
              },
            },
          },
        },
      },
    });
    return {
      id: parent.id,
      firstName: parent.firstName,
      lastName: parent.lastName,
      email: parent.email,
      phone: parent.phone,
      cin: parent.cin,
      isActive: parent.isActive,
      version: parent.version,
      children: links.map(({ player: p }) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        birthDate: p.birthDate,
        archivedAt: p.archivedAt,
        category: p.enrollments[0]?.category.name ?? null,
        groups: (p.enrollments[0]?.groups ?? [])
          .filter((g) => !g.group.archivedAt)
          .map((g) => ({ id: g.group.id, name: g.group.name, slots: g.group.slots.map(slotView) })),
      })),
    };
  }

  @Post(':id/links')
  @Perm('parents.manage', 'players.manage')
  async link(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkDto) {
    const parent = await this.find(id);
    const player = await this.prisma.player.findUnique({ where: { id: dto.playerId } });
    if (!player || player.archivedAt) throw notFound('Joueur');
    await this.prisma.parentLink.upsert({
      where: { parentId_playerId: { parentId: id, playerId: player.id } },
      create: { parentId: id, playerId: player.id },
      update: {},
    });
    await this.audit.log(actor.id, {
      action: 'Joueur lié à un parent',
      entity: 'ParentLink',
      entityId: `${id}|${player.id}`,
      target: `${fullName(parent)} → ${fullName(player)}`,
    });
    return { ok: true };
  }

  /** R9 : un mineur garde toujours au moins un parent lié. */
  @Delete(':id/links/:playerId')
  @Perm('parents.manage', 'players.manage')
  async unlink(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('playerId', ParseUUIDPipe) playerId: string,
  ) {
    const parent = await this.find(id);
    const player = await this.prisma.player.findUnique({ where: { id: playerId }, include: { parentLinks: true } });
    if (!player) throw notFound('Joueur');
    if (!player.parentLinks.some((l) => l.parentId === id)) throw notFound('Lien');
    const season = await this.access.activeSeason().catch(() => null);
    const year = season?.startDate.getUTCFullYear() ?? new Date().getFullYear();
    // Date inconnue (import) : considéré comme mineur.
    const minor = !player.birthDate || ageAtYearEnd(player.birthDate, year) < 18;
    if (minor && player.parentLinks.length <= 1) {
      throw rule.conflict('R9', `${player.firstName} est mineur : il doit garder au moins un parent lié.`);
    }
    await this.prisma.parentLink.delete({ where: { parentId_playerId: { parentId: id, playerId } } });
    await this.audit.log(actor.id, {
      action: 'Lien parent retiré',
      entity: 'ParentLink',
      entityId: `${id}|${playerId}`,
      target: `${fullName(parent)} → ${fullName(player)}`,
    });
    return { ok: true };
  }

  /**
   * Suppression définitive d'un compte parent sans historique (ex. parent créé par erreur ou en double à l'import).
   * Refusée si le compte a d'autres rôles ou un historique (paiements, réservations, reçus, actions…) : R8, on le désactive.
   * R9 : chaque mineur lié doit garder un autre parent.
   */
  @Delete(':id')
  @Perm('parents.manage', 'players.manage')
  async remove(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const parent = await this.find(id);
    if (parent.roles.some((r) => r !== Role.PARENT)) {
      throw rule.conflict('R8', `${fullName(parent)} a d’autres rôles : retirez le rôle parent (désactivation) au lieu de supprimer le compte.`);
    }
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: {
        _count: {
          select: {
            auditLogs: true,
            reservations: true,
            cancellations: true,
            payments: true,
            receiptsIssued: true,
            receiptsVoided: true,
            attendances: true,
            salaries: true,
            absenceDecisions: true,
            broadcastsSent: true,
          },
        },
        player: { select: { id: true } },
        coach: { select: { id: true } },
        parentLinks: { include: { player: { include: { parentLinks: true } } } },
      },
    });
    const history = Object.values(u._count).reduce((t, n) => t + n, 0);
    if (history || u.player || u.coach) {
      throw rule.conflict('R8', `${fullName(parent)} a un historique dans l’application : le compte ne peut pas être supprimé, désactivez-le.`);
    }
    const season = await this.access.activeSeason().catch(() => null);
    const year = season?.startDate.getUTCFullYear() ?? new Date().getFullYear();
    const orphans = u.parentLinks
      .map((l) => l.player)
      .filter((p) => !p.archivedAt && (!p.birthDate || ageAtYearEnd(p.birthDate, year) < 18) && p.parentLinks.length <= 1);
    if (orphans.length) {
      throw rule.conflict(
        'R9',
        `${orphans.map((p) => fullName(p)).join(', ')} ${orphans.length > 1 ? 'sont mineurs' : 'est mineur'} : liez un autre parent avant de supprimer ${fullName(parent)}.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.parentLink.deleteMany({ where: { parentId: id } });
      await tx.notification.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
      await this.audit.log(
        actor.id,
        {
          action: 'Parent supprimé',
          entity: 'User',
          entityId: id,
          target: fullName(parent),
          before: `${parent.email ?? parent.cin ?? '—'} · ${u.parentLinks.map((l) => fullName(l.player)).join(', ') || 'aucun joueur'}`,
          after: 'Supprimé',
        },
        tx,
      );
    });
    return { ok: true };
  }

  @Post(':id/deactivate')
  @Perm('parents.manage', 'players.manage')
  async deactivate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.find(id);
    return this.accounts.setRoleActive(actor.id, id, Role.PARENT, false);
  }

  @Post(':id/activate')
  @Perm('parents.manage', 'players.manage')
  async activate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.find(id);
    return this.accounts.setRoleActive(actor.id, id, Role.PARENT, true);
  }

  private async find(id: string) {
    const parent = await this.prisma.user.findUnique({ where: { id } });
    if (!parent) throw notFound('Parent');
    if (!parent.roles.includes(Role.PARENT) && !(await this.prisma.parentLink.count({ where: { parentId: id } }))) throw notFound('Parent');
    return parent;
  }
}
