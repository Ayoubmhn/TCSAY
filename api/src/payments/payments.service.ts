import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentPlan, Prisma, Role } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { dayFromIso, isoDay, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { assertSeasonOpen, fullName, notFound, rule } from '../common/rules';
import { MailService } from '../mail/mail.service';
import { Db, PrismaService } from '../prisma/prisma.service';
import { PLAN_LABEL, planInstallments } from './payment-plan';

export type InstallmentStatus = 'PAID' | 'PARTIAL' | 'DUE' | 'LATE';
export type InstallmentFilters = { q?: string; parentId?: string; groupId?: string };

const include = {
  payments: {
    orderBy: { paidAt: 'asc' as const },
    include: { receipts: { where: { voidedAt: null }, select: { id: true, number: true } } },
  },
  membership: {
    include: {
      enrollment: {
        include: {
          player: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              parentLinks: { select: { parent: { select: { id: true, firstName: true, lastName: true } } } },
            },
          },
          season: { select: { id: true, label: true, status: true } },
          groups: { select: { group: { select: { id: true, name: true } } } },
        },
      },
    },
  },
} satisfies Prisma.InstallmentInclude;

type Row = Prisma.InstallmentGetPayload<{ include: typeof include }>;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** Tranches d'une saison (admin : toutes ; joueur/parent : les siennes). Le coach n'y a jamais accès (403 par @Roles). */
  async installments(user: AuthUser, seasonId?: string, playerId?: string, filters: InstallmentFilters = {}) {
    const season = await this.access.seasonOrActive(seasonId);
    const isAdmin = user.role === Role.ADMIN;
    const pid = isAdmin ? playerId : await this.access.resolvePlayer(user, playerId);
    // Administration : recherche par nom du joueur ou du parent, filtre par parent et par groupe.
    const q = isAdmin ? filters.q?.trim() : undefined;
    const name = (term: string) => [
      { firstName: { contains: term, mode: 'insensitive' as const } },
      { lastName: { contains: term, mode: 'insensitive' as const } },
    ];
    const rows = await this.prisma.installment.findMany({
      where: {
        membership: {
          enrollment: {
            seasonId: season.id,
            playerId: pid,
            player: {
              archivedAt: null,
              ...(q ? { OR: [...name(q), { parentLinks: { some: { parent: { OR: name(q) } } } }] } : {}),
              ...(isAdmin && filters.parentId ? { parentLinks: { some: { parentId: filters.parentId } } } : {}),
            },
            ...(isAdmin && filters.groupId ? { groups: { some: { groupId: filters.groupId } } } : {}),
          },
        },
      },
      include,
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
    });
    return rows.map((r) => this.view(r));
  }

  /** Encaissement par l'admin (espèces ou chèque). R7 : jamais au-delà du restant. */
  async cash(actor: AuthUser, installmentId: string, amount: number, note?: string, method: 'CASH' | 'CHEQUE' = 'CASH', chequeNumber?: string) {
    const inst = await this.find(installmentId);
    assertSeasonOpen(inst.membership.enrollment.season);
    const { paid, remaining } = this.view(inst);
    if (amount <= 0) throw new BadRequestException('Saisissez un montant positif.');
    if (amount > remaining + 1e-9) throw new BadRequestException(`Montant supérieur au restant (${dt(remaining)}).`);
    const player = inst.membership.enrollment.player;
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          installmentId,
          amount,
          method,
          chequeNumber: method === 'CHEQUE' ? chequeNumber?.trim() || null : null,
          recordedById: actor.id,
          note: note?.trim() || null,
        },
      });
      await this.audit.log(
        actor.id,
        {
          action: method === 'CHEQUE' ? `Paiement encaissé (chèque${chequeNumber?.trim() ? ` n° ${chequeNumber.trim()}` : ''})` : 'Paiement encaissé (espèces)',
          entity: 'Payment',
          entityId: installmentId,
          target: `${fullName(player)} · Tranche ${inst.number}/${inst.count}`,
          before: dt(paid),
          after: dt(paid + amount),
        },
        tx,
      );
    });
    return this.view(await this.find(installmentId));
  }

  /** Rappel de tranche en retard, envoyé au parent (mineur) ou au joueur. */
  async remind(actor: AuthUser, installmentId: string) {
    const inst = await this.find(installmentId);
    const player = inst.membership.enrollment.player;
    const parent = await this.prisma.parentLink.findFirst({
      where: { playerId: player.id, parent: { isActive: true } },
      include: { parent: true },
    });
    const to = parent?.parent.email ?? player.email;
    if (!to) throw new BadRequestException('Aucune adresse email pour ce joueur ni ses parents.');
    const { remaining } = this.view(inst);
    const subject = `Rappel : tranche ${inst.number}/${inst.count} de ${player.firstName} en retard`;
    await this.mail.send(
      to,
      subject,
      `Bonjour,\n\nLa tranche ${inst.number}/${inst.count} de ${fullName(player)} (échéance ${isoDay(inst.dueDate)}) reste à régler : ${dt(remaining)}.\nLe paiement en espèces se fait au club.\n\nLe bureau du TCSAY`,
      'REMINDER',
    );
    await this.audit.log(actor.id, { action: 'Rappel envoyé', entity: 'Installment', entityId: installmentId, target: subject });
    return { sentTo: to };
  }

  /** Tarif applicable : celui du groupe du joueur, sinon celui de sa catégorie. */
  async findFee(db: Db, seasonId: string, categoryId: string, groupIds: string[] = []) {
    return (
      (groupIds.length ? await db.feeSchedule.findFirst({ where: { seasonId, groupId: { in: groupIds } } }) : null) ??
      (await db.feeSchedule.findFirst({ where: { seasonId, categoryId, groupId: null } })) ??
      (await db.feeSchedule.findFirst({ where: { seasonId, categoryId } }))
    );
  }

  /**
   * Crée la cotisation et ses tranches depuis le tarif, selon le mode de paiement choisi
   * (comptant, par semestre, par mois ; acompte défini dans le tarif). Utilisable dans une transaction.
   */
  async buildMembership(
    db: Db,
    actorId: string,
    enrollment: { id: string; categoryId: string; player: { firstName: string; lastName: string } },
    season: { id: string; label: string; startDate: Date; endDate: Date; leisureStartDate?: Date | null; leisureEndDate?: Date | null },
    plan: PaymentPlan,
    groupIds: string[] = [],
  ) {
    const fee = await this.findFee(db, season.id, enrollment.categoryId, groupIds);
    if (!fee) return null;
    const total = num(fee.amount);
    // Loisirs : échéancier sur la période loisirs (octobre → juin) ; compétitif : toute la saison (jusqu'en août).
    const category = await db.category.findUnique({ where: { id: enrollment.categoryId }, select: { family: true } });
    const period =
      category?.family === 'LEISURE'
        ? { startDate: season.leisureStartDate ?? season.startDate, endDate: season.leisureEndDate ?? season.endDate }
        : season;
    const schedule = planInstallments(plan, total, num(fee.depositAmount), period, todayIso());
    const m = await db.membership.create({
      data: { enrollmentId: enrollment.id, feeScheduleId: fee.id, paymentPlan: plan, totalAmount: total },
    });
    for (const [i, inst] of schedule.entries()) {
      await db.installment.create({
        data: { membershipId: m.id, number: i + 1, count: schedule.length, dueDate: dayFromIso(inst.dueDate), amount: inst.amount },
      });
    }
    await this.audit.log(
      actorId,
      {
        action: 'Cotisation créée',
        entity: 'Membership',
        entityId: m.id,
        target: `${fullName(enrollment.player)} · ${season.label}`,
        after: `${dt(total)} · ${PLAN_LABEL[plan]} · ${schedule.length} tranche(s)`,
      },
      db,
    );
    return { membership: m, schedule };
  }

  /** Crée la cotisation d'un joueur déjà inscrit (si elle n'a pas été créée à l'inscription). */
  async createMembership(actor: AuthUser, playerId: string, plan: PaymentPlan, seasonId?: string) {
    const season = await this.access.seasonOrActive(seasonId);
    assertSeasonOpen(season);
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { playerId_seasonId: { playerId, seasonId: season.id } },
      include: { membership: true, player: true, groups: true },
    });
    if (!enrollment) throw notFound('Inscription');
    if (enrollment.membership) throw rule.conflict('R7', 'Cotisation déjà créée pour cette saison.');
    const result = await this.prisma.$transaction((tx) =>
      this.buildMembership(tx, actor.id, enrollment, season, plan, enrollment.groups.map((g) => g.groupId)),
    );
    if (!result) throw new BadRequestException('Aucun tarif pour la catégorie ou le groupe de ce joueur : créez d’abord le tarif.');
    return result.membership;
  }

  /**
   * Change le mode de paiement (comptant, semestre, mois) d'un joueur pour la saison. Pas encore de cotisation : elle est
   * créée. R7 : avant tout paiement, l'échéancier est simplement refait ; après un paiement, motif obligatoire, les
   * tranches déjà réglées sont gardées (une tranche partielle est ramenée au montant payé) et le reste est rééchelonné.
   */
  async changePlan(actor: AuthUser, playerId: string, plan: PaymentPlan, reason?: string, seasonId?: string) {
    const season = await this.access.seasonOrActive(seasonId);
    assertSeasonOpen(season);
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { playerId_seasonId: { playerId, seasonId: season.id } },
      include: {
        player: true,
        groups: true,
        category: { select: { family: true } },
        membership: { include: { installments: { include: { payments: true }, orderBy: { number: 'asc' } } } },
      },
    });
    if (!enrollment) throw rule.bad('R7', 'Joueur non inscrit sur la saison : complétez sa date de naissance (catégorie) d’abord.');
    if (!enrollment.membership) {
      const m = await this.createMembership(actor, playerId, plan, season.id);
      return { created: true, membershipId: m.id };
    }
    const m = enrollment.membership;
    if (m.paymentPlan === plan) return { created: false, membershipId: m.id };
    const paidOf = (i: (typeof m.installments)[number]) => i.payments.reduce((t, p) => t + num(p.amount), 0);
    const paidTotal = m.installments.reduce((t, i) => t + paidOf(i), 0);
    const motif = reason?.trim() || null;
    if (paidTotal > 0 && !motif) {
      throw rule.bad('R7', 'Des paiements sont déjà encaissés : motif obligatoire pour changer le mode de paiement.');
    }
    const fee = m.feeScheduleId ? await this.prisma.feeSchedule.findUnique({ where: { id: m.feeScheduleId } }) : null;
    const total = num(m.totalAmount);
    const rest = Math.round((total - paidTotal) * 1000) / 1000;
    const period =
      enrollment.category.family === 'LEISURE'
        ? { startDate: season.leisureStartDate ?? season.startDate, endDate: season.leisureEndDate ?? season.endDate }
        : season;
    // Acompte du tarif seulement si rien n'a encore été payé.
    const schedule = rest > 0 ? planInstallments(plan, rest, paidTotal > 0 ? 0 : num(fee?.depositAmount ?? 0), period, todayIso()) : [];
    await this.prisma.$transaction(async (tx) => {
      const kept: { id: string }[] = [];
      for (const i of m.installments) {
        const paid = paidOf(i);
        if (paid <= 0) {
          await tx.installment.delete({ where: { id: i.id } });
        } else {
          if (paid < num(i.amount)) await tx.installment.update({ where: { id: i.id }, data: { amount: paid } });
          kept.push({ id: i.id });
        }
      }
      const count = kept.length + schedule.length;
      for (const [k, i] of kept.entries()) await tx.installment.update({ where: { id: i.id }, data: { number: k + 1, count } });
      for (const [k, inst] of schedule.entries()) {
        await tx.installment.create({
          data: { membershipId: m.id, number: kept.length + k + 1, count, dueDate: dayFromIso(inst.dueDate), amount: inst.amount },
        });
      }
      await tx.membership.update({ where: { id: m.id }, data: { paymentPlan: plan } });
      await this.audit.log(
        actor.id,
        {
          action: 'Mode de paiement modifié',
          entity: 'Membership',
          entityId: m.id,
          target: `${fullName(enrollment.player)} · ${season.label}`,
          before: PLAN_LABEL[m.paymentPlan],
          after: `${PLAN_LABEL[plan]} · ${dt(rest)} restant en ${schedule.length} tranche(s)`,
          reason: motif,
        },
        tx,
      );
    });
    return { created: false, membershipId: m.id };
  }

  /**
   * Tous les joueurs inscrits doivent avoir leur cotisation : crée celles qui manquent (ex. joueurs importés du cahier)
   * avec le mode choisi. Les joueurs sans tarif pour leur catégorie / groupe sont listés.
   */
  async createMissing(actor: AuthUser, plan: PaymentPlan, seasonId?: string) {
    const season = await this.access.seasonOrActive(seasonId);
    assertSeasonOpen(season);
    const enrollments = await this.prisma.enrollment.findMany({
      where: { seasonId: season.id, membership: null, player: { archivedAt: null } },
      include: { player: true, groups: true, category: { select: { name: true } } },
      orderBy: { player: { lastName: 'asc' } },
    });
    let created = 0;
    const withoutFee: string[] = [];
    for (const e of enrollments) {
      const r = await this.prisma.$transaction((tx) => this.buildMembership(tx, actor.id, e, season, plan, e.groups.map((g) => g.groupId)));
      if (r) created++;
      else withoutFee.push(`${fullName(e.player)} (${e.category.name})`);
    }
    return { created, withoutFee };
  }

  /** Nombre de joueurs inscrits sans cotisation sur la saison (alerte de l'écran Joueurs). */
  async missingCount(seasonId?: string) {
    const season = await this.access.seasonOrActive(seasonId);
    const count = await this.prisma.enrollment.count({ where: { seasonId: season.id, membership: null, player: { archivedAt: null } } });
    return { count };
  }

  /** Paiements encaissés (lecture seule). */
  async payments(seasonId?: string) {
    const season = await this.access.seasonOrActive(seasonId);
    return this.prisma.payment.findMany({
      where: { installment: { membership: { enrollment: { seasonId: season.id } } } },
      orderBy: { paidAt: 'desc' },
      include: {
        recordedBy: { select: { firstName: true, lastName: true } },
        installment: {
          select: {
            number: true,
            count: true,
            membership: { select: { enrollment: { select: { player: { select: { firstName: true, lastName: true } } } } } },
          },
        },
      },
    });
  }

  view(r: Row) {
    const amount = num(r.amount);
    const paid = num(r.payments.reduce((sum, p) => sum + num(p.amount), 0));
    const remaining = Math.max(0, Math.round((amount - paid) * 1000) / 1000);
    const due = isoDay(r.dueDate);
    const status: InstallmentStatus =
      remaining === 0 ? 'PAID' : due < todayIso() ? 'LATE' : paid > 0 ? 'PARTIAL' : 'DUE';
    return {
      id: r.id,
      number: r.number,
      count: r.count,
      dueDate: due,
      amount,
      paid,
      remaining,
      status,
      version: r.version,
      player: {
        id: r.membership.enrollment.player.id,
        firstName: r.membership.enrollment.player.firstName,
        lastName: r.membership.enrollment.player.lastName,
        email: r.membership.enrollment.player.email,
      },
      parents: r.membership.enrollment.player.parentLinks.map((l) => l.parent),
      groups: r.membership.enrollment.groups.map((g) => g.group),
      season: r.membership.enrollment.season,
      payments: r.payments.map((p) => ({
        id: p.id,
        amount: num(p.amount),
        paidAt: p.paidAt,
        method: p.method,
        chequeNumber: p.chequeNumber,
        kind: p.kind,
        receipt: p.receipts[0] ? { id: p.receipts[0].id, number: String(p.receipts[0].number).padStart(7, '0') } : null,
      })),
    };
  }

  private async find(id: string) {
    const inst = await this.prisma.installment.findUnique({ where: { id }, include });
    if (!inst) throw notFound('Tranche');
    return inst;
  }
}
