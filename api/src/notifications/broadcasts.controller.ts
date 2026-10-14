import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailKind, Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm, Roles } from '../auth/auth-user';
import { isPlaceholderEmail } from '../common/placeholder';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

const TARGETS = ['PARENTS', 'PLAYERS', 'COACHES', 'ALL', 'GROUP', 'USERS'] as const;
type Target = (typeof TARGETS)[number];
const KINDS = ['PARENTS', 'PLAYERS', 'COACHES'] as const;
type Kind = (typeof KINDS)[number];

/**
 * Destinataires combinables : rôles entiers (tous les parents…), plusieurs groupes (avec qui dans ces groupes),
 * des personnes, puis des exclusions (groupes, personnes). Sans `target`, c'est ce mode qui s'applique.
 */
class AudienceDto {
  @IsOptional() @IsArray() @IsIn(KINDS, { each: true }) roles?: Kind[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) groupIds?: string[];
  /** Dans les groupes choisis : joueurs, parents, entraîneurs (par défaut les trois). */
  @IsOptional() @IsArray() @IsIn(KINDS, { each: true }) groupScope?: Kind[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) userIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) excludeGroupIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) excludeUserIds?: string[];
}

class BroadcastDto extends AudienceDto {
  @IsString()
  @IsNotEmpty({ message: 'Titre obligatoire.' })
  @MaxLength(120)
  title: string;

  @IsString()
  @IsNotEmpty({ message: 'Message obligatoire.' })
  @MaxLength(2000)
  body: string;

  /** Écran à ouvrir depuis la notification (chemin interne, ex. « /paiements »). */
  @IsOptional()
  @Matches(/^\/[\w\-/]*$/, { message: 'Lien invalide : un chemin de l’application, ex. /paiements.' })
  link?: string;

  /** Ancien mode (une seule cible) ; absent : destinataires combinés (rôles, groupes, personnes, exclusions). */
  @IsOptional()
  @IsIn(TARGETS)
  target?: Target;

  @ValidateIf((o: BroadcastDto) => o.target === 'GROUP')
  @IsUUID()
  groupId?: string;

  /** Aussi par email (adresses provisoires exclues). */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  byEmail?: boolean;
}

class RecipientsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

const TARGET_LABEL: Record<Exclude<Target, 'GROUP' | 'USERS'>, string> = {
  PARENTS: 'Tous les parents',
  PLAYERS: 'Tous les joueurs (avec compte)',
  COACHES: 'Tous les entraîneurs',
  ALL: 'Parents, joueurs et entraîneurs',
};

const ROLES_OF: Record<Exclude<Target, 'GROUP' | 'USERS'>, Role[]> = {
  PARENTS: [Role.PARENT],
  PLAYERS: [Role.PLAYER],
  COACHES: [Role.COACH],
  ALL: [Role.PARENT, Role.PLAYER, Role.COACH],
};

