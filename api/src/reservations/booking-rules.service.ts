import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Court, Prisma, ReservationType, Role } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { PaymentAccessService } from '../access/payment-access.service';
import { AuthUser } from '../auth/auth-user';
import { addDaysIso, dayFromIso, localDayOf, localInstant, todayIso, weekday } from '../common/dates';
import { fullName } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** Règles de réservation réglées par le président (valeurs proposées, à confirmer avec le bureau). */
export type BookingRules = {
  /** Réservations à venir en même temps : par compte, par famille (0 = sans limite). */
  maxUpcomingAccount: number;
  maxUpcomingFamily: number;
  /** Heures réservées par semaine (lundi → dimanche) et par famille. */
  maxHoursWeek: number;
  /** Réservations par jour et par joueur. */
  maxPerDayPlayer: number;
  /** Réservation possible jusqu'à N jours à l'avance. */
  advanceDays: number;
  /** Heures demandées (le soir dès la nuit, ou le week-end) : réservations par semaine et par famille. */
  peakPerWeek: number;
  /** Annulations par mois : au-delà, blocage automatique. */
  cancelsPerMonth: number;
  /** Absences sans annuler (sur 90 jours) : au-delà, blocage automatique. */
  noShowLimit: number;
  /** Durée des blocages automatiques (jours). */
  blockDays: number;
  /** Filet de sécurité : tentatives de réservation par heure, par appareil et par adresse IP. */
  attemptsPerHour: number;
  /** Pas de réservation tant qu'une tranche de cotisation échue n'est pas payée. */
  noArrears: boolean;
};

export const RULE_DEFAULTS: BookingRules = {
  maxUpcomingAccount: 2,
  maxUpcomingFamily: 3,
  maxHoursWeek: 4,
  maxPerDayPlayer: 1,
  advanceDays: 7,
  peakPerWeek: 1,
  cancelsPerMonth: 3,
  noShowLimit: 2,
  blockDays: 15,
  attemptsPerHour: 10,
  noArrears: true,
};

const RULES_KEY = 'reservation.rules';
const HOUR = 3600_000;

export type Origin = { ip: string | null; deviceId: string | null };

const pad = (n: number) => String(n).padStart(2, '0');
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

/**
 * Réservation sécurisée : terrains ouverts à la réservation (qui, jours, heures, soir, fermetures), limites par compte et
 * par famille, blocages (manuels ou automatiques), filet de sécurité par appareil et adresse IP, alertes à la direction.
 * Tout est vérifié côté API ; la direction (espace administration) n'est pas soumise aux limites.
 */
