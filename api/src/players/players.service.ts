import { isPlaceholderEmail } from '../common/placeholder';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Gender, PaymentPlan, Prisma, Role } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { CategoriesService } from '../categories/categories.service';
import { ageAtYearEnd, dayFromIso, isoDay, todayIso } from '../common/dates';
import { num } from '../common/money';
import { slotInclude, slotView } from '../groups/groups.controller';
import { PaymentsService } from '../payments/payments.service';
import { assertSeasonOpen, assertVersion, fullName, notFound, rule } from '../common/rules';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { formatMemberCode, nextMemberCode } from './member-code';
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
    private readonly payments: PaymentsService,
  ) {}

  async list(q: ListPlayersQuery) {
    const season = await this.access.seasonOrActive(q.seasonId);
    const search = q.q?.trim();
    const where: Prisma.PlayerWhereInput = {
      archivedAt: q.archived ? { not: null } : null,
      // Joueurs inscrits à la saison, et joueurs importés sans inscription (date ou catégorie à compléter).
      ...(q.archived
        ? {}
        : q.categoryId
          ? { enrollments: { some: { seasonId: season.id, categoryId: q.categoryId } } }
          : { OR: [{ enrollments: { some: { seasonId: season.id } } }, { enrollments: { none: {} } }] }),
      ...(search
        ? {
            AND: [{ OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { memberCode: { contains: search.replace(/\s+/g, ''), mode: 'insensitive' } },
              { nameAr: { contains: search } },
            ] }],
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

  /**
   * Inscription d'un joueur : catégorie proposée (R3), mineur → parent existant ou créé dans le même formulaire (R9),
   * majeur → email, téléphone et CIN obligatoires ; cotisation créée selon le mode de paiement choisi.
   */
  async create(actor: AuthUser, dto: CreatePlayerDto) {
    const season = await this.access.activeSeason();
    assertSeasonOpen(season);
    const birthDate = dayFromIso(dto.birthDate);
    const suggestion = await this.categories.suggest(birthDate, dto.gender, season.startDate.getUTCFullYear());
    if ('error' in suggestion) throw new BadRequestException(suggestion.error);
    const { age, minor } = suggestion;

    if (minor && !dto.parentId && !dto.newParent) throw rule.bad('R9', 'Un mineur doit avoir au moins un parent lié.');
    if (!minor) {
      if (!dto.email) throw new BadRequestException('L’email est obligatoire pour un joueur majeur.');
      if (!dto.phone?.trim()) throw new BadRequestException('Le téléphone est obligatoire pour un joueur majeur.');
      if (!dto.cin) throw new BadRequestException('La CIN est obligatoire pour un joueur majeur.');
    }

    const categoryId = dto.categoryId ?? suggestion.category.id;
    const allowed = [suggestion.category.id, suggestion.alternative?.id].filter(Boolean);
    const derogation = dto.derogationReason?.trim() || null;
    // Loisirs : ouvert à tous les âges, sans dérogation.
    const chosen = await this.prisma.category.findUnique({ where: { id: categoryId }, select: { family: true } });
    if (!chosen) throw notFound('Catégorie');
    if (chosen.family !== 'LEISURE' && !allowed.includes(categoryId) && !derogation) {
      throw rule.bad('R3', `Catégorie hors norme pour ${age} ans : motif de dérogation obligatoire.`);
    }

    const existingParent = dto.parentId ? await this.prisma.user.findUnique({ where: { id: dto.parentId } }) : null;
    if (dto.parentId && (!existingParent || !existingParent.roles.includes(Role.PARENT) || !existingParent.isActive)) throw notFound('Parent');
    const plan = dto.paymentPlan ?? PaymentPlan.FULL;

    const result = await this.prisma.$transaction(async (tx) => {
      // Parent créé dans le même formulaire si absent de la liste.
      const newParent = dto.newParent
        ? await this.accounts.create(tx, { ...dto.newParent, role: Role.PARENT })
        : null;
      if (newParent) {
        await this.audit.log(
          actor.id,
          { action: 'Parent créé', entity: 'User', entityId: newParent.user.id, target: fullName(newParent.user), after: 'Depuis le formulaire joueur' },
          tx,
        );
      }
      const parent = newParent?.user ?? existingParent;

      const account =
        !minor && dto.email
          ? await this.accounts.create(tx, {
              email: dto.email,
              cin: dto.cin,
              role: Role.PLAYER,
              firstName: dto.firstName,
              lastName: dto.lastName,
              phone: dto.phone,
            })
          : null;
      const player = await tx.player.create({
        data: {
          ...(await nextMemberCode(tx, season.startDate.getUTCFullYear())),
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          birthDate,
          gender: dto.gender,
          email: dto.email?.trim().toLowerCase() || null,
          phone: dto.phone?.trim() || null,
          cin: dto.cin?.trim() || null,
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
        { action: 'Joueur créé', entity: 'Player', entityId: player.id, target: fullName(player), after: enrollment.category.name, reason: derogation },
        tx,
      );
      const membership = await this.payments.buildMembership(tx, actor.id, { ...enrollment, player }, season, plan);
      return { player, account, newParent, parent, membership };
    });

    // Emails après validation de la transaction.
    const credentials = [];
    if (result.newParent) credentials.push(await this.accounts.sendCredentials(result.newParent.user, result.newParent.password, Role.PARENT));
    if (result.account) {
      credentials.push(await this.accounts.sendCredentials(result.account.user, result.account.password, Role.PLAYER));
    } else if (result.parent?.email && !result.newParent) {
      await this.mail.send(
        result.parent.email,
        `${result.player.firstName} est inscrit au TCSAY`,
        `Bonjour ${result.parent.firstName},\n\n${fullName(result.player)} est inscrit pour la saison ${season.label}. Vous pouvez suivre ses séances, absences et paiements depuis votre espace.\n\nLe bureau du TCSAY`,
        'OTHER',
      );
    }
    return {
      ...(await this.get(result.player.id)),
      sentTo: credentials.map((c) => c.sentTo).filter(Boolean).join(', ') || result.parent?.email || null,
      temporaryPasswords: credentials.filter((c) => c.temporaryPassword),
      membership: result.membership
        ? { plan, installments: result.membership.schedule }
        : null,
    };
  }

  /** Profil d'un joueur : infos, parents, groupe et créneaux, cotisation et tranches, absences. */
  async profile(id: string) {
    const base = await this.get(id);
    const season = await this.access.activeSeason();
    const [groups, installments, absences, attendance] = await Promise.all([
      this.prisma.trainingGroup.findMany({
        where: { seasonId: season.id, archivedAt: null, members: { some: { enrollment: { playerId: id } } } },
        include: { slots: { include: slotInclude, orderBy: [{ day: 'asc' }, { startTime: 'asc' }] } },
      }),
      this.prisma.installment.findMany({
        where: { membership: { enrollment: { playerId: id, seasonId: season.id } } },
        include: { payments: true, membership: { select: { paymentPlan: true } } },
        orderBy: { number: 'asc' },
      }),
      this.prisma.attendance.findMany({
        where: { playerId: id, status: { in: ['ABSENT', 'LATE'] }, group: { seasonId: season.id } },
        include: { group: { select: { name: true } }, slot: { select: { startTime: true } } },
        orderBy: { date: 'desc' },
      }),
      this.prisma.attendance.count({ where: { playerId: id, group: { seasonId: season.id } } }),
    ]);
    const today = todayIso();
    return {
      ...base,
      season: { id: season.id, label: season.label },
      groups: groups.map((g) => ({ id: g.id, name: g.name, slots: g.slots.map(slotView) })),
      paymentPlan: installments[0]?.membership.paymentPlan ?? null,
      installments: installments.map((i) => {
        const amount = num(i.amount);
        const paid = i.payments.reduce((t, p) => t + num(p.amount), 0);
        const remaining = Math.max(0, Math.round((amount - paid) * 1000) / 1000);
        const due = isoDay(i.dueDate);
        return {
          id: i.id,
          number: i.number,
          count: i.count,
          dueDate: due,
          amount,
          paid,
          remaining,
          status: remaining === 0 ? 'PAID' : due < today ? 'LATE' : paid > 0 ? 'PARTIAL' : 'DUE',
        };
      }),
      absences: absences.map((a) => ({
        id: a.id,
        date: isoDay(a.date),
        status: a.status,
        group: a.group.name,
        startTime: a.slot.startTime,
        reason: a.reason ?? (a.status === 'LATE' ? 'Retard' : 'Non justifiée'),
      })),
      attendanceCount: attendance,
    };
  }

  /** R9 : nom, naissance, genre (admin seulement). */
  async update(actor: AuthUser, id: string, dto: UpdatePlayerDto) {
    const player = await this.prisma.player.findUnique({ where: { id } });
    if (!player) throw notFound('Joueur');
    if (player.archivedAt) throw rule.conflict('R8', 'Joueur archivé : restaurez-le avant de le modifier.');
    assertVersion(player, dto.version, 'Ce joueur');
    // Email déjà utilisé par un autre compte (souvent celui du parent) : refusé, sinon les deux comptes seraient fusionnés.
    const wanted = dto.email === undefined ? null : dto.email.trim().toLowerCase() || null;
    if (wanted && wanted !== player.email) {
      const other = await this.prisma.user.findUnique({ where: { email: wanted } });
      if (other && other.id !== player.userId) {
        throw new ConflictException(`L’email ${wanted} est déjà celui du compte de ${fullName(other)} : choisissez une adresse propre au joueur.`);
      }
    }
    const updated = await this.prisma.player.update({
      where: { id },
      data: {
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
        birthDate: dto.birthDate ? dayFromIso(dto.birthDate) : undefined,
        birthYearOnly: dto.birthDate ? false : undefined,
        gender: dto.gender,
        email: dto.email === undefined ? undefined : dto.email.trim().toLowerCase() || null,
        phone: dto.phone === undefined ? undefined : dto.phone.trim() || null,
        cin: dto.cin === undefined ? undefined : dto.cin.trim() || null,
        version: { increment: 1 },
      },
    });
    // Nouvel email : le compte du joueur reçoit ses nouveaux identifiants ; un joueur sans compte (mineur compris) en reçoit
    // un, avec ses identifiants envoyés à cette adresse (changement de mot de passe obligatoire à la première connexion).
    let credentials = null;
    const newEmail = dto.email === undefined ? undefined : dto.email.trim().toLowerCase() || null;
    if (newEmail !== undefined && newEmail !== player.email) {
      if (updated.userId) {
        credentials = await this.accounts.changeEmail(actor.id, updated.userId, newEmail);
      } else if (newEmail && !isPlaceholderEmail(newEmail)) {
        const created = await this.prisma.$transaction(async (tx) => {
          const account = await this.accounts.create(tx, {
            email: newEmail,
            cin: updated.cin,
            role: Role.PLAYER,
            firstName: updated.firstName,
            lastName: updated.lastName,
            phone: updated.phone,
          });
          await tx.player.update({ where: { id }, data: { userId: account.user.id } });
          return account;
        });
        credentials = await this.accounts.sendCredentials(created.user, created.password, Role.PLAYER);
      }
    }
    // Date ajoutée à un joueur importé sans inscription : inscription à la saison active avec la catégorie proposée.
    if (dto.birthDate && !player.birthDate) await this.enrollIfMissing(updated.id);
    await this.audit.log(actor.id, {
      action: 'Joueur modifié',
      entity: 'Player',
      entityId: id,
      target: fullName(updated),
      before: `${fullName(player)} · ${player.birthDate ? isoDay(player.birthDate) : 'date inconnue'} · ${player.gender}`,
      after: `${fullName(updated)} · ${updated.birthDate ? isoDay(updated.birthDate) : 'date inconnue'} · ${updated.gender}`,
    });
    return { ...(await this.get(id)), credentials };
  }

  /**
   * Fiche joueur d'un compte existant (ex. entraîneur ou parent qui joue aussi) : nom, email, téléphone et CIN repris du
   * compte, code TCSAY attribué, inscription à la saison active dans la catégorie proposée. Le rôle joueur est ajouté.
   */
  async createForAccount(actor: AuthUser, userId: string, data: { gender: Gender; birthDate: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { player: true } });
    if (!user) throw notFound('Compte');
    if (user.player) return user.player;
    const season = await this.access.activeSeason();
    const birthDate = dayFromIso(data.birthDate);
    const suggestion = await this.categories.suggest(birthDate, data.gender, season.startDate.getUTCFullYear());
    if ('error' in suggestion) throw new BadRequestException(suggestion.error);
    const player = await this.prisma.$transaction(async (tx) => {
      const code = await nextMemberCode(tx, season.startDate.getUTCFullYear());
      const created = await tx.player.create({
        data: {
          ...code,
          userId,
          firstName: user.firstName,
          lastName: user.lastName,
          birthDate,
          gender: data.gender,
          email: user.email,
          phone: user.phone,
          cin: user.cin,
        },
      });
      await tx.enrollment.create({ data: { playerId: created.id, seasonId: season.id, categoryId: suggestion.category.id } });
      if (!user.roles.includes(Role.PLAYER)) {
        await tx.user.update({ where: { id: userId }, data: { roles: [...user.roles, Role.PLAYER], version: { increment: 1 } } });
      }
      await this.audit.log(
        actor.id,
        {
          action: 'Fiche joueur créée pour un compte',
          entity: 'Player',
          entityId: created.id,
          target: fullName(created),
          after: `${code.memberCode} · ${suggestion.category.name}`,
        },
        tx,
      );
      return created;
    });
    return player;
  }

  /** Inscrit à la saison active (catégorie proposée) un joueur qui n'y est pas encore inscrit, si sa date est connue. */
  private async enrollIfMissing(playerId: string) {
    const season = await this.access.activeSeason().catch(() => null);
    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!season || !player?.birthDate) return;
    const exists = await this.prisma.enrollment.findUnique({ where: { playerId_seasonId: { playerId, seasonId: season.id } } });
    if (exists) return;
    const s = await this.categories.suggest(player.birthDate, player.gender, season.startDate.getUTCFullYear());
    if ('error' in s) return;
    await this.prisma.enrollment.create({ data: { playerId, seasonId: season.id, categoryId: s.category.id } });
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
    const suggestion = enrollment.player.birthDate
      ? await this.categories.suggest(enrollment.player.birthDate, enrollment.player.gender, season.startDate.getUTCFullYear())
      : { error: 'Date de naissance inconnue.' };
    const allowed = 'error' in suggestion ? [] : [suggestion.category.id, suggestion.alternative?.id];
    const reason = dto.derogationReason?.trim() || null;
    const target = await this.prisma.category.findUnique({ where: { id: dto.categoryId }, select: { family: true } });
    if (!target) throw notFound('Catégorie');
    if (target.family !== 'LEISURE' && !allowed.includes(dto.categoryId) && !reason) {
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

  /**
   * Recalcul des identifiants PROVISOIRES (après import de l'historique) : année = première saison où le joueur est inscrit,
   * n° par ordre d'arrivée dans l'année, à la suite des codes déjà définitifs. Renvoie les changements (aperçu).
   */
  async planMemberCodes() {
    const players = await this.prisma.player.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        memberCode: true,
        memberYear: true,
        memberSeq: true,
        memberCodeProvisional: true,
        enrollments: { select: { season: { select: { startDate: true } } } },
      },
    });
    const nextSeq = new Map<number, number>();
    for (const p of players) {
      if (!p.memberCodeProvisional && p.memberYear && p.memberSeq) {
        nextSeq.set(p.memberYear, Math.max(nextSeq.get(p.memberYear) ?? 0, p.memberSeq));
      }
    }
    const firstYear = (p: (typeof players)[number]) => {
      const years = p.enrollments.map((e) => e.season.startDate.getUTCFullYear());
      return years.length ? Math.min(...years) : (p.memberYear ?? p.createdAt.getUTCFullYear());
    };
    const provisional = players
      .filter((p) => p.memberCodeProvisional)
      .map((p) => ({ ...p, year: firstYear(p) }))
      .sort(
        (a, b) =>
          a.year - b.year ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.lastName.localeCompare(b.lastName, 'fr') ||
          a.firstName.localeCompare(b.firstName, 'fr'),
      );
    const plan = provisional.map((p) => {
      const seq = (nextSeq.get(p.year) ?? 0) + 1;
      nextSeq.set(p.year, seq);
      return { id: p.id, name: fullName(p), before: p.memberCode, year: p.year, seq, after: formatMemberCode(p.year, seq) };
    });
    return {
      provisional: provisional.length,
      definitive: players.length - provisional.length,
      changes: plan.filter((c) => c.before !== c.after),
      plan,
    };
  }

  async recomputeMemberCodes(actor: AuthUser) {
    const { plan, changes } = await this.planMemberCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('player-member-code'))`;
      // Deux temps pour éviter les collisions d'unicité pendant l'échange des n°.
      await tx.player.updateMany({ where: { id: { in: plan.map((p) => p.id) } }, data: { memberCode: null, memberYear: null, memberSeq: null } });
      for (const p of plan) {
        await tx.player.update({ where: { id: p.id }, data: { memberCode: p.after, memberYear: p.year, memberSeq: p.seq } });
      }
      await this.audit.log(
        actor.id,
        { action: 'Identifiants joueurs recalculés', entity: 'Player', target: `${plan.length} codes provisoires`, after: `${changes.length} modifié(s)` },
        tx,
      );
    });
    return { updated: changes.length, total: plan.length };
  }

  /** Validation définitive des codes (après vérification de l'historique) : ils ne seront plus jamais recalculés. */
  async finalizeMemberCodes(actor: AuthUser) {
    const { count } = await this.prisma.player.updateMany({
      where: { memberCodeProvisional: true, memberCode: { not: null } },
      data: { memberCodeProvisional: false },
    });
    await this.audit.log(actor.id, { action: 'Identifiants joueurs validés', entity: 'Player', target: `${count} code(s)`, before: 'Provisoires', after: 'Définitifs' });
    return { finalized: count };
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
    const age = p.birthDate ? ageAtYearEnd(p.birthDate, referenceYear) : null;
    return {
      id: p.id,
      memberCode: p.memberCode,
      memberCodeProvisional: p.memberCodeProvisional,
      firstName: p.firstName,
      lastName: p.lastName,
      birthDate: p.birthDate,
      gender: p.gender,
      email: p.email,
      phone: p.phone,
      cin: p.cin,
      hasAccount: Boolean(p.userId),
      archivedAt: p.archivedAt,
      version: p.version,
      age,
      // Date inconnue (import) : traité comme mineur jusqu'à vérification.
      minor: age === null || age < 18,
      birthYearOnly: p.birthYearOnly,
      nameAr: p.nameAr,
      city: p.city,
      notes: p.notes,
      origin: p.origin,
      importRef: p.importRef,
      enrolled: Boolean(enrollment),
      category: enrollment?.category ?? null,
      derogationReason: enrollment?.derogationReason ?? null,
      group: group ? { id: group.id, name: group.name } : null,
      parents: p.parentLinks.map((l) => l.parent),
    };
  }
}
