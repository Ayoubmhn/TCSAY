import { NIL_UUID } from '../common/rules';
import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { minutesOf } from '../common/dates';
import { assertSeasonOpen, assertVersion, fullName, notFound, rule } from '../common/rules';
import { DAY_NAMES, slotsOverlap } from '../common/sessions';
import { PrismaService } from '../prisma/prisma.service';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);

class GroupFields {
  @IsString()
  @IsNotEmpty({ message: 'Nom du groupe obligatoire.' })
  @MaxLength(60)
  name: string;

  @IsUUID('all', { message: 'Catégorie obligatoire.' })
  categoryId: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  coachId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  courtId?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Choisissez au moins un jour.' })
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days: number[];

  @Matches(TIME, { message: 'Heure de début au format HH:MM.' })
  startTime: string;

  @Matches(TIME, { message: 'Heure de fin au format HH:MM.' })
  endTime: string;

  @IsInt()
  @Min(1, { message: 'Capacité minimale : 1.' })
  @Max(40)
  capacity: number;
}

class CreateGroupDto extends GroupFields {
  @IsOptional()
  @IsUUID()
  seasonId?: string;
}

class UpdateGroupDto extends GroupFields {
  @IsInt()
  @Min(1)
  version: number;
}

class AddMemberDto {
  @IsUUID('all', { message: 'Joueur obligatoire.' })
  playerId: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  derogationReason?: string;
}

class ListQuery {
  @IsOptional()
  @IsUUID()
  seasonId?: string;
}

