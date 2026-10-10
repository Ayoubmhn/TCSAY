import { NIL_UUID } from '../common/rules';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, ReservationType, Role } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { addDaysIso, localDayOf, localInstant, pad, todayIso, weekday } from '../common/dates';
import { num } from '../common/money';
import { fullName, notFound, rule } from '../common/rules';
import { periodSelect, slotOccupies, withPeriod } from '../common/sessions';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export type SlotState = 'free' | 'short' | 'mine' | 'taken' | 'group' | 'maintenance' | 'unlit' | 'past';

/**
 * Une réservation commence à l'heure pile ou à la demi-heure (ex. 17:30) et dure une heure au moins,
 * par tranches de 30 min consécutives sur le même terrain (ex. 17:30 → 19:30).
 * Durée maximale provisoire : 4 h (à confirmer avec le bureau).
 */
export const BOOKING_MINUTES = 60;
export const BOOKING_STEP = 30;
export const BOOKING_MAX_MINUTES = 240;

/** 1050 → « 17:30 ». */
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
/** Minutes depuis minuit (heure du club) d'un instant. */
const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
/** Instant local du club à `min` minutes après minuit du jour donné. */
const instantAt = (day: string, min: number) => localInstant(day, hhmm(min));

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
    const groupSlots = season
      ? (
          await this.prisma.groupSlot.findMany({
            where: { group: { seasonId: season.id, archivedAt: null }, courtId: { not: null }, day: weekday(day) },
            include: { group: { select: periodSelect } },
          })
        ).map(withPeriod)
      : [];
    const now = new Date();
    // Départs possibles toutes les 30 min ; la dernière réservation se termine à la fermeture.
    const times: number[] = [];
    // Une ligne par demi-heure jusqu'à la fermeture (la dernière ne peut que prolonger une réservation).
    for (let m = s.openingHour * 60; m + BOOKING_STEP <= s.closingHour * 60; m += BOOKING_STEP) times.push(m);
    const closing = s.closingHour * 60;
    const night = s.nightStartHour * 60;

    // Chaque ligne montre l'occupation réelle de sa demi-heure [t, t + 30 min[ ;
    // « short » : demi-heure libre mais la suivante ne l'est pas (impossible d'y commencer une heure de jeu).
    const slots = courts.map((court) => {
      const block = (start: number): SlotState => {
        const end = start + BOOKING_STEP;
        if (end > closing) return 'past';
        if (!court.active || court.maintenance) return 'maintenance';
        if (!court.lit && end > night) return 'unlit';
        const r = reservations.find(
          (x) => x.courtId === court.id && minutesOfDay(x.startTime) < end && start < minutesOfDay(x.endTime),
        );
        if (r) {
          const mine = user.role === Role.COACH ? r.coachId === user.coachId : ownPlayer !== null && r.playerId === ownPlayer;
          return mine ? 'mine' : 'taken';
        }
        if (groupSlots.some((g) => g.courtId === court.id && slotOccupies(g, day, start, BOOKING_STEP))) return 'group';
        return 'free';
      };
      return {
        courtId: court.id,
        times: times.map((start) => {
          const own = block(start);
          let state: SlotState = own;
          if (instantAt(day, start) < now) state = 'past';
          else if (own === 'free') {
            for (let m = start + BOOKING_STEP; m < start + BOOKING_MINUTES; m += BOOKING_STEP) {
              if (block(m) !== 'free') state = 'short';
            }
          }
          return { time: hhmm(start), state };
        }),
      };
    });

    return {
      date: day,
      times: times.map(hhmm),
      durationMinutes: BOOKING_MINUTES,
      maxDurationMinutes: BOOKING_MAX_MINUTES,
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

  async create(
    user: AuthUser,
    dto: {
      courtId: string;
      date: string;
      time?: string;
      hour?: number;
      duration?: number;
      playerId?: string;
      type?: ReservationType;
    },
  ) {
    const s = await this.settings.all();
    // Départ « HH:MM » à l'heure pile ou à la demi-heure (« hour » accepté pour compatibilité).
    const startMin = dto.time ? Number(dto.time.slice(0, 2)) * 60 + Number(dto.time.slice(3, 5)) : (dto.hour ?? -1) * 60;
    const duration = dto.duration ?? BOOKING_MINUTES;
    const endMin = startMin + duration;
    if (startMin % BOOKING_STEP !== 0) throw new BadRequestException('Départ à l’heure pile ou à la demi-heure (ex. 17:30).');
    if (duration % BOOKING_STEP !== 0 || duration < BOOKING_MINUTES || duration > BOOKING_MAX_MINUTES) {
      throw new BadRequestException(`Durée : de 1 h à ${BOOKING_MAX_MINUTES / 60} h, par tranches de 30 min.`);
    }
    if (startMin < s.openingHour * 60 || endMin > s.closingHour * 60) {
      throw new BadRequestException(`Créneaux de ${s.openingHour}h à ${s.closingHour}h : la réservation doit finir avant la fermeture.`);
    }
    const start = instantAt(dto.date, startMin);
    const end = instantAt(dto.date, endMin);
    const label = (courtName: string) => `${courtName} ${dto.date} ${hhmm(startMin)}–${hhmm(endMin)}`;
    if (start <= new Date()) throw rule.conflict('R10', 'Créneau passé : réservation impossible.');

    const court = await this.prisma.court.findUnique({ where: { id: dto.courtId } });
    if (!court) throw notFound('Terrain');
    if (!court.active || court.maintenance) throw new ConflictException(`${court.name} est en entretien ou désactivé.`);
    const night = s.nightStartHour * 60;
    if (!court.lit && endMin > night) {
      throw new ConflictException(`Ce terrain n’est pas éclairé : pas de jeu après ${s.nightStartHour}h.`);
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
    const slots = (
      await this.prisma.groupSlot.findMany({
        where: { courtId: court.id, group: { archivedAt: null, season: { status: 'ACTIVE' } } },
        include: { group: { select: { name: true, ...periodSelect } } },
      })
    ).map(withPeriod);
    const busy = slots.find((g) => slotOccupies(g, dto.date, startMin, duration));
    if (busy) throw new ConflictException(`Créneau réservé à l’entraînement « ${busy.group.name} ».`);

    // Prix à l'heure, au prorata jour / nuit (ex. 17:30–18:30 : 30 min de jour + 30 min de nuit).
    const nightMin = Math.max(0, endMin - Math.max(startMin, night));
    const dayMin = duration - nightMin;
    const rates = await this.prisma.courtRate.findMany({ where: { type } });
    const rateOf = (period: 'DAY' | 'NIGHT') => rates.find((r) => r.period === period);
    if ((dayMin && !rateOf('DAY')) || (nightMin && !rateOf('NIGHT'))) {
      throw new BadRequestException('Tarif terrain manquant : renseignez les tarifs terrains.');
    }
    const price =
      Math.round(((dayMin * num(rateOf('DAY')?.pricePerHour)) / 60 + (nightMin * num(rateOf('NIGHT')?.pricePerHour)) / 60) * 1000) / 1000;

    try {
      // Pas de double réservation ni de chevauchement : verrou par terrain le temps de vérifier et d'écrire.
      const r = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${court.id}))`;
        const overlap = await tx.reservation.findFirst({
          where: { courtId: court.id, activeKey: { not: null }, startTime: { lt: end }, endTime: { gt: start } },
        });
        if (overlap) {
          throw new ConflictException(
            `Créneau déjà pris (${hhmm(minutesOfDay(overlap.startTime))} – ${hhmm(minutesOfDay(overlap.endTime))}) : pas de double réservation.`,
          );
        }
        return tx.reservation.create({
          data: {
            courtId: court.id,
            playerId,
            coachId,
            type,
            startTime: start,
            endTime: end,
            price,
            bookedById: user.id,
            activeKey: `${court.id}|${start.toISOString()}`,
          },
          include,
        });
      });
      if (user.role === Role.COACH) {
        await this.audit.log(user.id, {
          action: 'Séance privée réservée',
          entity: 'Reservation',
          entityId: r.id,
          target: label(court.name),
          after: r.player ? fullName(r.player) : null,
        });
      }
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
    const label = `${r.court.name} ${localDayOf(r.startTime)} ${hhmm(minutesOfDay(r.startTime))}`;
    if (user.role === Role.COACH) {
      await this.audit.log(user.id, { action: 'Séance privée annulée', entity: 'Reservation', entityId: id, target: label });
    }
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
      time: hhmm(minutesOfDay(r.startTime)),
      endTimeLabel: hhmm(minutesOfDay(r.endTime)),
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
