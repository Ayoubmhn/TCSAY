import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, Role } from '@prisma/client';
import { IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm, Roles } from '../auth/auth-user';
import { dayFromIso, isoDay, todayIso } from '../common/dates';
import { fullName, rule } from '../common/rules';
import { DAY_LONG, slotsOverlap } from '../common/sessions';
import { PrismaService } from '../prisma/prisma.service';

type Grid = Record<string, 'D' | 'P' | 'I'>;
/** Heures de la grille (début de chaque heure) et jours (0 = dimanche … 6 = samedi). */
const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 8h → 21h
const DAYS = [1, 2, 3, 4, 5, 6, 0];
const NIGHT = 18;
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

class OwnerQuery {
  @IsOptional() @IsUUID() playerId?: string;
}

class GridDto {
  @IsOptional() @IsUUID() playerId?: string;
  @IsObject() grid: Grid;
}

class ExceptionDto {
  @IsOptional() @IsUUID() playerId?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date de début obligatoire.' }) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date de fin obligatoire.' }) to: string;
  @IsString() @IsNotEmpty({ message: 'Motif obligatoire.' }) @MaxLength(200) reason: string;
}

class SuggestDto {
  @IsUUID() coachId: string;
  @IsOptional() @IsUUID() groupId?: string;
  /** Durée de la séance en minutes. */
  @Type(() => Number) @IsInt() @Min(30) @Max(240) duration: number;
}

class ApplyDto {
  @IsUUID() groupId: string;
  @IsUUID() coachId: string;
  @IsUUID() courtId: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(6) day: number;
  @Matches(/^\d{2}:\d{2}$/) startTime: string;
  @Matches(/^\d{2}:\d{2}$/) endTime: string;
}

class CoachesQuery {
  @IsOptional() @IsIn(['all']) scope?: string;
}

/**
 * Disponibilités (semaine type + exceptions datées) des entraîneurs et des joueurs, et assistant de créneau pour les
 * groupes : propose des horaires où l'entraîneur est disponible, un terrain libre (éclairé la nuit) et le plus de joueurs
 * du groupe disponibles. La direction (droit « groups.manage ») voit tout et ajoute le créneau choisi au groupe (R5 vérifiée).
 */
