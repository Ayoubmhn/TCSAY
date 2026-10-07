import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AbsenceStatus, Prisma, Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { dayFromIso, isoDay, todayIso, weekday } from '../common/dates';
import { fullName, NIL_UUID, notFound } from '../common/rules';
import { DAY_LONG } from '../common/sessions';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);

class DeclareDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date au format AAAA-MM-JJ.' })
  date: string;

  /** Séance précise ; vide = toute la journée. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  slotId?: string;

  @IsString()
  @IsNotEmpty({ message: 'Le motif est obligatoire.' })
  @MaxLength(300)
  reason: string;

  @IsOptional()
  @IsBoolean()
  notifyGroups?: boolean;

  /** Admin : saisie directe pour un entraîneur (validée d'office). */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  coachId?: string;
}

class DecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

class ListQuery {
  @IsOptional()
  @IsEnum(AbsenceStatus)
  status?: AbsenceStatus;

  @IsOptional()
  @IsUUID()
  coachId?: string;
}

const include = {
  coach: { select: { id: true, color: true, user: { select: { firstName: true, lastName: true } } } },
  slot: { select: { id: true, day: true, startTime: true, endTime: true, group: { select: { id: true, name: true } } } },
  decidedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.CoachAbsenceInclude;

type Row = Prisma.CoachAbsenceGetPayload<{ include: typeof include }>;

/** Absences des entraîneurs : déclarées par l'entraîneur, validées par l'administration, puis groupes prévenus. */
@ApiTags('Absences des entraîneurs')
@ApiBearerAuth()
@Controller('coach-absences')
export class CoachAbsencesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.COACH)
  async list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    const rows = await this.prisma.coachAbsence.findMany({
      where: { status: q.status, coachId: user.role === Role.COACH ? (user.coachId ?? NIL_UUID) : q.coachId },
      include,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(view);
  }

  @Post()
  @Roles(Role.ADMIN, Role.COACH)
  async declare(@CurrentUser() user: AuthUser, @Body() dto: DeclareDto) {
    const isAdmin = user.role === Role.ADMIN;
    const coachId = isAdmin ? dto.coachId : user.coachId;
    if (!coachId) throw new BadRequestException('Entraîneur obligatoire.');
    if (!isAdmin && dto.date < todayIso()) throw new BadRequestException('Une absence se déclare pour aujourd’hui ou plus tard.');
    if (dto.slotId) {
      const slot = await this.prisma.groupSlot.findUnique({ where: { id: dto.slotId }, include: { coaches: true } });
      if (!slot || !slot.coaches.some((c) => c.coachId === coachId)) throw new ForbiddenException('Cette séance n’est pas animée par cet entraîneur.');
      if (slot.day !== weekday(dto.date)) throw new BadRequestException('Cette séance n’a pas lieu ce jour-là.');
    }
    const absence = await this.prisma.coachAbsence.create({
      data: {
        coachId,
        date: dayFromIso(dto.date),
        slotId: dto.slotId ?? null,
        reason: dto.reason.trim(),
        notifyGroups: dto.notifyGroups ?? true,
        ...(isAdmin ? { status: AbsenceStatus.APPROVED, decidedById: user.id, decidedAt: new Date() } : {}),
      },
      include,
    });
    await this.audit.log(user.id, {
      action: isAdmin ? 'Absence d’entraîneur saisie' : 'Absence déclarée',
      entity: 'CoachAbsence',
      entityId: absence.id,
      target: `${fullName(absence.coach.user).trim()} · ${dto.date}${absence.slot ? ' · ' + absence.slot.group.name : ''}`,
      after: isAdmin ? 'Validée' : 'À valider',
      reason: dto.reason,
    });
    if (isAdmin && absence.notifyGroups) await this.notifyGroups(absence);
    return view(absence);
  }

  /** Validation par l'administration : l'absence compte pour le salaire et les groupes sont prévenus. */
  @Post(':id/approve')
  @HttpCode(200)
  @Roles(Role.ADMIN)
  async approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.decide(user, id, AbsenceStatus.APPROVED, dto.note);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles(Role.ADMIN)
  async reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.decide(user, id, AbsenceStatus.REJECTED, dto.note);
  }

  private async decide(user: AuthUser, id: string, status: AbsenceStatus, note?: string) {
    const absence = await this.prisma.coachAbsence.findUnique({ where: { id }, include });
    if (!absence) throw notFound('Absence');
    if (absence.status !== AbsenceStatus.PENDING) throw new BadRequestException('Cette absence a déjà été traitée.');
    const updated = await this.prisma.coachAbsence.update({
      where: { id },
      data: { status, decidedById: user.id, decidedAt: new Date(), decisionNote: note?.trim() || null },
      include,
    });
    await this.audit.log(user.id, {
      action: status === AbsenceStatus.APPROVED ? 'Absence d’entraîneur validée' : 'Absence d’entraîneur refusée',
      entity: 'CoachAbsence',
      entityId: id,
      target: `${fullName(absence.coach.user).trim()} · ${isoDay(absence.date)}`,
      before: 'À valider',
      after: status === AbsenceStatus.APPROVED ? 'Validée' : 'Refusée',
      reason: note,
    });
    const notified = status === AbsenceStatus.APPROVED && updated.notifyGroups ? await this.notifyGroups(updated) : 0;
    return { ...view(updated), notified };
  }

  /** Prévient joueurs (majeurs) et parents des groupes concernés ce jour-là. Renvoie le nombre d'emails. */
  private async notifyGroups(absence: Row): Promise<number> {
    const day = isoDay(absence.date);
    const slots = await this.prisma.groupSlot.findMany({
      where: {
        day: weekday(day),
        coaches: { some: { coachId: absence.coachId } },
        group: { archivedAt: null, season: { status: 'ACTIVE' } },
        ...(absence.slotId ? { id: absence.slotId } : {}),
      },
      include: {
        group: {
          include: {
            members: {
              include: {
                enrollment: {
                  include: {
                    player: { include: { parentLinks: { include: { parent: { select: { email: true, isActive: true } } } } } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const coachName = fullName(absence.coach.user).trim();
    let sent = 0;
    for (const slot of slots) {
      const recipients = new Set<string>();
      for (const m of slot.group.members) {
        const p = m.enrollment.player;
        if (p.archivedAt) continue;
        if (p.email) recipients.add(p.email);
        for (const l of p.parentLinks) if (l.parent.isActive && l.parent.email) recipients.add(l.parent.email);
      }
      for (const to of recipients) {
        await this.mail.send(
          to,
          `Séance ${slot.group.name} du ${DAY_LONG[slot.day]} ${day} : entraîneur absent`,
          `Bonjour,\n\nL’entraîneur ${coachName} sera absent pour la séance ${slot.group.name} du ${DAY_LONG[slot.day]} ${day} (${slot.startTime} – ${slot.endTime}).\nLe club vous informera d’un éventuel remplacement.\n\nLe bureau du TCSAY`,
          'OTHER',
        );
        sent++;
      }
    }
    return sent;
  }
}

function view(a: Row) {
  return {
    id: a.id,
    date: isoDay(a.date),
    reason: a.reason,
    status: a.status,
    notifyGroups: a.notifyGroups,
    decisionNote: a.decisionNote,
    decidedAt: a.decidedAt,
    decidedBy: a.decidedBy ? fullName(a.decidedBy) : null,
    createdAt: a.createdAt,
    coach: { id: a.coach.id, color: a.coach.color, ...a.coach.user },
    slot: a.slot ? { id: a.slot.id, day: a.slot.day, startTime: a.slot.startTime, endTime: a.slot.endTime, group: a.slot.group } : null,
  };
}
