import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EmailKind, EventAudience, Prisma, Role, SeasonStatus } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { AuthUser, can } from '../auth/auth-user';
import { signUrl } from '../auth/jwt';
import { addDaysIso, dayFromIso, todayIso } from '../common/dates';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';

const EVERY_MS = 60 * 60_000;
const DAY = 86_400_000;
/** Rappel envoyé la veille à partir de cette heure (Tunis). */
const REMIND_FROM_HOUR = 9;

/** Événement sans l'image de l'affiche (champs utiles à l'audience). */
export type EventRef = Pick<Prisma.EventGetPayload<{ include: { members: true } }>, 'id' | 'title' | 'date' | 'startTime' | 'place' | 'audience' | 'groupIds' | 'categoryIds' | 'createdById' | 'archivedAt' | 'published' | 'rsvp' | 'members'>;
export type Audience = { everyone: boolean; users: Set<string>; players: Set<string> };

/**
 * Événements du club : audience (tout le club, groupes, catégories de la saison active, personnes choisies),
 * notifications à la publication, rappel la veille (aux participants s'il y a une participation).
 */
@Injectable()
export class EventsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Événements');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.remind().catch((e) => this.logger.warn(String(e))), EVERY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  manager(user: AuthUser) {
    return user.role === Role.ADMIN && can(user, 'events.manage');
  }

  /** Comptes de la famille d'un ensemble de joueurs : parents actifs et joueurs avec compte. */
  async families(playerIds: Iterable<string>): Promise<string[]> {
    const ids = [...new Set(playerIds)];
    if (!ids.length) return [];
    const players = await this.prisma.player.findMany({
      where: { id: { in: ids } },
      select: { userId: true, parentLinks: { where: { parent: { isActive: true } }, select: { parentId: true } } },
    });
    return [...new Set(players.flatMap((p) => [...p.parentLinks.map((l) => l.parentId), ...(p.userId ? [p.userId] : [])]))];
  }

  /** Joueurs de la famille de ce compte (ses enfants, lui-même s'il est joueur). */
  async familyPlayers(userId: string) {
    const [links, self] = await Promise.all([
      this.prisma.parentLink.findMany({ where: { parentId: userId, player: { archivedAt: null } }, select: { player: { select: { id: true, firstName: true, lastName: true, userId: true } } } }),
      this.prisma.player.findMany({ where: { userId, archivedAt: null }, select: { id: true, firstName: true, lastName: true, userId: true } }),
    ]);
    const map = new Map<string, { id: string; firstName: string; lastName: string; userId: string | null }>();
    [...links.map((l) => l.player), ...self].forEach((p) => map.set(p.id, p));
    return [...map.values()];
  }

  /** Audience : joueurs concernés (pour la participation) et comptes à prévenir. */
  async audience(e: EventRef): Promise<Audience> {
    const users = new Set<string>();
    const players = new Set<string>();
    if (e.createdById) users.add(e.createdById);
    if (e.audience === EventAudience.EVERYONE) return { everyone: true, users, players };
    if (e.audience === EventAudience.GROUPS && e.groupIds.length) {
      const [members, coaches] = await Promise.all([
        this.prisma.groupMember.findMany({ where: { groupId: { in: e.groupIds } }, select: { enrollment: { select: { playerId: true } } } }),
        this.prisma.slotCoach.findMany({ where: { slot: { groupId: { in: e.groupIds } } }, select: { coach: { select: { userId: true } } } }),
      ]);
      members.forEach((m) => players.add(m.enrollment.playerId));
      coaches.forEach((c) => users.add(c.coach.userId));
    }
    if (e.audience === EventAudience.CATEGORIES && e.categoryIds.length) {
      const enr = await this.prisma.enrollment.findMany({
        where: { categoryId: { in: e.categoryIds }, season: { status: SeasonStatus.ACTIVE }, player: { archivedAt: null } },
        select: { playerId: true },
      });
      enr.forEach((x) => players.add(x.playerId));
    }
    e.members.forEach((m) => {
      if (m.userId) users.add(m.userId);
      if (m.playerId) players.add(m.playerId);
    });
    (await this.families(players)).forEach((u) => users.add(u));
    return { everyone: false, users, players };
  }

  async canSee(user: AuthUser, e: EventRef, cache?: Audience) {
    if (this.manager(user)) return true;
    if (e.archivedAt || !e.published) return false;
    const a = cache ?? (await this.audience(e));
    return a.everyone || a.users.has(user.id);
  }

  /** Comptes à prévenir (tout le club : tous les comptes actifs). */
  async audienceUsers(e: EventRef): Promise<string[]> {
    const a = await this.audience(e);
    if (!a.everyone) {
      const active = await this.prisma.user.findMany({ where: { id: { in: [...a.users] }, isActive: true }, select: { id: true } });
      return active.map((u) => u.id);
    }
    return (await this.prisma.user.findMany({ where: { isActive: true }, select: { id: true } })).map((u) => u.id);
  }

  managers() {
    return this.permissions.holders('events.manage');
  }

  async notify(users: string[], title: string, body: string, link: string) {
    const ids = [...new Set(users)];
    if (ids.length) await this.prisma.notification.createMany({ data: ids.map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link })) });
  }

  /** Comptes à qui répondre « je participe » concerne : celui qui a répondu et la famille du joueur. */
  async goingUsers(eventId: string): Promise<string[]> {
    const rows = await this.prisma.eventResponse.findMany({ where: { eventId, going: true }, select: { userId: true, playerId: true } });
    const fam = await this.families(rows.map((r) => r.playerId).filter((x): x is string => Boolean(x)));
    return [...new Set([...rows.map((r) => r.userId), ...fam])];
  }

  /** Rappel la veille : à l'audience (affichage seul) ou aux participants. */
  async remind() {
    const hour = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Tunis', hour: '2-digit', hour12: false }).format(new Date()));
    if (hour < REMIND_FROM_HOUR) return;
    const tomorrow = dayFromIso(addDaysIso(todayIso(), 1));
    const events = await this.prisma.event.findMany({ where: { date: tomorrow, remindedAt: null, archivedAt: null, published: true, notifiedAt: { not: null } },
      select: { id: true, title: true, date: true, startTime: true, place: true, audience: true, groupIds: true, categoryIds: true, createdById: true, archivedAt: true, published: true, rsvp: true, members: true },
    });
    for (const e of events) {
      await this.prisma.event.update({ where: { id: e.id }, data: { remindedAt: new Date() } });
      const users = e.rsvp ? await this.goingUsers(e.id) : await this.audienceUsers(e);
      await this.notify(users, `⏰ Demain : ${e.title}`, [e.startTime ? `à ${e.startTime}` : null, e.place].filter(Boolean).join(' · '), `/evenements/${e.id}`);
    }
  }

  posterUrl(e: { id: string; updatedAt: Date; posterMime: string | null }) {
    if (!e.posterMime) return null;
    const exp = Math.ceil((Date.now() + DAY) / DAY) * DAY;
    const v = e.updatedAt.getTime().toString(36);
    return `/events/${e.id}/poster?v=${v}&e=${exp}&s=${signUrl(`event.${e.id}.${v}.${exp}`)}`;
  }

  verify(id: string, v: string, e: string, s: string) {
    if (!/^\d+$/.test(e) || Number(e) < Date.now()) return false;
    const expected = Buffer.from(signUrl(`event.${id}.${v}.${e}`));
    const given = Buffer.from(String(s ?? ''));
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
