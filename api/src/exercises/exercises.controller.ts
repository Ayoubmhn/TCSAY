import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailKind, ExerciseKind, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { AccessService } from '../access/access.service';
import { PaymentAccessService } from '../access/payment-access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, can, CurrentUser, Roles } from '../auth/auth-user';
import { Feature } from '../modules/modules';
import { addDaysIso, dayFromIso, isoDay, todayIso } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';

class ExerciseDto {
  @IsString()
  @IsNotEmpty({ message: 'Titre obligatoire.' })
  @MaxLength(80)
  title: string;

  @IsEnum(ExerciseKind, { message: 'Type : échauffement, technique, physique ou récupération.' })
  kind: ExerciseKind;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  durationMin?: number;

  @IsString()
  @IsNotEmpty({ message: 'Consignes obligatoires.' })
  @MaxLength(1500)
  instructions: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Lien vidéo : adresse https://… complète.' })
  @MaxLength(300)
  videoUrl?: string;
}

class AssignDto {
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @IsUUID()
  playerId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

class PlayerQuery {
  @IsOptional()
  @IsUUID()
  playerId?: string;
}

class DoneDto {
  @IsOptional()
  @IsUUID()
  playerId?: string;

  @IsBoolean()
  done: boolean;
}

/** Exercices donnés restent visibles 30 jours (ou jusqu'à 7 jours après leur échéance). */
const VISIBLE_DAYS = 30;

/**
 * Exercices : bibliothèque du club (entraîneurs et direction technique), exercices donnés à un groupe ou à un joueur,
 * coches « fait » par le joueur ou le parent. L'entraîneur voit qui a fait ses exercices.
 */
@ApiTags('Exercices')
@ApiBearerAuth()
@Feature('exercices')
@Controller('exercises')
export class ExercisesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly gate: PaymentAccessService,
    private readonly audit: AuditService,
  ) {}

  private assertManager(user: AuthUser) {
    if (user.role === Role.ADMIN && !can(user, 'evaluations.manage')) {
      throw new ForbiddenException('Accès refusé : autorisation « suivi technique » manquante.');
    }
  }

  /** Bibliothèque (non archivés). */
  @Get()
  @Roles(Role.COACH, Role.ADMIN)
  async list(@CurrentUser() user: AuthUser) {
    this.assertManager(user);
    const rows = await this.prisma.exercise.findMany({
      where: { archivedAt: null },
      orderBy: [{ kind: 'asc' }, { title: 'asc' }],
      include: { createdBy: { select: { firstName: true, lastName: true } }, _count: { select: { assignments: true } } },
    });
    return rows.map((e) => ({
      id: e.id,
      title: e.title,
      kind: e.kind,
      durationMin: e.durationMin,
      instructions: e.instructions,
      videoUrl: e.videoUrl,
      author: `${e.createdBy.firstName} ${e.createdBy.lastName}`.trim(),
      mine: e.createdById === user.id,
      assignments: e._count.assignments,
    }));
  }

  @Post()
  @Roles(Role.COACH, Role.ADMIN)
  async create(@CurrentUser() user: AuthUser, @Body() dto: ExerciseDto) {
    this.assertManager(user);
    const e = await this.prisma.exercise.create({ data: { ...this.clean(dto), createdById: user.id } });
    await this.audit.log(user.id, { action: 'Exercice créé', entity: 'Exercise', entityId: e.id, target: e.title });
    return { id: e.id };
  }

  /** Modification : l'auteur, ou la direction technique. */
  @Patch(':id')
  @Roles(Role.COACH, Role.ADMIN)
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExerciseDto) {
    const e = await this.own(user, id);
    await this.prisma.exercise.update({ where: { id }, data: this.clean(dto) });
    await this.audit.log(user.id, { action: 'Exercice modifié', entity: 'Exercise', entityId: id, target: e.title, after: dto.title });
    return { ok: true };
  }

  /** Archivage (R8) : l'exercice disparaît de la bibliothèque, les exercices déjà donnés restent visibles. */
  @Post(':id/archive')
  @Roles(Role.COACH, Role.ADMIN)
  async archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.own(user, id);
    await this.prisma.exercise.update({ where: { id }, data: { archivedAt: new Date() } });
    await this.audit.log(user.id, { action: 'Exercice archivé', entity: 'Exercise', entityId: id, target: e.title });
    return { ok: true };
  }

  private clean(dto: ExerciseDto) {
    return {
      title: dto.title.trim(),
      kind: dto.kind,
      durationMin: dto.durationMin ?? null,
      instructions: dto.instructions.trim(),
      videoUrl: dto.videoUrl?.trim() || null,
    };
  }

  private async own(user: AuthUser, id: string) {
    this.assertManager(user);
    const e = await this.prisma.exercise.findUnique({ where: { id } });
    if (!e || e.archivedAt) throw new NotFoundException('Exercice introuvable.');
    if (user.role === Role.COACH && e.createdById !== user.id) throw new ForbiddenException('Seul l’auteur (ou la direction technique) peut modifier cet exercice.');
    return e;
  }

  /** Donner un exercice à un groupe (de l'entraîneur) ou à un joueur de ses groupes ; notification aux familles. */
  @Post(':id/assign')
  @Roles(Role.COACH, Role.ADMIN)
  async assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    this.assertManager(user);
    if (Boolean(dto.groupId) === Boolean(dto.playerId)) throw new BadRequestException('Choisissez un groupe ou un joueur.');
    const exercise = await this.prisma.exercise.findUnique({ where: { id } });
    if (!exercise || exercise.archivedAt) throw new NotFoundException('Exercice introuvable.');
    const season = await this.access.activeSeason();
    const coachFilter = user.role === Role.COACH ? { slots: { some: { coaches: { some: { coachId: user.coachId ?? '' } } } } } : {};
    let playerIds: string[];
    let target: string;
    if (dto.groupId) {
      const group = await this.prisma.trainingGroup.findFirst({
        where: { id: dto.groupId, seasonId: season.id, archivedAt: null, ...coachFilter },
        include: { members: { where: { enrollment: { player: { archivedAt: null } } }, select: { enrollment: { select: { playerId: true } } } } },
      });
      if (!group) throw new ForbiddenException('Groupe introuvable ou pas le vôtre.');
      playerIds = group.members.map((m) => m.enrollment.playerId);
      target = `Groupe ${group.name}`;
    } else {
      const member = await this.prisma.groupMember.findFirst({
        where: { enrollment: { playerId: dto.playerId, seasonId: season.id }, group: { archivedAt: null, ...coachFilter } },
        include: { enrollment: { select: { player: { select: { firstName: true, lastName: true } } } } },
      });
      if (!member) throw new ForbiddenException('Ce joueur n’est pas dans vos groupes.');
      playerIds = [dto.playerId!];
      target = `${member.enrollment.player.firstName} ${member.enrollment.player.lastName}`.trim();
    }
    if (dto.dueDate && dto.dueDate < todayIso()) throw new BadRequestException('Échéance déjà passée.');
    const a = await this.prisma.exerciseAssignment.create({
      data: {
        exerciseId: id,
        groupId: dto.groupId ?? null,
        playerId: dto.playerId ?? null,
        dueDate: dto.dueDate ? dayFromIso(dto.dueDate) : null,
        note: dto.note?.trim() || null,
        assignedById: user.id,
      },
    });
    await this.audit.log(user.id, { action: 'Exercice donné', entity: 'ExerciseAssignment', entityId: a.id, target, after: exercise.title });

    // Notification : joueurs (avec compte) et parents actifs.
    const [players, links] = await Promise.all([
      this.prisma.player.findMany({ where: { id: { in: playerIds }, userId: { not: null } }, select: { userId: true } }),
      this.prisma.parentLink.findMany({ where: { playerId: { in: playerIds }, parent: { isActive: true } }, select: { parentId: true } }),
    ]);
    const users = [...new Set([...players.map((p) => p.userId!), ...links.map((l) => l.parentId)])];
    const due = dto.dueDate ? ` (à faire avant le ${dto.dueDate.split('-').reverse().join('/')})` : '';
    if (users.length) {
      await this.prisma.notification.createMany({
        data: users.map((userId) => ({ userId, kind: EmailKind.OTHER, title: `Nouvel exercice : ${exercise.title}`, body: `Exercice donné par l’entraîneur${due}.`, link: '/exercices' })),
      });
    }
    return { id: a.id, players: playerIds.length };
  }

  /** Exercices donnés (entraîneur : les siens ; direction : tous), 30 derniers jours, avec le nombre de joueurs qui les ont faits. */
  @Get('assignments')
  @Roles(Role.COACH, Role.ADMIN)
  async assignments(@CurrentUser() user: AuthUser) {
    this.assertManager(user);
    const since = dayFromIso(addDaysIso(todayIso(), -VISIBLE_DAYS));
    const rows = await this.prisma.exerciseAssignment.findMany({
      where: { createdAt: { gte: since }, ...(user.role === Role.COACH ? { assignedById: user.id } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        exercise: { select: { title: true, kind: true } },
        group: {
          select: {
            name: true,
            members: { where: { enrollment: { player: { archivedAt: null } } }, select: { enrollment: { select: { player: { select: { id: true, firstName: true, lastName: true } } } } } },
          },
        },
        player: { select: { id: true, firstName: true, lastName: true } },
        completions: { select: { playerId: true } },
      },
    });
    return rows.map((a) => {
      const players = a.group ? a.group.members.map((m) => m.enrollment.player) : a.player ? [a.player] : [];
      const done = new Set(a.completions.map((c) => c.playerId));
      return {
        id: a.id,
        exercise: a.exercise,
        target: a.group ? `Groupe ${a.group.name}` : a.player ? `${a.player.firstName} ${a.player.lastName}`.trim() : '—',
        dueDate: a.dueDate ? isoDay(a.dueDate) : null,
        note: a.note,
        createdAt: a.createdAt,
        total: players.length,
        done: players.filter((p) => done.has(p.id)).length,
        missing: players.filter((p) => !done.has(p.id)).map((p) => `${p.firstName} ${p.lastName}`.trim()),
      };
    });
  }

  /** Joueur / parent : exercices à faire (donnés au joueur ou à ses groupes de la saison active). */
  @Get('mine')
  @Roles(Role.PLAYER, Role.PARENT)
  async mine(@CurrentUser() user: AuthUser, @Query() q: PlayerQuery) {
    const playerId = await this.access.resolvePlayer(user, q.playerId);
    await this.gate.assert(playerId, 'exercises');
    const season = await this.access.activeSeason();
    const groups = await this.prisma.groupMember.findMany({
      where: { enrollment: { playerId, seasonId: season.id }, group: { archivedAt: null } },
      select: { groupId: true },
    });
    const today = todayIso();
    const rows = await this.prisma.exerciseAssignment.findMany({
      where: {
        OR: [{ playerId }, { groupId: { in: groups.map((g) => g.groupId) } }],
        AND: [
          { OR: [{ dueDate: null }, { dueDate: { gte: dayFromIso(addDaysIso(today, -7)) } }] },
          { createdAt: { gte: dayFromIso(addDaysIso(today, -VISIBLE_DAYS)) } },
        ],
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      include: {
        exercise: true,
        assignedBy: { select: { firstName: true, lastName: true } },
        completions: { where: { playerId }, select: { doneAt: true } },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      title: a.exercise.title,
      kind: a.exercise.kind,
      durationMin: a.exercise.durationMin,
      instructions: a.exercise.instructions,
      videoUrl: a.exercise.videoUrl,
      dueDate: a.dueDate ? isoDay(a.dueDate) : null,
      note: a.note,
      coach: `${a.assignedBy.firstName} ${a.assignedBy.lastName}`.trim(),
      doneAt: a.completions[0]?.doneAt ?? null,
    }));
  }

  /** Joueur / parent : marquer « fait » ou « pas fait ». */
  @Put('assignments/:id/done')
  @Roles(Role.PLAYER, Role.PARENT)
  async done(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DoneDto) {
    const playerId = await this.access.resolvePlayer(user, dto.playerId);
    await this.gate.assert(playerId, 'exercises');
    const a = await this.prisma.exerciseAssignment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Exercice introuvable.');
    const season = await this.access.activeSeason();
    const concerned =
      a.playerId === playerId ||
      (a.groupId &&
        (await this.prisma.groupMember.count({ where: { groupId: a.groupId, enrollment: { playerId, seasonId: season.id } } })) > 0);
    if (!concerned) throw new ForbiddenException('Cet exercice n’a pas été donné à ce joueur.');
    if (dto.done) {
      await this.prisma.exerciseCompletion.upsert({
        where: { assignmentId_playerId: { assignmentId: id, playerId } },
        create: { assignmentId: id, playerId },
        update: {},
      });
    } else {
      await this.prisma.exerciseCompletion.deleteMany({ where: { assignmentId: id, playerId } });
    }
    return { done: dto.done };
  }
}