/**
 * Messages du club : l'administration (président, ou compte ayant le droit « notifications.send », ex. agent administratif)
 * envoie une notification dans l'application aux parents, joueurs, entraîneurs, à un groupe ou à des personnes choisies,
 * et, si demandé, aussi par email.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('notifications/broadcasts')
export class BroadcastsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Perm('notifications.send')
  async list() {
    const rows = await this.prisma.notificationBroadcast.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        sender: { select: { firstName: true, lastName: true } },
        _count: { select: { notifications: { where: { readAt: { not: null } } } } },
      },
    });
    return rows.map((b) => ({
      id: b.id,
      title: b.title,
      body: b.body,
      link: b.link,
      audience: b.audience,
      recipients: b.recipients,
      read: b._count.notifications,
      byEmail: b.byEmail,
      createdAt: b.createdAt,
      sender: `${b.sender.firstName} ${b.sender.lastName}`.trim(),
    }));
  }

  /** Recherche de destinataires : nom, email, téléphone ; un parent est aussi trouvé par le nom ou le code de son joueur. */
  @Get('recipients')
  @Perm('notifications.send')
  async recipients(@Query() query: RecipientsQuery) {
    const words = (query.q ?? '').trim().split(/\s+/).filter((w) => w.length >= 2);
    if (!words.length) return [];
    const one = (w: string): Prisma.UserWhereInput => ({
      OR: [
        { firstName: { contains: w, mode: 'insensitive' } },
        { lastName: { contains: w, mode: 'insensitive' } },
        { email: { contains: w, mode: 'insensitive' } },
        { phone: { contains: w } },
        {
          parentLinks: {
            some: {
              player: {
                OR: [
                  { firstName: { contains: w, mode: 'insensitive' } },
                  { lastName: { contains: w, mode: 'insensitive' } },
                  { memberCode: { contains: w, mode: 'insensitive' } },
                ],
              },
            },
          },
        },
        { player: { memberCode: { contains: w, mode: 'insensitive' } } },
      ],
    });
    const users = await this.prisma.user.findMany({
      where: { isActive: true, roles: { hasSome: [Role.PARENT, Role.PLAYER, Role.COACH] }, AND: words.map(one) },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 20,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        roles: true,
        parentLinks: { where: { player: { archivedAt: null } }, select: { player: { select: { firstName: true, lastName: true } } } },
      },
    });
    return users.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      roles: u.roles.filter((r) => r === Role.PARENT || r === Role.PLAYER || r === Role.COACH),
      players: u.parentLinks.map((l) => `${l.player.firstName} ${l.player.lastName}`.trim()),
    }));
  }

  /** Aperçu : nombre de destinataires et libellé, avant l'envoi. */
  @Post('preview')
  @Perm('notifications.send')
  async preview(@Body() dto: AudienceDto) {
    const { ids, audience } = await this.combine(dto);
    return { recipients: ids.length, audience };
  }

  @Post()
  @Perm('notifications.send')
  async send(@CurrentUser() actor: AuthUser, @Body() dto: BroadcastDto) {
    const { ids, audience } = await this.resolve(dto);
    if (!ids.length) throw new BadRequestException('Aucun destinataire (comptes actifs) pour ce choix.');
    const title = dto.title.trim();
    const body = dto.body.trim();
    const link = dto.link?.trim() || null;

    const broadcast = await this.prisma.$transaction(async (tx) => {
      const b = await tx.notificationBroadcast.create({
        data: { senderId: actor.id, title, body, link, audience, recipients: ids.length, byEmail: Boolean(dto.byEmail) },
      });
      await tx.notification.createMany({
        data: ids.map((userId) => ({ userId, kind: EmailKind.OTHER, title, body, link, broadcastId: b.id })),
      });
      await this.audit.log(
        actor.id,
        {
          action: 'Notification envoyée',
          entity: 'NotificationBroadcast',
          entityId: b.id,
          target: audience,
          after: `${title} · ${ids.length} destinataire(s)${dto.byEmail ? ' · aussi par email' : ''}`,
        },
        tx,
      );
      return b;
    });

    let emails = 0;
    if (dto.byEmail) {
      const users = await this.prisma.user.findMany({ where: { id: { in: ids }, email: { not: null } }, select: { email: true, firstName: true } });
      for (const u of users) {
        if (!u.email || isPlaceholderEmail(u.email)) continue;
        await this.mail.send(u.email, title, `Bonjour ${u.firstName},\n\n${body}\n\nLe bureau du TCSAY`, EmailKind.OTHER, { notify: false });
        emails++;
      }
    }
    return { id: broadcast.id, recipients: ids.length, emails, audience };
  }

  /** Comptes actifs destinataires, sans doublon, et libellé lisible du choix. */
  private async resolve(dto: BroadcastDto): Promise<{ ids: string[]; audience: string }> {
    if (!dto.target) return this.combine(dto);
    if (dto.target === 'USERS') {
      const users = await this.prisma.user.findMany({ where: { id: { in: dto.userIds ?? [] }, isActive: true }, select: { id: true, firstName: true, lastName: true } });
      const names = users.map((u) => `${u.firstName} ${u.lastName}`.trim());
      const audience = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} et ${names.length - 3} autre(s)`;
      return { ids: users.map((u) => u.id), audience: audience || 'Personnes choisies' };
    }
    if (dto.target === 'GROUP') {
      const group = await this.prisma.trainingGroup.findUnique({
        where: { id: dto.groupId },
        include: {
          members: {
            where: { enrollment: { player: { archivedAt: null } } },
            include: { enrollment: { select: { player: { select: { userId: true, parentLinks: { select: { parentId: true } } } } } } },
          },
          slots: { select: { coaches: { select: { coach: { select: { userId: true } } } } } },
        },
      });
      if (!group || group.archivedAt) throw new NotFoundException('Groupe introuvable.');
      const candidates = new Set<string>();
      for (const m of group.members) {
        if (m.enrollment.player.userId) candidates.add(m.enrollment.player.userId);
        for (const l of m.enrollment.player.parentLinks) candidates.add(l.parentId);
      }
      for (const s of group.slots) for (const c of s.coaches) candidates.add(c.coach.userId);
      const active = await this.prisma.user.findMany({ where: { id: { in: [...candidates] }, isActive: true }, select: { id: true } });
      return { ids: active.map((u) => u.id), audience: `Groupe ${group.name} (joueurs, parents, entraîneurs)` };
    }
    const users = await this.prisma.user.findMany({ where: { isActive: true, roles: { hasSome: ROLES_OF[dto.target] } }, select: { id: true } });
    return { ids: users.map((u) => u.id), audience: TARGET_LABEL[dto.target] };
  }

  /** Comptes liés à des groupes : joueurs (compte propre), parents, entraîneurs des créneaux, selon `scope`. */
  private async groupUsers(groupIds: string[], scope: Kind[]) {
    const groups = await this.prisma.trainingGroup.findMany({
      where: { id: { in: groupIds }, archivedAt: null },
      include: {
        members: {
          where: { enrollment: { player: { archivedAt: null } } },
          include: { enrollment: { select: { player: { select: { userId: true, parentLinks: { select: { parentId: true } } } } } } },
        },
        slots: { select: { coaches: { select: { coach: { select: { userId: true } } } } } },
      },
    });
    const ids = new Set<string>();
    for (const g of groups) {
      for (const m of g.members) {
        if (scope.includes('PLAYERS') && m.enrollment.player.userId) ids.add(m.enrollment.player.userId);
        if (scope.includes('PARENTS')) for (const l of m.enrollment.player.parentLinks) ids.add(l.parentId);
      }
      if (scope.includes('COACHES')) for (const s of g.slots) for (const c of s.coaches) ids.add(c.coach.userId);
    }
    return { ids, names: groups.map((g) => g.name) };
  }

  /** Destinataires combinés : (rôles ∪ groupes ∪ personnes) − (groupes exclus ∪ personnes exclues), comptes actifs. */
  private async combine(dto: AudienceDto): Promise<{ ids: string[]; audience: string }> {
    const roles = dto.roles ?? [];
    const scope = dto.groupScope?.length ? dto.groupScope : [...KINDS];
    const wanted = new Set<string>();
    const parts: string[] = [];
    if (roles.length) {
      const map: Record<Kind, Role> = { PARENTS: Role.PARENT, PLAYERS: Role.PLAYER, COACHES: Role.COACH };
      const users = await this.prisma.user.findMany({ where: { isActive: true, roles: { hasSome: roles.map((r) => map[r]) } }, select: { id: true } });
      users.forEach((u) => wanted.add(u.id));
      const label: Record<Kind, string> = { PARENTS: 'tous les parents', PLAYERS: 'tous les joueurs', COACHES: 'tous les entraîneurs' };
      parts.push(roles.map((r) => label[r]).join(', '));
    }
    if (dto.groupIds?.length) {
      const g = await this.groupUsers(dto.groupIds, scope);
      g.ids.forEach((id) => wanted.add(id));
      const who = scope.length === 3 ? '' : ` (${scope.map((k) => ({ PARENTS: 'parents', PLAYERS: 'joueurs', COACHES: 'entraîneurs' })[k]).join(', ')})`;
      parts.push(`${g.names.length > 1 ? 'groupes' : 'groupe'} ${g.names.join(', ')}${who}`);
    }
    if (dto.userIds?.length) {
      dto.userIds.forEach((id) => wanted.add(id));
      parts.push(`${dto.userIds.length} personne(s) choisie(s)`);
    }
    const excluded = new Set<string>(dto.excludeUserIds ?? []);
    const except: string[] = [];
    if (dto.excludeGroupIds?.length) {
      const g = await this.groupUsers(dto.excludeGroupIds, [...KINDS]);
      g.ids.forEach((id) => excluded.add(id));
      except.push(`${g.names.length > 1 ? 'groupes' : 'groupe'} ${g.names.join(', ')}`);
    }
    if (dto.excludeUserIds?.length) except.push(`${dto.excludeUserIds.length} personne(s)`);
    const candidates = [...wanted].filter((id) => !excluded.has(id));
    const active = candidates.length ? await this.prisma.user.findMany({ where: { id: { in: candidates }, isActive: true }, select: { id: true } }) : [];
    const text = parts.join(' + ') || 'Aucun destinataire';
    const audience = (except.length ? `${text} · sauf ${except.join(', ')}` : text).replace(/^./, (c) => c.toUpperCase());
    return { ids: active.map((u) => u.id), audience: audience.slice(0, 300) };
  }
}
