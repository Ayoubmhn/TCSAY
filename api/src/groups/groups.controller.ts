import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, Role } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { minutesOf } from '../common/dates';
import { assertSeasonOpen, assertVersion, fullName, NIL_UUID, notFound, rule } from '../common/rules';
import { DAY_LONG, DAY_NAMES, slotsOverlap } from '../common/sessions';
import { PrismaService } from '../prisma/prisma.service';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);

/** Un créneau : un jour, son horaire, son terrain, ses entraîneurs (plusieurs possibles). */
class SlotDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsInt()
  @Min(0)
  @Max(6)
  day: number;

  @Matches(TIME, { message: 'Heure de début au format HH:MM.' })
  startTime: string;

  @Matches(TIME, { message: 'Heure de fin au format HH:MM.' })
  endTime: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  courtId?: string;

  @IsArray()
  @ArrayMaxSize(4)
  @IsUUID('all', { each: true })
  coachIds: string[];
}

class GroupFields {
  @IsString()
  @IsNotEmpty({ message: 'Nom du groupe obligatoire.' })
  @MaxLength(60)
  name: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  categoryId?: string;

  @IsInt()
  @Min(1, { message: 'Capacité minimale : 1.' })
  @Max(60)
  capacity: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'Ajoutez au moins un créneau.' })
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => SlotDto)
  slots: SlotDto[];
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

export const slotInclude = {
  court: { select: { id: true, name: true } },
  coaches: {
    include: { coach: { select: { id: true, color: true, user: { select: { firstName: true, lastName: true } } } } },
  },
} satisfies Prisma.GroupSlotInclude;

const groupInclude = {
  category: { select: { id: true, name: true, code: true } },
  slots: { include: slotInclude, orderBy: [{ day: 'asc' as const }, { startTime: 'asc' as const }] },
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
} satisfies Prisma.TrainingGroupInclude;

type SlotRow = Prisma.GroupSlotGetPayload<{ include: typeof slotInclude }>;

/** Vue d'un créneau pour le web : jour, horaire, terrain, entraîneurs (avec couleur). */
export function slotView(s: SlotRow) {
  return {
    id: s.id,
    day: s.day,
    startTime: s.startTime,
    endTime: s.endTime,
    court: s.court,
    coaches: s.coaches.map((c) => ({ id: c.coach.id, color: c.coach.color, ...c.coach.user })),
  };
}