@Injectable()
export class BookingRulesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Réservations');
  private readonly attempts = new Map<string, number[]>();
  /** Refus récents (alertes « tentatives répétées ») : clé appareil ou IP → instants. */
  private readonly refusals = new Map<string, number[]>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
    private readonly gate: PaymentAccessService,
  ) {}

  onApplicationBootstrap() {
    // Protection des données : l'adresse IP d'une réservation est effacée après 30 jours.
    const purge = () =>
      this.prisma.reservation
        .updateMany({ where: { ip: { not: null }, createdAt: { lt: new Date(Date.now() - 30 * 24 * HOUR) } }, data: { ip: null } })
        .catch((e) => this.logger.warn(String(e)));
    void purge();
    this.timer = setInterval(() => void purge(), 6 * HOUR);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async rules(): Promise<BookingRules> {
    const row = await this.prisma.setting.findUnique({ where: { key: RULES_KEY } });
    if (!row) return { ...RULE_DEFAULTS };
    try {
      return { ...RULE_DEFAULTS, ...(JSON.parse(row.value) as Partial<BookingRules>) };
    } catch {
      return { ...RULE_DEFAULTS };
    }
  }

  async saveRules(next: BookingRules) {
    await this.prisma.setting.upsert({ where: { key: RULES_KEY }, create: { key: RULES_KEY, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
    return next;
  }

  // ───── Terrains ouverts à la réservation ─────

  /** Le terrain apparaît-il dans la grille de ce compte ? */
  visibleTo(court: Court, user: AuthUser) {
    if (user.role === Role.ADMIN) return true;
    if (court.physicalOnly) return false;
    return user.role === Role.COACH ? court.bookCoaches : court.bookFamilies;
  }

  /** Fermetures ponctuelles des terrains pour un jour. */
  async closures(day: string) {
    const d = dayFromIso(day);
    return this.prisma.courtClosure.findMany({ where: { fromDate: { lte: d }, toDate: { gte: d } } });
  }

  /** Raison pour laquelle la demi-heure [start, end[ n'est pas ouverte à la réservation (null = ouverte). */
  closedReason(court: Court, day: string, start: number, end: number, nightStart: number, closures: { courtId: string; reason: string }[], user: AuthUser): string | null {
    if (user.role === Role.ADMIN) return null;
    const c = closures.find((x) => x.courtId === court.id);
    if (c) return `Fermé à la réservation : ${c.reason}`;
    if (!court.bookDays.includes(weekday(day))) return `${court.name} n’est pas ouvert à la réservation ce jour-là.`;
    if (court.bookFrom && start < minutes(court.bookFrom)) return `${court.name} : réservation à partir de ${court.bookFrom}.`;
    if (court.bookTo && end > minutes(court.bookTo)) return `${court.name} : réservation jusqu’à ${court.bookTo}.`;
    if (!court.bookNight && end > nightStart * 60) return `${court.name} n’est pas réservable le soir.`;
    return null;
  }

  // ───── Filet de sécurité : appareil et adresse IP ─────

  /** Compte une tentative (appareil + IP) et refuse au-delà de la limite horaire. */
  async throttle(origin: Origin) {
    const { attemptsPerHour } = await this.rules();
    if (!attemptsPerHour) return;
    const now = Date.now();
    for (const key of [origin.deviceId && `d:${origin.deviceId}`, origin.ip && `i:${origin.ip}`].filter((k): k is string => Boolean(k))) {
      const list = (this.attempts.get(key) ?? []).filter((t) => now - t < HOUR);
      list.push(now);
      this.attempts.set(key, list);
      if (list.length > attemptsPerHour) {
        this.refused(origin);
        throw new HttpException('Trop de tentatives de réservation : réessayez dans une heure.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    if (this.attempts.size > 5000) for (const [k, v] of this.attempts) if (!v.some((t) => now - t < HOUR)) this.attempts.delete(k);
  }

  /** Note un refus (alerte « tentatives répétées »). */
  refused(origin: Origin) {
    const now = Date.now();
    for (const key of [origin.deviceId && `appareil ${origin.deviceId.slice(0, 6)}`, origin.ip && `adresse ${origin.ip}`].filter((k): k is string => Boolean(k))) {
      const list = (this.refusals.get(key) ?? []).filter((t) => now - t < 24 * HOUR);
      list.push(now);
      this.refusals.set(key, list);
    }
  }

  // ───── Limites par compte et par famille ─────

  /** Joueurs de la famille du compte (ses enfants, lui-même). */
  private family(user: AuthUser) {
    return this.access.ownPlayerIds(user);
  }

  private weekBounds(day: string) {
    const monday = addDaysIso(day, -((weekday(day) + 6) % 7));
    return { from: localInstant(monday, 0), to: localInstant(addDaysIso(monday, 7), 0) };
  }

  private isPeak(day: string, startMin: number, nightStart: number) {
    const wd = weekday(day);
    return wd === 0 || wd === 6 || startMin >= nightStart * 60;
  }

  /** Blocage en cours du compte (le plus long). */
  activeBlock(userId: string) {
    return this.prisma.reservationBlock.findFirst({ where: { userId, liftedAt: null, until: { gt: new Date() } }, orderBy: { until: 'desc' } });
  }

  /** Utilisation actuelle (affichée à la famille) : réservations à venir, heures de la semaine, heures demandées. */
  async usage(user: AuthUser, day: string) {
    const r = await this.rules();
    const s = await this.settings.all();
    const family = user.role === Role.PLAYER || user.role === Role.PARENT ? await this.family(user) : [];
    const familyWhere: Prisma.ReservationWhereInput = { OR: [{ bookedById: user.id }, ...(family.length ? [{ playerId: { in: family } }] : [])] };
    const now = new Date();
    const { from, to } = this.weekBounds(day);
    const [account, fam, week, block] = await Promise.all([
      this.prisma.reservation.count({ where: { bookedById: user.id, activeKey: { not: null }, startTime: { gt: now }, type: { in: [ReservationType.LEISURE, ReservationType.PRIVATE] } } }),
      this.prisma.reservation.count({ where: { ...familyWhere, activeKey: { not: null }, startTime: { gt: now }, type: ReservationType.LEISURE } }),
      this.prisma.reservation.findMany({ where: { ...familyWhere, activeKey: { not: null }, startTime: { gte: from, lt: to }, type: ReservationType.LEISURE }, select: { startTime: true, endTime: true } }),
      this.activeBlock(user.id),
    ]);
    const hours = week.reduce((n, x) => n + (x.endTime.getTime() - x.startTime.getTime()) / HOUR, 0);
    const peak = week.filter((x) => this.isPeak(localDayOf(x.startTime), minutesOfDay(x.startTime), s.nightStartHour)).length;
    return {
      rules: r,
      upcomingAccount: account,
      upcomingFamily: fam,
      hoursWeek: Math.round(hours * 10) / 10,
      peakWeek: peak,
      lastDay: addDaysIso(todayIso(), r.advanceDays),
      block: block ? { until: block.until, reason: block.reason } : null,
    };
  }

  /**
   * Vérifie qu'une réservation est permise (familles et entraîneurs ; la direction n'est pas limitée).
   * Messages clairs, affichés en toast.
   */
  async assertAllowed(user: AuthUser, p: { court: Court; day: string; startMin: number; endMin: number; playerId: string | null; nightStart: number }) {
    if (user.role === Role.ADMIN) return;
    const r = await this.rules();
    if (!this.visibleTo(p.court, user)) throw new ForbiddenException(`${p.court.name} n’est pas ouvert à la réservation en ligne.`);
    const closed = this.closedReason(p.court, p.day, p.startMin, p.endMin, p.nightStart, await this.closures(p.day), user);
    if (closed) throw new ForbiddenException(closed);
    const block = await this.activeBlock(user.id);
    if (block) throw new ForbiddenException(`Réservation suspendue jusqu’au ${localDayOf(block.until).split('-').reverse().join('/')} : ${block.reason}. Contactez le club.`);
    if (r.advanceDays && p.day > addDaysIso(todayIso(), r.advanceDays)) throw new ForbiddenException(`Réservation possible jusqu’à ${r.advanceDays} jours à l’avance.`);
    if (user.role === Role.COACH) return;

    const u = await this.usage(user, p.day);
    if (r.maxUpcomingAccount && u.upcomingAccount >= r.maxUpcomingAccount) throw new ForbiddenException(`Limite atteinte : ${r.maxUpcomingAccount} réservation${r.maxUpcomingAccount > 1 ? 's' : ''} à venir par compte.`);
    if (r.maxUpcomingFamily && u.upcomingFamily >= r.maxUpcomingFamily) throw new ForbiddenException(`Limite atteinte : ${r.maxUpcomingFamily} réservations à venir par famille.`);
    if (r.maxHoursWeek && u.hoursWeek + (p.endMin - p.startMin) / 60 > r.maxHoursWeek) throw new ForbiddenException(`Limite atteinte : ${r.maxHoursWeek} h par semaine et par famille (déjà ${u.hoursWeek} h).`);
    if (r.peakPerWeek && this.isPeak(p.day, p.startMin, p.nightStart) && u.peakWeek >= r.peakPerWeek) {
      throw new ForbiddenException(`Limite atteinte : ${r.peakPerWeek} réservation${r.peakPerWeek > 1 ? 's' : ''} le soir ou le week-end par semaine.`);
    }
    if (p.playerId && r.maxPerDayPlayer) {
      const sameDay = await this.prisma.reservation.count({
        where: { playerId: p.playerId, activeKey: { not: null }, type: ReservationType.LEISURE, startTime: { gte: localInstant(p.day, 0), lt: localInstant(addDaysIso(p.day, 1), 0) } },
      });
      if (sameDay >= r.maxPerDayPlayer) throw new ForbiddenException(`Limite atteinte : ${r.maxPerDayPlayer} réservation${r.maxPerDayPlayer > 1 ? 's' : ''} par jour et par joueur.`);
    }
    if (r.noArrears && p.playerId) {
      if (await this.gate.overdue(p.playerId, 0)) {
        throw new ForbiddenException('Réservation impossible : une tranche de cotisation échue n’est pas payée.');
      }
    }
  }

  /** Après une annulation par la famille : blocage automatique au-delà de la limite mensuelle. */
  async afterCancel(user: AuthUser) {
    if (user.role === Role.ADMIN) return null;
    const r = await this.rules();
    if (!r.cancelsPerMonth) return null;
    const since = new Date(Date.now() - 30 * 24 * HOUR);
    const n = await this.prisma.reservation.count({ where: { cancelledById: user.id, cancelledAt: { gte: since }, type: { in: [ReservationType.LEISURE, ReservationType.PRIVATE] } } });
    if (n > r.cancelsPerMonth && !(await this.activeBlock(user.id))) {
      return this.block(user.id, `${n} annulations en 30 jours`, r.blockDays, null, true);
    }
    return null;
  }

  /** Absence sans annuler signalée : blocage automatique au-delà de la limite (sur 90 jours). */
  async afterNoShow(userId: string) {
    const r = await this.rules();
    if (!r.noShowLimit) return null;
    const n = await this.prisma.reservation.count({ where: { bookedById: userId, noShowAt: { gte: new Date(Date.now() - 90 * 24 * HOUR) } } });
    if (n >= r.noShowLimit && !(await this.activeBlock(userId))) return this.block(userId, `${n} absences sans annuler`, r.blockDays, null, true);
    return null;
  }

  async block(userId: string, reason: string, days: number, byId: string | null, automatic = false) {
    const b = await this.prisma.reservationBlock.create({ data: { userId, reason, until: new Date(Date.now() + days * 24 * HOUR), createdById: byId, automatic } });
    await this.prisma.notification.create({
      data: { userId, kind: 'OTHER', title: 'Réservation suspendue', body: `Jusqu’au ${localDayOf(b.until).split('-').reverse().join('/')} : ${reason}.`, link: '/reserver' },
    });
    return b;
  }

  // ───── Alertes à la direction ─────

  async alerts() {
    const r = await this.rules();
    const since30 = new Date(Date.now() - 30 * 24 * HOUR);
    const [cancels, devices, recent] = await Promise.all([
      this.prisma.reservation.groupBy({ by: ['cancelledById'], where: { cancelledAt: { gte: since30 }, cancelledById: { not: null }, type: { in: [ReservationType.LEISURE, ReservationType.PRIVATE] } }, _count: true }),
      this.prisma.reservation.groupBy({ by: ['deviceId', 'bookedById'], where: { deviceId: { not: null }, createdAt: { gte: since30 } } }),
      this.prisma.reservation.findMany({
        where: { type: ReservationType.LEISURE, startTime: { gte: new Date(Date.now() - 28 * 24 * HOUR) }, cancelledAt: null },
        select: { courtId: true, startTime: true, bookedById: true, court: { select: { name: true } } },
      }),
    ]);
    const s = await this.settings.all();
    const out: { level: 'warn' | 'info'; text: string; userId?: string }[] = [];
    const names = async (ids: string[]) => new Map((await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, fullName(u).trim()]));
    // Annulations répétées (admins exclus : annulations forcées).
    const staff = new Set((await this.prisma.user.findMany({ where: { roles: { hasSome: [Role.PRESIDENT, Role.ADMIN_AGENT, Role.SUPERVISOR, Role.TECH_DIRECTOR] } }, select: { id: true } })).map((u) => u.id));
    const heavy = cancels.filter((c) => c.cancelledById && !staff.has(c.cancelledById) && c._count >= Math.max(2, r.cancelsPerMonth));
    const devMap = new Map<string, Set<string>>();
    devices.forEach((d) => d.deviceId && devMap.set(d.deviceId, (devMap.get(d.deviceId) ?? new Set()).add(d.bookedById)));
    const shared = [...devMap.values()].filter((v) => v.size >= 3);
    // Même compte, même terrain, même créneau demandé chaque semaine (4 semaines).
    const habit = new Map<string, { n: number; court: string; userId: string; when: string }>();
    for (const x of recent) {
      const day = localDayOf(x.startTime);
      const min = minutesOfDay(x.startTime);
      if (!this.isPeak(day, min, s.nightStartHour)) continue;
      const key = `${x.bookedById}|${x.courtId}|${weekday(day)}|${min}`;
      const h = habit.get(key) ?? { n: 0, court: x.court.name, userId: x.bookedById, when: `${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][weekday(day)]} ${pad(Math.floor(min / 60))}:${pad(min % 60)}` };
      h.n++;
      habit.set(key, h);
    }
    const habits = [...habit.values()].filter((h) => h.n >= 4);
    const who = await names([...heavy.map((c) => c.cancelledById!), ...habits.map((h) => h.userId)]);
    heavy.forEach((c) => out.push({ level: 'warn', text: `${who.get(c.cancelledById!) ?? 'Un compte'} : ${c._count} annulations en 30 jours`, userId: c.cancelledById! }));
    shared.forEach((v) => out.push({ level: 'warn', text: `${v.size} comptes réservent depuis le même appareil` }));
    habits.forEach((h) => out.push({ level: 'info', text: `${h.court} le ${h.when} : ${who.get(h.userId) ?? 'même compte'} ${h.n} semaines de suite`, userId: h.userId }));
    const now = Date.now();
    for (const [k, v] of this.refusals) {
      const n = v.filter((t) => now - t < 24 * HOUR).length;
      if (n >= 5) out.push({ level: 'info', text: `${n} tentatives refusées en 24 h depuis ${k.startsWith('adresse') ? 'une même adresse' : 'un même appareil'}` });
    }
    return out;
  }
}