@ApiTags('Disponibilités')
@ApiBearerAuth()
@Controller('availability')
export class AvailabilityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Propriétaire : l'entraîneur connecté, ou un joueur (lui-même, ou un enfant pour le parent). */
  private async owner(user: AuthUser, playerId?: string): Promise<{ coachId?: string; playerId?: string }> {
    if (user.role === Role.COACH) {
      if (!user.coachId) throw new ForbiddenException('Profil entraîneur introuvable.');
      return { coachId: user.coachId };
    }
    if (user.role === Role.PARENT || user.role === Role.PLAYER) return { playerId: await this.access.resolvePlayer(user, playerId) };
    throw new ForbiddenException('Disponibilités : entraîneur, joueur ou parent.');
  }

  private clean(grid: Grid): Grid {
    const out: Grid = {};
    for (const [k, v] of Object.entries(grid ?? {})) {
      const m = /^([0-6])-(\d{1,2})$/.exec(k);
      if (!m || !HOURS.includes(Number(m[2])) || !['D', 'P', 'I'].includes(v)) continue;
      out[`${m[1]}-${Number(m[2])}`] = v;
    }
    return out;
  }

  @Get('me')
  @Roles(Role.COACH, Role.PARENT, Role.PLAYER)
  async mine(@CurrentUser() user: AuthUser, @Query() q: OwnerQuery) {
    const who = await this.owner(user, q.playerId);
    const [row, exceptions] = await Promise.all([
      this.prisma.availability.findUnique({ where: who.coachId ? { coachId: who.coachId } : { playerId: who.playerId } }),
      this.prisma.availabilityException.findMany({ where: { ...who, toDate: { gte: dayFromIso(todayIso()) } }, orderBy: { fromDate: 'asc' } }),
    ]);
    return {
      hours: HOURS,
      days: DAYS,
      grid: (row?.grid ?? {}) as Grid,
      updatedAt: row?.updatedAt ?? null,
      exceptions: exceptions.map((e) => ({ id: e.id, from: isoDay(e.fromDate), to: isoDay(e.toDate), reason: e.reason })),
    };
  }

  @Put('me')
  @Roles(Role.COACH, Role.PARENT, Role.PLAYER)
  async saveMine(@CurrentUser() user: AuthUser, @Body() dto: GridDto) {
    const who = await this.owner(user, dto.playerId);
    const grid = this.clean(dto.grid) as Prisma.InputJsonValue;
    const where = who.coachId ? { coachId: who.coachId } : { playerId: who.playerId };
    await this.prisma.availability.upsert({ where, create: { ...who, grid, updatedById: user.id }, update: { grid, updatedById: user.id } });
    return { ok: true };
  }

  @Post('me/exceptions')
  @Roles(Role.COACH, Role.PARENT, Role.PLAYER)
  async addException(@CurrentUser() user: AuthUser, @Body() dto: ExceptionDto) {
    if (dto.to < dto.from) throw new BadRequestException('La date de fin suit la date de début.');
    const who = await this.owner(user, dto.playerId);
    const e = await this.prisma.availabilityException.create({ data: { ...who, fromDate: dayFromIso(dto.from), toDate: dayFromIso(dto.to), reason: dto.reason.trim() } });
    return { id: e.id };
  }

  @Delete('me/exceptions/:id')
  @Roles(Role.COACH, Role.PARENT, Role.PLAYER)
  async removeException(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: OwnerQuery) {
    const who = await this.owner(user, q.playerId);
    const e = await this.prisma.availabilityException.findUnique({ where: { id } });
    if (!e || (who.coachId ? e.coachId !== who.coachId : e.playerId !== who.playerId)) throw new NotFoundException('Exception introuvable.');
    await this.prisma.availabilityException.delete({ where: { id } });
    return { ok: true };
  }

  /** Direction : grilles de tous les entraîneurs, avec leurs créneaux de la saison active et leurs absences à venir. */
  @Get('coaches')
  @Perm('groups.manage')
  async coaches(@Query() _q: CoachesQuery) {
    const season = await this.access.activeSeason();
    const coaches = await this.prisma.coach.findMany({
      where: { user: { isActive: true } },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
      include: {
        user: { select: { firstName: true, lastName: true } },
        availability: true,
        availabilityExceptions: { where: { toDate: { gte: dayFromIso(todayIso()) } }, orderBy: { fromDate: 'asc' } },
        slots: { where: { slot: { group: { seasonId: season.id, archivedAt: null } } }, include: { slot: { include: { group: { select: { name: true } }, court: { select: { name: true } } } } } },
      },
    });
    return {
      hours: HOURS,
      days: DAYS,
      coaches: coaches.map((c) => ({
        id: c.id,
        name: fullName(c.user).trim(),
        color: c.color,
        grid: (c.availability?.grid ?? {}) as Grid,
        filled: Boolean(c.availability),
        exceptions: c.availabilityExceptions.map((e) => ({ id: e.id, from: isoDay(e.fromDate), to: isoDay(e.toDate), reason: e.reason })),
        slots: c.slots.map((s) => ({ day: s.slot.day, startTime: s.slot.startTime, endTime: s.slot.endTime, group: s.slot.group.name, court: s.slot.court?.name ?? null })),
      })),
    };
  }

  /**
   * Assistant de créneau : pour un entraîneur (et un groupe), créneaux de la durée demandée, du lundi au dimanche,
   * où l'entraîneur n'est pas indisponible ni déjà pris, avec un terrain libre (éclairé dès 18h), classés par
   * préférence de l'entraîneur puis part des joueurs du groupe disponibles.
   */
  @Post('suggest')
  @Perm('groups.manage')
  async suggest(@Body() dto: SuggestDto) {
    const season = await this.access.activeSeason();
    const coach = await this.prisma.coach.findUnique({ where: { id: dto.coachId }, include: { availability: true, user: { select: { firstName: true, lastName: true } } } });
    if (!coach) throw new NotFoundException('Entraîneur introuvable.');
    const grid = (coach.availability?.grid ?? {}) as Grid;
    const [slots, courts, members] = await Promise.all([
      this.prisma.groupSlot.findMany({
        where: { group: { seasonId: season.id, archivedAt: null } },
        select: { day: true, startTime: true, endTime: true, courtId: true, groupId: true, coaches: { select: { coachId: true } } },
      }),
      this.prisma.court.findMany({ where: { active: true, maintenance: false }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, lit: true } }),
      dto.groupId
        ? this.prisma.groupMember.findMany({ where: { groupId: dto.groupId }, select: { enrollment: { select: { player: { select: { availability: { select: { grid: true } } } } } } } })
        : Promise.resolve([]),
    ]);
    const playerGrids = members.map((m) => (m.enrollment.player.availability?.grid ?? null) as Grid | null).filter((g): g is Grid => Boolean(g));
    const results: {
      day: number;
      dayLabel: string;
      startTime: string;
      endTime: string;
      preferred: boolean;
      coachFilled: boolean;
      courtId: string;
      court: string;
      night: boolean;
      playersAvailable: number | null;
      playersKnown: number;
      score: number;
    }[] = [];
    for (const day of DAYS) {
      for (let start = 8 * 60; start + dto.duration <= 22 * 60; start += 30) {
        const end = start + dto.duration;
        const hours = HOURS.filter((h) => h * 60 < end && (h + 1) * 60 > start);
        const states = hours.map((h) => grid[`${day}-${h}`]);
        if (states.includes('I')) continue;
        const cand = { day, startTime: hhmm(start), endTime: hhmm(end) };
        const busy = slots.filter((s) => s.day === day && slotsOverlap(cand, s));
        if (busy.some((s) => s.coaches.some((c) => c.coachId === coach.id) || (dto.groupId && s.groupId === dto.groupId))) continue;
        const night = end > NIGHT * 60;
        const court = courts.find((c) => (!night || c.lit) && !busy.some((s) => s.courtId === c.id));
        if (!court) continue;
        const ok = playerGrids.filter((g) => !hours.some((h) => g[`${day}-${h}`] === 'I')).length;
        const preferred = states.length > 0 && states.every((s) => s === 'P');
        const ratio = playerGrids.length ? ok / playerGrids.length : null;
        results.push({
          ...cand,
          dayLabel: DAY_LONG[day],
          preferred,
          coachFilled: states.every((s) => s !== undefined),
          courtId: court.id,
          court: court.name,
          night,
          playersAvailable: ratio === null ? null : Math.round(ratio * 100),
          playersKnown: playerGrids.length,
          score: (preferred ? 2 : 0) + (states.every((s) => s !== undefined) ? 1 : 0) + (ratio ?? 0.5) * 3 - (start % 60 ? 0.1 : 0),
        });
      }
    }
    // Un seul créneau par jour et par heure de début, les meilleurs d'abord.
    results.sort((a, b) => b.score - a.score);
    const perDay = new Map<number, number>();
    const best = results.filter((r) => {
      const n = perDay.get(r.day) ?? 0;
      if (n >= 2) return false;
      perDay.set(r.day, n + 1);
      return true;
    });
    return { coach: fullName(coach.user).trim(), coachFilled: Boolean(coach.availability), players: { total: members.length, known: playerGrids.length }, slots: best.slice(0, 10) };
  }

  /** Ajoute le créneau choisi au groupe (R5 : terrain et entraîneur libres, vérifiés de nouveau). */
  @Post('apply')
  @Perm('groups.manage')
  async apply(@CurrentUser() actor: AuthUser, @Body() dto: ApplyDto) {
    const group = await this.prisma.trainingGroup.findUnique({ where: { id: dto.groupId } });
    if (!group || group.archivedAt) throw new NotFoundException('Groupe introuvable.');
    const cand = { day: dto.day, startTime: dto.startTime, endTime: dto.endTime };
    const others = await this.prisma.groupSlot.findMany({
      where: { day: dto.day, group: { seasonId: group.seasonId, archivedAt: null } },
      include: { group: { select: { name: true } }, coaches: { select: { coachId: true } } },
    });
    for (const o of others.filter((o) => slotsOverlap(cand, o))) {
      if (o.courtId === dto.courtId) throw rule.conflict('R5', `Terrain déjà occupé le ${DAY_LONG[dto.day]} à ${o.startTime} par « ${o.group.name} ».`);
      if (o.coaches.some((c) => c.coachId === dto.coachId)) throw rule.conflict('R5', `Entraîneur déjà pris le ${DAY_LONG[dto.day]} à ${o.startTime} (« ${o.group.name} »).`);
    }
    const slot = await this.prisma.groupSlot.create({
      data: { groupId: group.id, day: dto.day, startTime: dto.startTime, endTime: dto.endTime, courtId: dto.courtId, coaches: { create: [{ coachId: dto.coachId }] } },
    });
    await this.audit.log(actor.id, { action: 'Créneau ajouté (assistant)', entity: 'TrainingGroup', entityId: group.id, target: group.name, after: `${DAY_LONG[dto.day]} ${dto.startTime}–${dto.endTime}` });
    return { id: slot.id };
  }
}