@ApiTags('Groupes')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Admin et personnel : tous les groupes ; coach : les groupes dont il anime au moins un créneau. */
  @Get()
  @Roles(Role.ADMIN, Role.COACH, Role.STAFF)
  async list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    const season = await this.access.seasonOrActive(q.seasonId);
    const groups = await this.prisma.trainingGroup.findMany({
      where: {
        seasonId: season.id,
        archivedAt: null,
        ...(user.role === Role.COACH ? { slots: { some: { coaches: { some: { coachId: user.coachId ?? NIL_UUID } } } } } : {}),
      },
      include: groupInclude,
      orderBy: { name: 'asc' },
    });
    return groups.map((g) => this.view(g));
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) {
    const season = await this.access.seasonOrActive(dto.seasonId);
    assertSeasonOpen(season);
    await this.assertNoConflict(season.id, dto.slots);
    const group = await this.prisma.trainingGroup.create({
      data: {
        seasonId: season.id,
        name: dto.name.trim(),
        categoryId: dto.categoryId ?? null,
        capacity: dto.capacity,
        slots: { create: dto.slots.map((s) => this.slotData(s)) },
      },
      include: groupInclude,
    });
    await this.audit.log(user.id, {
      action: 'Groupe créé',
      entity: 'TrainingGroup',
      entityId: group.id,
      target: group.name,
      after: describe(group.slots),
    });
    return this.view(group);
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
    await this.assertNoConflict(group.seasonId, dto.slots, id);

    const keep = new Set(dto.slots.filter((s) => s.id).map((s) => s.id));
    const removed = group.slots.filter((s) => !keep.has(s.id));
    if (removed.length) {
      const used = await this.prisma.attendance.count({ where: { slotId: { in: removed.map((s) => s.id) } } });
      if (used) throw rule.conflict('R8', 'Un créneau supprimé a déjà des présences pointées : modifiez-le plutôt que de le retirer.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.groupSlot.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } });
      for (const s of dto.slots) {
        if (s.id && group.slots.some((x) => x.id === s.id)) {
          await tx.slotCoach.deleteMany({ where: { slotId: s.id } });
          await tx.groupSlot.update({
            where: { id: s.id },
            data: {
              day: s.day,
              startTime: s.startTime,
              endTime: s.endTime,
              courtId: s.courtId ?? null,
              coaches: { create: s.coachIds.map((coachId) => ({ coachId })) },
            },
          });
        } else {
          await tx.groupSlot.create({ data: { groupId: id, ...this.slotData(s) } });
        }
      }
      return tx.trainingGroup.update({
        where: { id },
        data: { name: dto.name.trim(), categoryId: dto.categoryId ?? null, capacity: dto.capacity, version: { increment: 1 } },
        include: groupInclude,
      });
    });
    await this.audit.log(user.id, {
      action: 'Groupe modifié',
      entity: 'TrainingGroup',
      entityId: id,
      target: updated.name,
      before: describe(group.slots),
      after: describe(updated.slots),
    });
    return this.view(updated);
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
    if (group.categoryId && enrollment.categoryId !== group.categoryId && !reason) {
      throw rule.bad('R4', `${enrollment.player.firstName} est en ${enrollment.category.name} : motif de dérogation obligatoire.`);
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

  private slotData(s: SlotDto) {
    return {
      day: s.day,
      startTime: s.startTime,
      endTime: s.endTime,
      courtId: s.courtId ?? null,
      coaches: { create: [...new Set(s.coachIds)].map((coachId) => ({ coachId })) },
    };
  }

  /** R5 : pas de conflit de terrain ni d'entraîneur sur un même créneau (dans le groupe et avec les autres groupes). */
  private async assertNoConflict(seasonId: string, slots: SlotDto[], excludeGroupId?: string) {
    for (const s of slots) {
      if (minutesOf(s.endTime) <= minutesOf(s.startTime)) {
        throw new BadRequestException(`${DAY_LONG[s.day]} : l’heure de fin doit suivre l’heure de début.`);
      }
    }
    // Conflits internes au groupe.
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i];
        const b = slots[j];
        if (!slotsOverlap(a, b)) continue;
        if ((a.courtId && a.courtId === b.courtId) || a.coachIds.some((c) => b.coachIds.includes(c))) {
          throw rule.conflict('R5', `Deux créneaux du ${DAY_LONG[a.day]} se chevauchent sur le même terrain ou le même entraîneur.`);
        }
      }
    }
    const others = await this.prisma.groupSlot.findMany({
      where: {
        group: { seasonId, archivedAt: null, id: excludeGroupId ? { not: excludeGroupId } : undefined },
        day: { in: [...new Set(slots.map((s) => s.day))] },
      },
      include: { group: true, court: true, coaches: { include: { coach: { include: { user: true } } } } },
    });
    for (const s of slots) {
      for (const o of others) {
        if (!slotsOverlap(s, o)) continue;
        if (s.courtId && o.courtId === s.courtId) {
          throw rule.conflict('R5', `Conflit : ${o.court?.name} est déjà occupé le ${DAY_LONG[s.day]} de ${o.startTime} à ${o.endTime} par « ${o.group.name} ».`);
        }
        const coach = o.coaches.find((c) => s.coachIds.includes(c.coachId));
        if (coach) {
          throw rule.conflict('R5', `Conflit : ${fullName(coach.coach.user).trim()} entraîne déjà « ${o.group.name} » le ${DAY_LONG[s.day]} à ${o.startTime}.`);
        }
      }
    }
  }

  private async find(id: string) {
    const group = await this.prisma.trainingGroup.findUnique({ where: { id }, include: { season: true, slots: { include: slotInclude } } });
    if (!group || group.archivedAt) throw notFound('Groupe');
    return group;
  }

  private view(g: Prisma.TrainingGroupGetPayload<{ include: typeof groupInclude }>) {
    const slots = g.slots.map(slotView);
    const coaches = new Map<string, (typeof slots)[number]['coaches'][number]>();
    for (const s of slots) for (const c of s.coaches) coaches.set(c.id, c);
    return {
      id: g.id,
      seasonId: g.seasonId,
      name: g.name,
      capacity: g.capacity,
      version: g.version,
      category: g.category,
      slots,
      coaches: [...coaches.values()],
      members: g.members
        .filter((m) => !m.enrollment.player.archivedAt)
        .map((m) => ({
          playerId: m.enrollment.player.id,
          firstName: m.enrollment.player.firstName,
          lastName: m.enrollment.player.lastName,
          category: m.enrollment.category.name,
          derogationReason: m.derogationReason,
        })),
    };
  }
}

function describe(slots: { day: number; startTime: string; endTime: string; court?: { name: string } | null }[]): string {
  return slots.map((s) => `${DAY_NAMES[s.day]} ${s.startTime}–${s.endTime}${s.court ? ' ' + s.court.name : ''}`).join(' · ') || '—';
}
