import { NIL_UUID } from '../common/rules';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, ReservationType, Role } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { addDaysIso, localDayOf, localInstant, pad, todayIso } from '../common/dates';
import { num } from '../common/money';
import { fullName, notFound, rule } from '../common/rules';
import { groupOccupiesHour } from '../common/sessions';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export type SlotState = 'free' | 'mine' | 'taken' | 'group' | 'maintenance' | 'unlit' | 'past';

const include = {
  court: { select: { id: true, name: true } },
  player: { select: { id: true, firstName: true, lastName: true } },
  coach: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
  bookedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ReservationInclude;

type Row = Prisma.ReservationGetPayload<{ include: typeof include }>;

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** Grille heures × terrains d'un jour, vue par l'utilisateur (« mine » = ses réservations ou celles de l'enfant choisi). */
  async grid(user: AuthUser, day: string, playerId?: string) {
    const s = await this.settings.all();
    const ownPlayer =
      user.role === Role.PLAYER || user.role === Role.PARENT ? await this.access.resolvePlayer(user, playerId) : null;
    const [courts, reservations, season] = await Promise.all([
      this.prisma.court.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.reservation.findMany({ where: { activeKey: { not: null }, ...this.dayRange(day) } }),
      this.prisma.season.findFirst({ where: { status: 'ACTIVE', archivedAt: null } }),
    ]);
    const groups = season
      ? await this.prisma.trainingGroup.findMany({ where: { seasonId: season.id, archivedAt: null, courtId: { not: null } } })
      : [];
    const now = new Date();
    const hours = Array.from({ length: s.closingHour - s.openingHour }, (_, i) => s.openingHour + i);

    const slots = courts.map((court) => ({
      courtId: court.id,
      hours: hours.map((hour) => {
        const state = ((): SlotState => {
          if (localInstant(day, hour) < now) return 'past';
          if (!court.active || court.maintenance) return 'maintenance';
          if (!court.lit && hour >= s.nightStartHour) return 'unlit';
          const r = reservations.find((x) => x.courtId === court.id && x.startTime.getHours() === hour);
          if (r) {
            const mine = user.role === Role.COACH ? r.coachId === user.coachId : ownPlayer !== null && r.playerId === ownPlayer;
            return mine ? 'mine' : 'taken';
          }
          if (groups.some((g) => g.courtId === court.id && groupOccupiesHour(g, day, hour))) return 'group';
          return 'free';
        })();
        return { hour, state };
      }),
    }));

    return {
      date: day,
      hours,
      nightStartHour: s.nightStartHour,
      courts: courts.map((c) => ({ id: c.id, name: c.name, lit: c.lit, maintenance: c.maintenance, active: c.active })),
      slots,
    };
  }

  /** Réservations de l'utilisateur (joueur/parent : du joueur choisi ; coach : ses séances privées). */
  async mine(user: AuthUser, playerId?: string) {
    const where: Prisma.ReservationWhereInput =
      user.role === Role.COACH
        ? { coachId: user.coachId ?? NIL_UUID }
        : { playerId: await this.access.resolvePlayer(user, playerId) };
    const rows = await this.prisma.reservation.findMany({
      where: { ...where, activeKey: { not: null }, startTime: { gte: localInstant(addDaysIso(todayIso(), -30), 0) } },
      include,
      orderBy: { startTime: 'asc' },
    });
    return rows.map((r) => this.view(r));
  }

  /** Admin : réservations actives d'un jour. */
  async byDay(day: string) {
    const rows = await this.prisma.reservation.findMany({
      where: { activeKey: { not: null }, ...this.dayRange(day) },
      include,
      orderBy: [{ startTime: 'asc' }, { court: { sortOrder: 'asc' } }],
    });
    return rows.map((r) => this.view(r));
  }

  async create(user: AuthUser, dto: { courtId: string; date: string; hour: number; playerId?: string; type?: ReservationType }) {
    const s = await this.settings.all();
    if (dto.hour < s.openingHour || dto.hour >= s.closingHour) {
      throw new BadRequestException(`Créneaux de ${s.openingHour}h à ${s.closingHour}h.`);
    }
    const start = localInstant(dto.date, dto.hour);
    const end = localInstant(dto.date, dto.hour + 1);
    if (start <= new Date()) throw rule.conflict('R10', 'Créneau passé : réservation impossible.');

    const court = await this.prisma.court.findUnique({ where: { id: dto.courtId } });
    if (!court) throw notFound('Terrain');
    if (!court.active || court.maintenance) throw new ConflictException(`${court.name} est en entretien ou désactivé.`);
    if (!court.lit && dto.hour >= s.nightStartHour) {
      throw new ConflictException('Ce terrain n’est pas éclairé : réservation impossible la nuit.');
    }

    // Qui réserve, pour qui, quel type.
    let type: ReservationType = ReservationType.LEISURE;
    let playerId: string | null = null;
    let coachId: string | null = null;
    if (user.role === Role.COACH) {
      if (!dto.playerId) throw new BadRequestException('Choisissez l’élève de la séance privée.');
      type = ReservationType.PRIVATE;
      coachId = user.coachId;
      playerId = dto.playerId;
    } else if (user.role === Role.ADMIN) {
      type = dto.type ?? ReservationType.LEISURE;
      playerId = dto.playerId ?? null;
    } else {
      playerId = await this.access.resolvePlayer(user, dto.playerId);
    }
    if (playerId) {
      const player = await this.prisma.player.findUnique({ where: { id: playerId } });
      if (!player || player.archivedAt) throw notFound('Joueur');
    }

    // Créneau occupé par un groupe d'entraînement de la saison active.
    const groups = await this.prisma.trainingGroup.findMany({
      where: { courtId: court.id, archivedAt: null, season: { status: 'ACTIVE' } },
    });
    const busy = groups.find((g) => groupOccupiesHour(g, dto.date, dto.hour));
    if (busy) throw new ConflictException(`Créneau réservé à l’entraînement « ${busy.name} ».`);

    const rate = await this.prisma.courtRate.findUnique({
      where: { type_period: { type, period: dto.hour >= s.nightStartHour ? 'NIGHT' : 'DAY' } },
    });
    if (!rate) throw new BadRequestException('Tarif terrain manquant : renseignez les tarifs terrains.');

    try {
      const r = await this.prisma.reservation.create({
        data: {
          courtId: court.id,
          playerId,
          coachId,
          type,
          startTime: start,
          endTime: end,
          price: rate.pricePerHour,
          bookedById: user.id,
          activeKey: `${court.id}|${start.toISOString()}`, // pas de double réservation
        },
        include,
      });
      return this.view(r);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Créneau déjà pris : pas de double réservation.');
      }
      throw e;
    }
  }

  /** R10 : annulation refusée à moins du délai paramétré ; l'admin peut forcer avec un motif. */
  async cancel(user: AuthUser, id: string, reason?: string) {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include });
    if (!r || !r.activeKey) throw notFound('Réservation');
    if (r.startTime <= new Date()) throw rule.conflict('R10', 'Créneau passé : modification impossible.');

    const isAdmin = user.role === Role.ADMIN;
    if (!isAdmin) {
      const own = await this.access.ownPlayerIds(user);
      const allowed =
        r.bookedById === user.id ||
        (r.playerId !== null && own.includes(r.playerId)) ||
        (user.role === Role.COACH && r.coachId === user.coachId);
      if (!allowed) throw new ForbiddenException('Cette réservation n’est pas la vôtre.');
      const { cancelDelayHours } = await this.settings.all();
      if (r.startTime.getTime() - Date.now() < cancelDelayHours * 3600_000) {
        throw rule.conflict('R10', `Annulation impossible à moins de ${cancelDelayHours} h du créneau. Contactez le club.`);
      }
    } else if (!reason?.trim()) {
      throw new BadRequestException('Le motif est obligatoire.');
    }

    await this.prisma.reservation.update({
      where: { id },
      data: { activeKey: null, cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason?.trim() || null },
    });
    const label = `${r.court.name} ${localDayOf(r.startTime)} ${pad(r.startTime.getHours())}h`;
    if (isAdmin) {
      await this.audit.log(user.id, {
        action: 'Réservation annulée (forcée)',
        entity: 'Reservation',
        entityId: id,
        target: label,
        before: 'Confirmée',
        after: 'Annulée',
        reason,
      });
      await this.notifyForcedCancel(r, label, reason ?? '');
    }
    return { ok: true };
  }

  private async notifyForcedCancel(r: Row, label: string, reason: string) {
    if (!r.playerId) return;
    const player = await this.prisma.player.findUnique({
      where: { id: r.playerId },
      include: { parentLinks: { include: { parent: true } } },
    });
    const to = player?.email ?? player?.parentLinks[0]?.parent.email;
    if (!player || !to) return;
    await this.mail.send(
      to,
      `Réservation annulée : ${label}`,
      `Bonjour,\n\nLa réservation de ${fullName(player)} (${label}) a été annulée par le club.\nMotif : ${reason}\n\nLe bureau du TCSAY`,
      'RESERVATION',
    );
  }

  private dayRange(day: string) {
    return { startTime: { gte: localInstant(day, 0), lt: localInstant(addDaysIso(day, 1), 0) } };
  }

  view(r: Row) {
    return {
      id: r.id,
      date: localDayOf(r.startTime),
      hour: r.startTime.getHours(),
      startTime: r.startTime,
      type: r.type,
      price: num(r.price),
      court: r.court,
      player: r.player,
      coach: r.coach ? { id: r.coach.id, ...r.coach.user } : null,
      bookedBy: r.bookedBy ? fullName(r.bookedBy) : null,
    };
  }
}
