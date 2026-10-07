import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { CategoriesService } from '../categories/categories.service';
import { ageAtYearEnd, dayFromIso, isoDay } from '../common/dates';
import { assertSeasonOpen, assertVersion, fullName, notFound, rule } from '../common/rules';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeCategoryDto, CreatePlayerDto, ListPlayersQuery, UpdateContactDto, UpdatePlayerDto } from './players.dto';

@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async list(q: ListPlayersQuery) {
    const season = await this.access.seasonOrActive(q.seasonId);
    const search = q.q?.trim();
    const where: Prisma.PlayerWhereInput = {
      archivedAt: q.archived ? { not: null } : null,
      ...(q.archived ? {} : { enrollments: { some: { seasonId: season.id, categoryId: q.categoryId } } }),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const players = await this.prisma.player.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: this.include(season.id),
    });
    const year = season.startDate.getUTCFullYear();
    return players.map((p) => this.view(p, year));
  }

  async get(id: string) {
    const season = await this.access.activeSeason();
    const player = await this.prisma.player.findUnique({ where: { id }, include: this.include(season.id) });
    if (!player) throw notFound('Joueur');
    return this.view(player, season.startDate.getUTCFullYear());
  }

  async create(actor: AuthUser, dto: CreatePlayerDto) {
    const season = await this.access.activeSeason();
    assertSeasonOpen(season);
    const birthDate = dayFromIso(dto.birthDate);
    const suggestion = await this.categories.suggest(birthDate, dto.gender, season.startDate.getUTCFullYear());
    if ('error' in suggestion) throw new BadRequestException(suggestion.error);
    const { age, minor } = suggestion;

    if (minor && !dto.parentId) throw rule.bad('R9', 'Un mineur doit avoir au moins un parent lié.');
    if (!minor && !dto.email) throw new BadRequestException('L’email est obligatoire pour un joueur majeur.');

    const categoryId = dto.categoryId ?? suggestion.category.id;
    const allowed = [suggestion.category.id, suggestion.alternative?.id].filter(Boolean);
    const derogation = dto.derogationReason?.trim() || null;
    if (!allowed.includes(categoryId) && !derogation) {
      throw rule.bad('R3', `Catégorie hors norme pour ${age} ans : motif de dérogation obligatoire.`);
    }

    const parent = dto.parentId ? await this.prisma.user.findUnique({ where: { id: dto.parentId } }) : null;
    if (dto.parentId && (!parent || parent.role !== Role.PARENT || !parent.isActive)) throw notFound('Parent');

    const result = await this.prisma.$transaction(async (tx) => {
      const account =
        !minor && dto.email
          ? await this.accounts.create(tx, {
              email: dto.email,
              role: Role.PLAYER,
              firstName: dto.firstName,
              lastName: dto.lastName,
              phone: dto.phone,
            })
          : null;
      const player = await tx.player.create({
        data: {
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          birthDate,
          gender: dto.gender,
          email: dto.email?.trim().toLowerCase() || null,
          phone: dto.phone?.trim() || null,
          userId: account?.user.id ?? null,
        },
      });
      const enrollment = await tx.enrollment.create({
        data: { playerId: player.id, seasonId: season.id, categoryId, derogationReason: derogation },
        include: { category: true },
      });
      if (parent) await tx.parentLink.create({ data: { parentId: parent.id, playerId: player.id } });
      await this.audit.log(
        actor.id,
        {
          action: 'Joueur créé',
          entity: 'Player',
          entityId: player.id,
          target: fullName(player),
          after: enrollment.category.name,
          reason: derogation,
        },
        tx,
      );
      return { player, account };
    });

    // Emails après validation de la transaction.
    if (result.account) {
      await this.accounts.sendCredentials(result.account.user, result.account.password);
    } else if (parent) {
      await this.mail.send(
        parent.email,
        `${result.player.firstName} est inscrit au TCSAY`,
        `Bonjour ${parent.firstName},\n\n${fullName(result.player)} est inscrit pour la saison ${season.label}. Vous pouvez suivre ses séances, absences et paiements depuis votre espace.\n\nLe bureau du TCSAY`,
        'OTHER',
      );
    }
    const sentTo = result.account?.user.email ?? parent?.email ?? null;
    return { ...(await this.get(result.player.id)), sentTo };
  }

  /** R9 : nom, naissance, genre (admin seulement). */
  async update(actor: AuthUser, id: string, dto: UpdatePlayerDto) {
    const player = await this.prisma.player.findUnique({ where: { id } });
    if (!player) throw notFound('Joueur');
    if (player.archivedAt) throw rule.conflict('R8', 'Joueur archivé : restaurez-le avant de le modifier.');
    assertVersion(player, dto.version, 'Ce joueur');
    const updated = await this.prisma.player.update({
      where: { id },
      data: {
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
        birthDate: dto.birthDate ? dayFromIso(dto.birthDate) : undefined,
        gender: dto.gender,
        email: dto.email === undefined ? undefined : dto.email.trim().toLowerCase() || null,
        phone: dto.phone === undefined ? undefined : dto.phone.trim() || null,
        version: { increment: 1 },
      },
    });
    await this.audit.log(actor.id, {
      action: 'Joueur modifié',
      entity: 'Player',
      entityId: id,
      target: fullName(updated),
      before: `${fullName(player)} · ${isoDay(player.birthDate)} · ${player.gender}`,
      after: `${fullName(updated)} · ${isoDay(updated.birthDate)} · ${updated.gender}`,
    });
    return this.get(id);
  }

  /** R3 : catégorie modifiable par l'admin seulement, motif si hors norme. */
  async changeCategory(actor: AuthUser, id: string, dto: ChangeCategoryDto) {
    const season = await this.access.activeSeason();
    assertSeasonOpen(season);
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { playerId_seasonId: { playerId: id, seasonId: season.id } },
      include: { category: true, player: true },
    });
    if (!enrollment) throw notFound('Inscription de la saison active');
    const suggestion = await this.categories.suggest(
      enrollment.player.birthDate,
      enrollment.player.gender,
      season.startDate.getUTCFullYear(),
    );
    const allowed = 'error' in suggestion ? [] : [suggestion.category.id, suggestion.alternative?.id];
    const reason = dto.derogationReason?.trim() || null;
    if (!allowed.includes(dto.categoryId) && !reason) {
      throw rule.bad('R3', 'Catégorie hors norme : motif de dérogation obligatoire.');
    }
    const updated = await this.prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { categoryId: dto.categoryId, derogationReason: reason },
      include: { category: true },
    });
    await this.audit.log(actor.id, {
      action: 'Catégorie modifiée',
      entity: 'Enrollment',
      entityId: enrollment.id,
      target: fullName(enrollment.player),
      before: enrollment.category.name,
      after: updated.category.name,
      reason,
    });
    return this.get(id);
  }

  /** R8 : archivage (le joueur a des liens), retrait des groupes de la saison active. */
  async archive(actor: AuthUser, id: string) {
    const player = await this.prisma.player.findUnique({ where: { id } });
    if (!player) throw notFound('Joueur');
    if (player.archivedAt) return this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.groupMember.deleteMany({
        where: { enrollment: { playerId: id, season: { status: 'ACTIVE' } } },
      });
      await tx.player.update({ where: { id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
      if (player.userId) await tx.user.update({ where: { id: player.userId }, data: { isActive: false } });
      await this.audit.log(
        actor.id,
        { action: 'Joueur archivé', entity: 'Player', entityId: id, target: fullName(player), before: 'Actif', after: 'Archivé' },
        tx,
      );
    });
    return this.get(id);
  }

  async restore(actor: AuthUser, id: string) {
    const player = await this.prisma.player.findUnique({ where: { id } });
    if (!player) throw notFound('Joueur');
    await this.prisma.$transaction(async (tx) => {
      await tx.player.update({ where: { id }, data: { archivedAt: null, version: { increment: 1 } } });
      if (player.userId) await tx.user.update({ where: { id: player.userId }, data: { isActive: true } });
      await this.audit.log(
        actor.id,
        { action: 'Joueur restauré', entity: 'Player', entityId: id, target: fullName(player), before: 'Archivé', after: 'Actif' },
        tx,
      );
    });
    return this.get(id);
  }

  /** R9 : téléphone et email modifiables par le joueur ou son parent. */
  async updateContact(user: AuthUser, id: string, dto: UpdateContactDto) {
    const playerId = await this.access.resolvePlayer(user, id);
    const player = await this.prisma.player.update({
      where: { id: playerId },
      data: {
        email: dto.email === undefined ? undefined : dto.email.trim().toLowerCase() || null,
        phone: dto.phone === undefined ? undefined : dto.phone.trim() || null,
        version: { increment: 1 },
      },
    });
    return { id: player.id, email: player.email, phone: player.phone };
  }

  private include(seasonId: string) {
    return {
      enrollments: {
        where: { seasonId },
        include: {
          category: { select: { id: true, code: true, name: true } },
          groups: { include: { group: { select: { id: true, name: true, archivedAt: true } } } },
        },
      },
      parentLinks: { include: { parent: { select: { id: true, firstName: true, lastName: true, email: true } } } },
    } satisfies Prisma.PlayerInclude;
  }

  private view(
    p: Prisma.PlayerGetPayload<{ include: ReturnType<PlayersService['include']> }>,
    referenceYear: number,
  ) {
    const enrollment = p.enrollments[0];
    const group = enrollment?.groups.find((g) => !g.group.archivedAt)?.group ?? null;
    const age = ageAtYearEnd(p.birthDate, referenceYear);
    return {
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      birthDate: p.birthDate,
      gender: p.gender,
      email: p.email,
      phone: p.phone,
      hasAccount: Boolean(p.userId),
      archivedAt: p.archivedAt,
      version: p.version,
      age,
      minor: age < 18,
      category: enrollment?.category ?? null,
      derogationReason: enrollment?.derogationReason ?? null,
      group: group ? { id: group.id, name: group.name } : null,
      parents: p.parentLinks.map((l) => l.parent),
    };
  }
}
