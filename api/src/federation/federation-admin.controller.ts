import { Body, Controller, Get, NotFoundException, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailKind, Prisma, Role } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { seal } from './secret-box';

class AccountsQuery {
  @IsOptional() @IsIn(['players', 'coaches']) kind?: 'players' | 'coaches';
  @IsOptional() @IsString() @MaxLength(60) q?: string;
}

class SaveDto {
  /** player : fiche joueur (stockée sur son compte s'il en a un) ; user : compte (entraîneur…). */
  @IsIn(['player', 'user']) kind: 'player' | 'user';
  @IsUUID() id: string;
  /** Identifiant IJIN ; vide = supprimer le compte fédération. */
  @IsOptional() @IsString() @MaxLength(120) login?: string;
  /** Nouveau mot de passe (absent = inchangé). L'administration le saisit mais ne peut jamais le relire. */
  @IsOptional() @IsString() @MaxLength(200) password?: string;
}

/**
 * Comptes fédération (IJIN) saisis par le club (droit « federation.manage ») : identifiant et mot de passe de chaque joueur
 * et entraîneur. Le mot de passe est chiffré et ne se relit que par son propriétaire (ou les parents d'un joueur sans compte).
 * Le propriétaire est prévenu par notification ; l'audit ne contient jamais le mot de passe.
 */
@ApiTags('Compte fédération (IJIN)')
@ApiBearerAuth()
@Perm('federation.manage')
@Controller('federation/accounts')
export class FederationAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query() q: AccountsQuery) {
    const words = (q.q ?? '').trim().split(/\s+/).filter((w) => w.length >= 2);
    const name = (w: string) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }] });
    if (q.kind === 'coaches') {
      const users = await this.prisma.user.findMany({
        where: { isActive: true, roles: { has: Role.COACH }, AND: words.map(name) },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: { id: true, firstName: true, lastName: true, ijinLogin: true, ijinPasswordEnc: true },
      });
      return users.map((u) => ({ kind: 'user', id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), detail: 'Entraîneur', login: u.ijinLogin, hasPassword: Boolean(u.ijinPasswordEnc), owner: 'compte' }));
    }
    const players = await this.prisma.player.findMany({
      where: { archivedAt: null, AND: words.map((w) => ({ OR: [...name(w).OR, { memberCode: { contains: w, mode: 'insensitive' as const } }] }) as Prisma.PlayerWhereInput) },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 300,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        memberCode: true,
        ijinLogin: true,
        ijinPasswordEnc: true,
        user: { select: { ijinLogin: true, ijinPasswordEnc: true } },
      },
    });
    return players.map((p) => ({
      kind: 'player',
      id: p.id,
      name: `${p.firstName} ${p.lastName}`.trim(),
      detail: p.memberCode ?? 'Joueur',
      login: p.user ? p.user.ijinLogin : p.ijinLogin,
      hasPassword: Boolean(p.user ? p.user.ijinPasswordEnc : p.ijinPasswordEnc),
      owner: p.user ? 'compte du joueur' : 'parents',
    }));
  }

  @Put()
  async save(@CurrentUser() actor: AuthUser, @Body() dto: SaveDto) {
    const login = dto.login?.trim() || null;
    const data: { ijinLogin: string | null; ijinPasswordEnc?: string | null } = { ijinLogin: login };
    if (!login) data.ijinPasswordEnc = null;
    else if (dto.password !== undefined && dto.password !== '') data.ijinPasswordEnc = seal(dto.password);

    let target = '';
    let notify: string[] = [];
    if (dto.kind === 'user') {
      const u = await this.prisma.user.findUnique({ where: { id: dto.id }, select: { firstName: true, lastName: true } });
      if (!u) throw new NotFoundException('Compte introuvable.');
      await this.prisma.user.update({ where: { id: dto.id }, data });
      target = `${u.firstName} ${u.lastName}`.trim();
      notify = [dto.id];
    } else {
      const p = await this.prisma.player.findUnique({
        where: { id: dto.id },
        select: { firstName: true, lastName: true, userId: true, parentLinks: { where: { parent: { isActive: true } }, select: { parentId: true } } },
      });
      if (!p) throw new NotFoundException('Joueur introuvable.');
      if (p.userId) await this.prisma.user.update({ where: { id: p.userId }, data });
      else await this.prisma.player.update({ where: { id: dto.id }, data });
      target = `${p.firstName} ${p.lastName}`.trim();
      notify = p.userId ? [p.userId] : p.parentLinks.map((l) => l.parentId);
    }
    if (notify.length && login) {
      await this.prisma.notification.createMany({
        data: notify.map((userId) => ({
          userId,
          kind: EmailKind.OTHER,
          title: `Compte fédération IJIN enregistré${dto.kind === 'player' ? ` : ${target}` : ''}`,
          body: `Le club a enregistré l’identifiant IJIN ${login}${data.ijinPasswordEnc ? ' et son mot de passe' : ''}. Retrouvez-le dans Paramètres › Compte fédération.`,
          link: '/parametres',
        })),
      });
    }
    await this.audit.log(actor.id, {
      action: login ? 'Compte IJIN enregistré par le club' : 'Compte IJIN supprimé par le club',
      entity: dto.kind === 'user' ? 'User' : 'Player',
      entityId: dto.id,
      target,
      after: login ? `${login}${data.ijinPasswordEnc ? ' · mot de passe modifié' : ''}` : undefined,
    });
    return { ok: true };
  }
}
