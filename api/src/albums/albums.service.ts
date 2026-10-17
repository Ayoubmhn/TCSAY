import { Injectable } from '@nestjs/common';
import { AlbumAudience, AlbumKind, EmailKind, Prisma, Role } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { AuthUser, can } from '../auth/auth-user';
import { signUrl } from '../auth/jwt';
import { EventsService } from '../events/events.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';

export type ConsentMode = 'OPT_IN' | 'OPT_OUT';
const CONSENT_KEY = 'photos.consent';
const DAY = 86_400_000;

type AlbumRef = Prisma.AlbumGetPayload<{ include: { members: true } }>;
type Audience = { everyone: boolean; users: Set<string> };

/**
 * Albums photos : qui voit quoi.
 * - Audience : contexte (tournoi : inscrits, parents, arbitres ; match : joueurs, parents, arbitre ; groupe : joueurs,
 *   parents, entraîneurs ; événement : tout le club), tout le club, ou personnes choisies ; plus les personnes ajoutées.
 * - Autorisation photo : une photo où un joueur identifié n'a pas l'autorisation n'est visible que de sa famille et
 *   de la direction (règle du club : « pas d'autorisation = pas de photo » par défaut, ou « autorisé sauf refus »).
 */
@Injectable()
export class AlbumsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly events: EventsService,
  ) {}

  manager(user: AuthUser) {
    return user.role === Role.ADMIN && can(user, 'albums.manage');
  }

  /** Gère l'album : direction (albums) ou son auteur (entraîneur). */
  canManage(user: AuthUser, album: { createdById: string }) {
    return this.manager(user) || album.createdById === user.id;
  }

  async mode(): Promise<ConsentMode> {
    const s = await this.prisma.setting.findUnique({ where: { key: CONSENT_KEY } });
    return s?.value === 'OPT_OUT' ? 'OPT_OUT' : 'OPT_IN';
  }

  async setMode(mode: ConsentMode) {
    await this.prisma.setting.upsert({ where: { key: CONSENT_KEY }, create: { key: CONSENT_KEY, value: mode }, update: { value: mode } });
  }

  /** Joueur bloqué sur les photos (selon la règle du club et la réponse de sa famille). */
  blocked(mode: ConsentMode, consent: boolean | null) {
    return mode === 'OPT_IN' ? consent !== true : consent === false;
  }

  /** Joueurs de la famille de ce compte (ses enfants et lui-même s'il est joueur), quel que soit l'espace. */
  async familyPlayers(userId: string): Promise<string[]> {
    const [links, self] = await Promise.all([
      this.prisma.parentLink.findMany({ where: { parentId: userId }, select: { playerId: true } }),
      this.prisma.player.findMany({ where: { userId }, select: { id: true } }),
    ]);
    return [...new Set([...links.map((l) => l.playerId), ...self.map((p) => p.id)])];
  }

  /** Comptes de la famille d'un ensemble de joueurs : parents actifs et joueurs avec compte. */
  async families(playerIds: (string | null | undefined)[]): Promise<string[]> {
    const ids = [...new Set(playerIds.filter((x): x is string => Boolean(x)))];
    if (!ids.length) return [];
    const players = await this.prisma.player.findMany({
      where: { id: { in: ids } },
      select: { userId: true, parentLinks: { where: { parent: { isActive: true } }, select: { parentId: true } } },
    });
    return [...new Set(players.flatMap((p) => [...p.parentLinks.map((l) => l.parentId), ...(p.userId ? [p.userId] : [])]))];
  }

  /** Joueurs liés au contexte (proposés en premier pour l'identification). */
  async contextPlayers(album: { kind: AlbumKind; tournamentId: string | null; matchId: string | null; groupId: string | null; eventId?: string | null }): Promise<string[]> {
    if (album.kind === AlbumKind.EVENT && album.eventId) {
      // Participants inscrits d'abord, sinon les joueurs de l'audience (groupes, catégories, personnes).
      const going = await this.prisma.eventResponse.findMany({ where: { eventId: album.eventId, going: true, playerId: { not: null } }, select: { playerId: true } });
      if (going.length) return going.map((r) => r.playerId!);
      const ev = await this.prisma.event.findUnique({ where: { id: album.eventId }, select: { id: true, title: true, date: true, startTime: true, place: true, audience: true, groupIds: true, categoryIds: true, createdById: true, archivedAt: true, published: true, rsvp: true, members: true } });
      return ev ? [...(await this.events.audience(ev)).players] : [];
    }
    if (album.kind === AlbumKind.TOURNAMENT && album.tournamentId) {
      return (await this.prisma.tournamentEntry.findMany({ where: { tournamentId: album.tournamentId, status: 'CONFIRMED', playerId: { not: null } }, select: { playerId: true } })).map((e) => e.playerId!);
    }
    if (album.kind === AlbumKind.MATCH && album.matchId) {
      const m = await this.prisma.match.findUnique({ where: { id: album.matchId }, select: { playerAId: true, playerBId: true } });
      return [m?.playerAId, m?.playerBId].filter((x): x is string => Boolean(x));
    }
    if (album.kind === AlbumKind.GROUP && album.groupId) {
      return (await this.prisma.groupMember.findMany({ where: { groupId: album.groupId }, select: { enrollment: { select: { playerId: true } } } })).map((g) => g.enrollment.playerId);
    }
    return [];
  }

  /** Audience : tout le club, ou la liste des comptes autorisés. */
  async audience(album: AlbumRef): Promise<Audience> {
    if (album.audience === AlbumAudience.EVERYONE) return { everyone: true, users: new Set() };
    // Album d'un événement : l'audience de l'événement (tout le club, groupes, catégories, personnes).
    if (album.audience === AlbumAudience.CONTEXT && album.kind === AlbumKind.EVENT) {
      const ev = album.eventId ? await this.prisma.event.findUnique({ where: { id: album.eventId }, select: { id: true, title: true, date: true, startTime: true, place: true, audience: true, groupIds: true, categoryIds: true, createdById: true, archivedAt: true, published: true, rsvp: true, members: true } }) : null;
      if (!ev) return { everyone: true, users: new Set() };
      const a = await this.events.audience(ev);
      if (a.everyone) return { everyone: true, users: new Set() };
      const users = new Set([album.createdById, ...a.users]);
      album.members.forEach((m) => m.userId && users.add(m.userId));
      (await this.families(album.members.map((m) => m.playerId))).forEach((u) => users.add(u));
      return { everyone: false, users };
    }
    const users = new Set<string>([album.createdById]);
    const memberUsers = album.members.map((m) => m.userId).filter((x): x is string => Boolean(x));
    const memberPlayers = album.members.map((m) => m.playerId).filter((x): x is string => Boolean(x));
    memberUsers.forEach((u) => users.add(u));
    (await this.families(memberPlayers)).forEach((u) => users.add(u));
    if (album.audience === AlbumAudience.CONTEXT) {
      (await this.families(await this.contextPlayers(album))).forEach((u) => users.add(u));
      if (album.kind === AlbumKind.TOURNAMENT && album.tournamentId) {
        const t = await this.prisma.tournament.findUnique({ where: { id: album.tournamentId }, select: { refereeUserId: true, matches: { select: { refereeUserId: true } } } });
        [t?.refereeUserId, ...(t?.matches.map((m) => m.refereeUserId) ?? [])].forEach((u) => u && users.add(u));
      }
      if (album.kind === AlbumKind.MATCH && album.matchId) {
        const m = await this.prisma.match.findUnique({ where: { id: album.matchId }, select: { refereeUserId: true, createdById: true } });
        [m?.refereeUserId, m?.createdById].forEach((u) => u && users.add(u));
      }
      if (album.kind === AlbumKind.GROUP && album.groupId) {
        const coaches = await this.prisma.slotCoach.findMany({ where: { slot: { groupId: album.groupId } }, select: { coach: { select: { userId: true } } } });
        coaches.forEach((c) => users.add(c.coach.userId));
      }
    }
    return { everyone: false, users };
  }

  async canSee(user: AuthUser, album: AlbumRef, cache?: Audience) {
    if (album.archivedAt && !this.manager(user)) return false;
    if (this.canManage(user, album)) return true;
    const a = cache ?? (await this.audience(album));
    return a.everyone || a.users.has(user.id);
  }

  /** Comptes à prévenir d'un nouvel album (tout le club : tous les comptes actifs). */
  async audienceUsers(album: AlbumRef): Promise<string[]> {
    const a = await this.audience(album);
    if (!a.everyone) return [...a.users];
    return (await this.prisma.user.findMany({ where: { isActive: true }, select: { id: true } })).map((u) => u.id);
  }

  albumManagers() {
    return this.permissions.holders('albums.manage');
  }

  async notify(users: string[], title: string, body: string, link: string) {
    if (users.length) await this.prisma.notification.createMany({ data: users.map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link })) });
  }

  /** Adresse signée et datée d'une photo (`size` : vignette ou grande). */
  url(photo: { id: string; createdAt: Date }, size: 'thumb' | 'full') {
    const exp = Math.ceil((Date.now() + DAY) / DAY) * DAY;
    const v = `${size}.${photo.createdAt.getTime().toString(36)}`;
    return `/albums/photos/${photo.id}?k=${size}&v=${v}&e=${exp}&s=${signUrl(`album.${photo.id}.${v}.${exp}`)}`;
  }

  verify(id: string, v: string, e: string, s: string) {
    if (!/^\d+$/.test(e) || Number(e) < Date.now()) return false;
    const expected = Buffer.from(signUrl(`album.${id}.${v}.${e}`));
    const given = Buffer.from(String(s ?? ''));
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
