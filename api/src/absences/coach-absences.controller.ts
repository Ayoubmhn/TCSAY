import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AbsenceResolution, AbsenceStatus, Prisma, Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, can, CurrentUser, Perm, Roles } from '../auth/auth-user';
import { dayFromIso, isoDay, todayIso, weekday } from '../common/dates';
import { fullName, NIL_UUID, notFound, rule } from '../common/rules';
import { DAY_LONG, slotsOverlap } from '../common/sessions';
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

  /** Admin : saisie directe pour un entraîneur (validée d'office, avec la décision ci-dessous). */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  coachId?: string;

  @IsOptional()
  @IsEnum(AbsenceResolution, { message: 'Décision : remplacement, séance physique ou annulation.' })
  resolution?: AbsenceResolution;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  replacementCoachId?: string;
}

class DecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** Validation par la direction : que devient la séance ? */
class ApproveDto extends DecisionDto {
  @IsEnum(AbsenceResolution, { message: 'Décision : remplacement, séance physique ou annulation.' })
  resolution: AbsenceResolution;

  /** Entraîneur remplaçant (obligatoire pour un remplacement). */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  replacementCoachId?: string;
}

export const RESOLUTION_LABEL: Record<AbsenceResolution, string> = {
  REPLACED: 'Remplacement',
  PHYSICAL: 'Séance physique',
  CANCELLED: 'Séance annulée',
};

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
  replacementCoach: { select: { id: true, color: true, user: { select: { firstName: true, lastName: true } } } },
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
    if (user.role === Role.ADMIN && !can(user, 'absences.manage', 'coaches.manage', 'salaries.manage')) {
      throw new ForbiddenException('Accès refusé : autorisation « absences » manquante.');
    }
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
    if (isAdmin && !can(user, 'absences.manage')) throw new ForbiddenException('Accès refusé : autorisation « absences » manquante.');
    const coachId = isAdmin ? dto.coachId : user.coachId;
    if (!coachId) throw new BadRequestException('Entraîneur obligatoire.');
    if (isAdmin && !dto.resolution) throw new BadRequestException('Choisissez ce que devient la séance : remplacement, séance physique ou annulation.');
    if (isAdmin) await this.checkReplacement(coachId, dto.date, dto.slotId ?? null, dto.resolution!, dto.replacementCoachId);
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
        ...(isAdmin
          ? {
              status: AbsenceStatus.APPROVED,
              decidedById: user.id,
              decidedAt: new Date(),
              resolution: dto.resolution,
              replacementCoachId: dto.resolution === AbsenceResolution.REPLACED ? dto.replacementCoachId : null,
            }
          : {}),
      },
      include,
    });
    await this.audit.log(user.id, {
      action: isAdmin ? 'Absence d’entraîneur saisie' : 'Absence déclarée',
      entity: 'CoachAbsence',
      entityId: absence.id,
      target: `${fullName(absence.coach.user).trim()} · ${dto.date}${absence.slot ? ' · ' + absence.slot.group.name : ''}`,
      after: isAdmin ? `Validée · ${RESOLUTION_LABEL[dto.resolution!]}${absenceReplacementName(absence)}` : 'À valider',
      reason: dto.reason,
    });
    if (isAdmin && absence.notifyGroups) await this.notifyGroups(absence);
    return view(absence);
  }

  /** Validation par l'administration : l'absence compte pour le salaire et les groupes sont prévenus. */
  @Post(':id/approve')
  @HttpCode(200)
  @Perm('absences.manage')
  async approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto) {
    return this.decide(user, id, AbsenceStatus.APPROVED, dto.note, dto.resolution, dto.replacementCoachId);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Perm('absences.manage')
  async reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.decide(user, id, AbsenceStatus.REJECTED, dto.note);
  }

  /**
   * Remplacement : un autre entraîneur actif, libre sur l'horaire de la ou des séances concernées
   * (pas d'autre séance qui se chevauche, pas d'autre remplacement ce jour-là sur le même horaire).
   */
  private async checkReplacement(coachId: string, date: string, slotId: string | null, resolution: AbsenceResolution, replacementCoachId?: string) {
    if (resolution !== AbsenceResolution.REPLACED) return;
    if (!replacementCoachId) throw new BadRequestException('Choisissez l’entraîneur remplaçant.');
    if (replacementCoachId === coachId) throw new BadRequestException('Le remplaçant doit être un autre entraîneur.');
    const replacement = await this.prisma.coach.findUnique({ where: { id: replacementCoachId }, include: { user: true } });
    if (!replacement || !replacement.user.isActive || !replacement.user.roles.includes(Role.COACH)) throw notFound('Entraîneur remplaçant');
    const wd = weekday(date);
    const scope = { day: wd, group: { archivedAt: null, season: { status: 'ACTIVE' as const } } };
    const covered = await this.prisma.groupSlot.findMany({
      where: { ...scope, ...(slotId ? { id: slotId } : { coaches: { some: { coachId } } }) },
      include: { group: { select: { name: true } } },
    });
    const busy = await this.prisma.groupSlot.findMany({
      where: { ...scope, coaches: { some: { coachId: replacementCoachId } } },
      include: { group: { select: { name: true } } },
    });
    for (const c of covered) {
      const clash = busy.find((b) => slotsOverlap(b, c));
      if (clash) {
        throw rule.conflict(
          'R5',
          `${fullName(replacement.user).trim()} entraîne déjà « ${clash.group.name} » de ${clash.startTime} à ${clash.endTime} : il ne peut pas remplacer sur « ${c.group.name} ».`,
        );
      }
    }
  }

  private async decide(
    user: AuthUser,
    id: string,
    status: AbsenceStatus,
    note?: string,
    resolution?: AbsenceResolution,
    replacementCoachId?: string,
  ) {
    const absence = await this.prisma.coachAbsence.findUnique({ where: { id }, include });
    if (!absence) throw notFound('Absence');
    if (absence.status !== AbsenceStatus.PENDING) throw new BadRequestException('Cette absence a déjà été traitée.');
    if (status === AbsenceStatus.APPROVED) {
      await this.checkReplacement(absence.coachId, isoDay(absence.date), absence.slotId, resolution!, replacementCoachId);
    }
    const updated = await this.prisma.coachAbsence.update({
      where: { id },
      data: {
        status,
        decidedById: user.id,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
        ...(status === AbsenceStatus.APPROVED
          ? { resolution, replacementCoachId: resolution === AbsenceResolution.REPLACED ? replacementCoachId : null }
          : {}),
      },
      include,
    });
    await this.audit.log(user.id, {
      action: status === AbsenceStatus.APPROVED ? 'Absence d’entraîneur validée' : 'Absence d’entraîneur refusée',
      entity: 'CoachAbsence',
      entityId: id,
      target: `${fullName(absence.coach.user).trim()} · ${isoDay(absence.date)}`,
      before: 'À valider',
      after:
        status === AbsenceStatus.APPROVED ? `Validée · ${RESOLUTION_LABEL[resolution!]}${absenceReplacementName(updated)}` : 'Refusée',
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
    const replacementName = absence.replacementCoach ? fullName(absence.replacementCoach.user).trim() : null;
    const outcome =
      absence.resolution === AbsenceResolution.REPLACED
        ? `La séance est maintenue avec l’entraîneur ${replacementName}.`
        : absence.resolution === AbsenceResolution.PHYSICAL
          ? 'La séance est maintenue sous forme de séance physique.'
          : 'La séance est annulée.';
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
          `Séance ${slot.group.name} du ${DAY_LONG[slot.day]} ${day} : ${RESOLUTION_LABEL[absence.resolution ?? AbsenceResolution.CANCELLED].toLowerCase()}`,
          `Bonjour,\n\nL’entraîneur ${coachName} sera absent pour la séance ${slot.group.name} du ${DAY_LONG[slot.day]} ${day} (${slot.startTime} – ${slot.endTime}).\n${outcome}\n\nLe bureau du TCSAY`,
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
    resolution: a.resolution,
    replacementCoach: a.replacementCoach ? { id: a.replacementCoach.id, color: a.replacementCoach.color, ...a.replacementCoach.user } : null,
    slot: a.slot ? { id: a.slot.id, day: a.slot.day, startTime: a.slot.startTime, endTime: a.slot.endTime, group: a.slot.group } : null,
  };
}

function absenceReplacementName(a: Row): string {
  return a.replacementCoach ? ` par ${fullName(a.replacementCoach.user).trim()}` : '';
}
