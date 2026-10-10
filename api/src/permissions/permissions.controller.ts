import { BadRequestException, Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Gender, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { assertVersion, notFound, rule } from '../common/rules';
import { PlayersService } from '../players/players.service';
import { PrismaService } from '../prisma/prisma.service';
import { EDITABLE_ROLES, PERMISSION_KEYS, PERMISSIONS, ROLE_LABEL } from './permissions';
import { PermissionsService } from './permissions.service';

/** Rôles attribuables à un compte depuis ce module (joueur : via la fiche joueur, qui crée son dossier). */
const ASSIGNABLE: Role[] = [Role.PRESIDENT, Role.ADMIN_AGENT, Role.SUPERVISOR, Role.TECH_DIRECTOR, Role.COACH, Role.PARENT, Role.PLAYER];
const COLORS = ['#00b050', '#ed7d31', '#00b0f0', '#ff00ff', '#ffd966', '#7030a0', '#c00000', '#4472c4'];

class SetPermissionsDto {
  @IsArray()
  @IsIn(PERMISSION_KEYS, { each: true, message: 'Autorisation inconnue.' })
  permissions: string[];
}

class NewPlayerDto {
  @IsIn([Gender.M, Gender.F], { message: 'Genre obligatoire.' })
  gender: Gender;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date de naissance obligatoire (AAAA-MM-JJ).' })
  birthDate: string;
}

class SetRolesDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsArray()
  @IsIn(ASSIGNABLE, { each: true, message: 'Rôle inconnu.' })
  roles: Role[];

  /** Rôle joueur pour un compte sans fiche joueur : genre et naissance pour créer la fiche (catégorie proposée). */
  @IsOptional()
  @ValidateNested()
  @Type(() => NewPlayerDto)
  player?: NewPlayerDto;
}

class UsersQuery {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}

const label = (roles: Role[]) => roles.map((r) => ROLE_LABEL[r]).join(', ') || 'aucun';

/** Module « Autorisations » du président : droits de chaque rôle et rôles de chaque compte (R12). */
@ApiTags('Autorisations')
@ApiBearerAuth()
@Perm('permissions.manage')
@Controller('permissions')
export class PermissionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly players: PlayersService,
  ) {}

  @Get()
  async overview() {
    return {
      catalog: PERMISSIONS,
      roles: EDITABLE_ROLES.map((r) => ({ role: r, label: ROLE_LABEL[r] })),
      matrix: await this.permissions.matrix(),
    };
  }

  @Put('roles/:role')
  async setRole(
    @CurrentUser() actor: AuthUser,
    @Param('role', new ParseEnumPipe(Role)) role: Role,
    @Body() dto: SetPermissionsDto,
  ) {
    if (!EDITABLE_ROLES.includes(role)) throw new BadRequestException('Le président a toujours tous les droits.');
    const before = (await this.permissions.matrix())[role] ?? [];
    const after = [...new Set(dto.permissions)].sort();
    await this.permissions.set(role, after);
    const name = (k: string) => PERMISSIONS.find((p) => p.key === k)?.label ?? k;
    await this.audit.log(actor.id, {
      action: 'Autorisations modifiées',
      entity: 'RolePermission',
      entityId: role,
      target: ROLE_LABEL[role],
      before: before.map(name).join(', ') || 'aucune',
      after: after.map(name).join(', ') || 'aucune',
    });
    return { role, permissions: after };
  }

  /** Comptes et leurs rôles (recherche par nom, email ou CIN). */
  @Get('users')
  async users(@Query() q: UsersQuery) {
    const term = q.q?.trim();
    const users = await this.prisma.user.findMany({
      where: {
        // Comptes retirés (parent supprimé mais conservé pour le journal d'audit) : masqués.
        NOT: { roles: { isEmpty: true }, isActive: false },
        ...(term
          ? {
              OR: [
                { firstName: { contains: term, mode: 'insensitive' as const } },
                { lastName: { contains: term, mode: 'insensitive' as const } },
                { email: { contains: term, mode: 'insensitive' as const } },
                { cin: { contains: term } },
              ],
            }
          : {}),
      },
      include: { player: { select: { id: true } }, coach: { select: { id: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 200,
    });
    return users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      cin: u.cin,
      isActive: u.isActive,
      roles: u.roles.filter((r) => ASSIGNABLE.includes(r)),
      hasPlayer: Boolean(u.player),
      version: u.version,
    }));
  }

  /**
   * Rôles d'un compte. Entraîneur : sa fiche (couleur au planning) est créée si besoin.
   * Joueur : seulement si un dossier joueur est lié (créé depuis la fiche joueur). R12 : toujours un président actif.
   */
  @Put('users/:id')
  async setUserRoles(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolesDto) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { player: true, coach: true } });
    if (!user) throw notFound('Compte');
    assertVersion(user, dto.version, 'Ce compte');
    const roles = [...new Set(dto.roles)];
    if (!roles.length) throw new BadRequestException('Un compte garde au moins un rôle (sinon : désactivez-le).');
    if (roles.includes(Role.PLAYER) && !user.player && !dto.player) {
      throw new BadRequestException('Rôle joueur : indiquez le genre et la date de naissance pour créer sa fiche joueur.');
    }
    if (user.roles.includes(Role.PRESIDENT) && !roles.includes(Role.PRESIDENT)) {
      const presidents = await this.prisma.user.count({ where: { roles: { has: Role.PRESIDENT }, isActive: true } });
      if (presidents <= 1) throw rule.conflict('R12', 'Il faut toujours au moins un président actif.');
    }
    // Fiche joueur créée d'abord (code TCSAY, inscription dans la catégorie proposée) : elle ajoute le rôle joueur.
    if (roles.includes(Role.PLAYER) && !user.player && dto.player) {
      await this.players.createForAccount(actor, id, dto.player);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (roles.includes(Role.COACH) && !user.coach) {
        const count = await tx.coach.count();
        await tx.coach.create({ data: { userId: id, color: COLORS[count % COLORS.length] } });
      }
      return tx.user.update({ where: { id }, data: { roles, version: { increment: 1 } } });
    });
    await this.audit.log(actor.id, {
      action: 'Rôles modifiés',
      entity: 'User',
      entityId: id,
      target: `${user.firstName} ${user.lastName}`.trim(),
      before: label(user.roles),
      after: label(updated.roles),
    });
    return { id, roles: updated.roles, version: updated.version };
  }
}