const groupInclude = {
  category: { select: { id: true, name: true, code: true } },
  coach: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
  court: { select: { id: true, name: true } },
  members: {
    include: {
      enrollment: {
        include: {
          player: { select: { id: true, firstName: true, lastName: true, archivedAt: true } },
          category: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
};

@ApiTags('Groupes')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Admin : tous les groupes ; coach : ses groupes. */
  @Get()
  @Roles(Role.ADMIN, Role.COACH)
  async list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    const season = await this.access.seasonOrActive(q.seasonId);
    const groups = await this.prisma.trainingGroup.findMany({
      where: {
        seasonId: season.id,
        archivedAt: null,
        ...(user.role === Role.COACH ? { coachId: user.coachId ?? NIL_UUID } : {}),
      },
      include: groupInclude,
      orderBy: { name: 'asc' },
    });
    return groups.map((g) => ({
      id: g.id,
      seasonId: g.seasonId,
      name: g.name,
      days: g.days,
      startTime: g.startTime,
      endTime: g.endTime,
      capacity: g.capacity,
      version: g.version,
      category: g.category,
      coach: g.coach ? { id: g.coach.id, ...g.coach.user } : null,
      court: g.court,
      members: g.members
        .filter((m) => !m.enrollment.player.archivedAt)
        .map((m) => ({
          playerId: m.enrollment.player.id,
          firstName: m.enrollment.player.firstName,
          lastName: m.enrollment.player.lastName,
          category: m.enrollment.category.name,
          derogationReason: m.derogationReason,
        })),
    }));
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) {
    const season = await this.access.seasonOrActive(dto.seasonId);
    assertSeasonOpen(season);
    await this.assertNoConflict(season.id, dto);
    const group = await this.prisma.trainingGroup.create({
      data: {
        seasonId: season.id,
        name: dto.name.trim(),
        categoryId: dto.categoryId,
        coachId: dto.coachId ?? null,
        courtId: dto.courtId ?? null,
        days: [...new Set(dto.days)].sort(),
        startTime: dto.startTime,
        endTime: dto.endTime,
        capacity: dto.capacity,
      },
    });
    await this.audit.log(user.id, {
      action: 'Groupe créé',
      entity: 'TrainingGroup',
      entityId: group.id,
      target: group.name,
      after: describe(group),
    });
    return group;
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto) {
    const group = await this.find(id);
    assertSeasonOpen(group.season);
    assertVersion(group, dto.version, 'Ce groupe');
    const members = await this.prisma.groupMember.count({ where: { groupId: id } });
    if (dto.capacity < members) {
      throw rule.conflict('R4', `Capacité ${dto.capacity} inférieure au nombre de joueurs (${members}).`);
    }
    await this.assertNoConflict(group.seasonId, dto, id);
    const updated = await this.prisma.trainingGroup.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        categoryId: dto.categoryId,
        coachId: dto.coachId ?? null,
        courtId: dto.courtId ?? null,
        days: [...new Set(dto.days)].sort(),
        startTime: dto.startTime,
        endTime: dto.endTime,
        capacity: dto.capacity,
        version: { increment: 1 },
      },
    });
    await this.audit.log(user.id, {
      action: 'Groupe modifié',
      entity: 'TrainingGroup',
      entityId: id,
      target: updated.name,
      before: describe(group),
      after: describe(updated),
    });
    return updated;
  }

  /** R4 : capacité respectée, catégorie correspondante (dérogation avec motif). */
  @Post(':id/members')
  @Roles(Role.ADMIN)
  async addMember(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    const group = await this.find(id);
    assertSeasonOpen(group.season);
    const count = await this.prisma.groupMember.count({ where: { groupId: id } });
    if (count >= group.capacity) {
      throw rule.conflict('R4', `Groupe « ${group.name} » complet (${group.capacity}/${group.capacity}).`);
    }
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { playerId_seasonId: { playerId: dto.playerId, seasonId: group.seasonId } },
      include: { player: true, category: true },
    });
    if (!enrollment || enrollment.player.archivedAt) {
      throw new BadRequestException('Ce joueur n’est pas inscrit sur la saison du groupe.');
    }
    const reason = dto.derogationReason?.trim() || null;
    if (enrollment.categoryId !== group.categoryId && !reason) {
      throw rule.bad(
        'R4',
        `${enrollment.player.firstName} est en ${enrollment.category.name} : motif de dérogation obligatoire.`,
      );
    }
    await this.prisma.groupMember.create({ data: { groupId: id, enrollmentId: enrollment.id, derogationReason: reason } });
    await this.audit.log(user.id, {
      action: reason ? 'Dérogation de catégorie' : 'Joueur ajouté à un groupe',
      entity: 'GroupMember',
      entityId: id,
      target: `${fullName(enrollment.player)} → groupe ${group.name}`,
      before: enrollment.category.name,
      after: `Groupe ${group.name}`,
      reason,
    });
    return { ok: true };
  }

  @Delete(':id/members/:playerId')
  @Roles(Role.ADMIN)
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('playerId', ParseUUIDPipe) playerId: string,
  ) {
    const group = await this.find(id);
    assertSeasonOpen(group.season);
    const member = await this.prisma.groupMember.findFirst({
      where: { groupId: id, enrollment: { playerId } },
      include: { enrollment: { include: { player: true } } },
    });
    if (!member) throw notFound('Membre');
    await this.prisma.groupMember.delete({ where: { id: member.id } });
    await this.audit.log(user.id, {
      action: 'Joueur retiré d’un groupe',
      entity: 'GroupMember',
      entityId: id,
      target: `${fullName(member.enrollment.player)} ← groupe ${group.name}`,
    });
    return { ok: true };
  }

  /** R8 : archivage. */
  @Post(':id/archive')
  @Roles(Role.ADMIN)
  async archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const group = await this.find(id);
    assertSeasonOpen(group.season);
    await this.prisma.trainingGroup.update({ where: { id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
    await this.audit.log(user.id, { action: 'Groupe archivé', entity: 'TrainingGroup', entityId: id, target: group.name });
    return { ok: true };
  }

  /** R5 : pas de conflit de terrain ou d'entraîneur sur un même créneau. */
  private async assertNoConflict(seasonId: string, dto: GroupFields, excludeId?: string) {
    if (minutesOf(dto.endTime) <= minutesOf(dto.startTime)) {
      throw new BadRequestException('L’heure de fin doit suivre l’heure de début.');
    }
    if (!dto.courtId && !dto.coachId) return;
    const others = await this.prisma.trainingGroup.findMany({
      where: {
        seasonId,
        archivedAt: null,
        id: excludeId ? { not: excludeId } : undefined,
        OR: [...(dto.courtId ? [{ courtId: dto.courtId }] : []), ...(dto.coachId ? [{ coachId: dto.coachId }] : [])],
      },
      include: { court: true, coach: { include: { user: true } } },
    });
    for (const other of others) {
      if (!slotsOverlap(dto, other)) continue;
      const day = DAY_NAMES[dto.days.find((d) => other.days.includes(d)) ?? 0].toLowerCase();
      if (dto.courtId && other.courtId === dto.courtId) {
        throw rule.conflict('R5', `Conflit : ${other.court?.name} est déjà occupé le ${day} à ${other.startTime} par « ${other.name} ».`);
      }
      throw rule.conflict(
        'R5',
        `Conflit : ${other.coach ? fullName(other.coach.user) : 'l’entraîneur'} entraîne déjà « ${other.name} » le ${day} à ${other.startTime}.`,
      );
    }
  }

  private async find(id: string) {
    const group = await this.prisma.trainingGroup.findUnique({ where: { id }, include: { season: true } });
    if (!group || group.archivedAt) throw notFound('Groupe');
    return group;
  }
}

function describe(g: { days: number[]; startTime: string; endTime: string; capacity: number }): string {
  return `${g.days.map((d) => DAY_NAMES[d]).join(' & ')} ${g.startTime}–${g.endTime} · ${g.capacity} places`;
}
