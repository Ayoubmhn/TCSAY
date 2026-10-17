import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DiscountKind, PaymentMethod, PaymentPlan, Prisma, Role } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { addDaysIso, dayFromIso, isoDay, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { assertSeasonOpen, fullName, notFound, rule } from '../common/rules';
import { MailService } from '../mail/mail.service';
import { Db, PrismaService } from '../prisma/prisma.service';
import { normalizePaymentConfig, type PaymentConfig } from './payment-config';
import { PaymentConfigService } from './payment-config.service';
import { DISCOUNT_LABEL, PLAN_LABEL, planInstallments } from './payment-plan';

const METHOD_TEXT: Record<PaymentMethod, string> = { CASH: 'espèces', CHEQUE: 'chèque', TRANSFER: 'virement', ONLINE: 'en ligne' };

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
    private readonly config: PaymentConfigService,
  ) {}

  /** Mode proposé par le club (Réglages › Configuration des paiements). */
  private async assertPlan(plan: PaymentPlan) {
    const cfg = await this.config.get();
    if (!cfg.plans[plan]) throw new BadRequestException(`Mode « ${PLAN_LABEL[plan]} » non proposé par le club (Configuration des paiements).`);
    return cfg;
  }

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

  /**
   * Nouvelle date limite d'une tranche non soldée (accord avec la famille, erreur de saisie). Motif obligatoire, audit ;
   * repousser l'échéance permet de prévenir à nouveau la famille si elle est encore dépassée plus tard.
   */
  async changeDueDate(actor: AuthUser, installmentId: string, dueDate: string, reason: string) {
    const inst = await this.find(installmentId);
    assertSeasonOpen(inst.membership.enrollment.season);
    const { remaining } = this.view(inst);
    if (remaining === 0) throw new BadRequestException('Tranche déjà payée : la date limite ne change plus.');
    const before = isoDay(inst.dueDate);
    if (before === dueDate) return this.view(inst);
    await this.prisma.installment.update({
      where: { id: installmentId },
      data: { dueDate: dayFromIso(dueDate), lateNotifiedAt: null, remindedAt: null, relanceCount: 0, relanceAt: null, version: { increment: 1 } },
    });
    const player = inst.membership.enrollment.player;
    await this.audit.log(actor.id, {
      action: 'Date limite modifiée',
      entity: 'Installment',
      entityId: installmentId,
      target: `${fullName(player)} · tranche ${inst.number}/${inst.count}`,
      before,
      after: dueDate,
      reason,
    });
    return this.view(await this.find(installmentId));
  }

  /**
   * Encaissement par l'admin (modes acceptés par le club). R7 : jamais au-delà du restant. « Plusieurs tranches » :
   * un montant supérieur au restant est réparti sur les tranches suivantes de la cotisation (même lot, un seul reçu).
   */
  async cash(
    actor: AuthUser,
    installmentId: string,
    amount: number,
    note?: string,
    method: PaymentMethod = PaymentMethod.CASH,
    chequeNumber?: string,
    spread = false,
  ) {
    const cfg = await this.config.get();
    if (!cfg.collect.methods.includes(method)) throw new BadRequestException(`Mode « ${METHOD_TEXT[method]} » non accepté par le club.`);
    const inst = await this.find(installmentId);
    assertSeasonOpen(inst.membership.enrollment.season);
    const { paid, remaining } = this.view(inst);
    if (amount <= 0) throw new BadRequestException('Saisissez un montant positif.');
    // Tranches à régler : celle-ci, puis (plusieurs tranches) les suivantes non soldées.
    const targets: { id: string; number: number; count: number; remaining: number }[] = [{ id: inst.id, number: inst.number, count: inst.count, remaining }];
    if (spread && amount > remaining + 1e-9) {
      if (!cfg.collect.multi) throw new BadRequestException('Paiement de plusieurs tranches en une fois désactivé (Configuration des paiements).');
      const next = await this.prisma.installment.findMany({
        where: { membershipId: inst.membershipId, number: { gt: inst.number } },
        include: { payments: { select: { amount: true } } },
        orderBy: { number: 'asc' },
      });
      for (const n of next) {
        const rem = Math.round((num(n.amount) - n.payments.reduce((t, p) => t + num(p.amount), 0)) * 1000) / 1000;
        if (rem > 0) targets.push({ id: n.id, number: n.number, count: n.count, remaining: rem });
      }
    }
    const max = Math.round(targets.reduce((t, x) => t + x.remaining, 0) * 1000) / 1000;
    if (amount > max + 1e-9) throw new BadRequestException(`Montant supérieur au restant (${dt(max)}).`);
    const player = inst.membership.enrollment.player;
    const batchId = targets.length > 1 && amount > remaining + 1e-9 ? randomUUID() : null;
    const ids: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      let left = amount;
      for (const t of targets) {
        if (left <= 1e-9) break;
        const part = Math.round(Math.min(left, t.remaining) * 1000) / 1000;
        left = Math.round((left - part) * 1000) / 1000;
        const p = await tx.payment.create({
          data: {
            installmentId: t.id,
            amount: part,
            method,
            chequeNumber: method === PaymentMethod.CHEQUE ? chequeNumber?.trim() || null : null,
            batchId,
            recordedById: actor.id,
            note: note?.trim() || null,
          },
        });
        ids.push(p.id);
      }
      await this.audit.log(
        actor.id,
        {
          action: `Paiement encaissé (${METHOD_TEXT[method]}${method === PaymentMethod.CHEQUE && chequeNumber?.trim() ? ` n° ${chequeNumber.trim()}` : ''})`,
          entity: 'Payment',
          entityId: installmentId,
          target: `${fullName(player)} · ${ids.length > 1 ? `Tranches ${targets.slice(0, ids.length).map((t) => t.number).join(', ')}/${inst.count}` : `Tranche ${inst.number}/${inst.count}`}`,
          before: dt(paid),
          after: `${dt(amount)} encaissé${ids.length > 1 ? ` sur ${ids.length} tranches` : ''}`,
        },
        tx,
      );
    });
    return { ...this.view(await this.find(installmentId)), paymentId: ids[0], paymentIds: ids };
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
    const cfg = await this.assertPlan(plan);
    const fee = await this.findFee(db, season.id, enrollment.categoryId, groupIds);
    if (!fee) return null;
    const total = num(fee.amount);
    // Loisirs : échéancier sur la période loisirs (octobre → juin) ; compétitif : toute la saison (jusqu'en août).
    const category = await db.category.findUnique({ where: { id: enrollment.categoryId }, select: { family: true } });
    const period =
      category?.family === 'LEISURE'
        ? { startDate: season.leisureStartDate ?? season.startDate, endDate: season.leisureEndDate ?? season.endDate }
        : season;
    const schedule = planInstallments(plan, total, num(fee.depositAmount), period, todayIso(), cfg);
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

  /** Inscription de la saison avec sa cotisation, ses tranches et leurs paiements (pour les changements d'échéancier). */
  private async loadEnrollment(playerId: string, seasonId: string) {
    return this.prisma.enrollment.findUnique({
      where: { playerId_seasonId: { playerId, seasonId } },
      include: {
        player: true,
        groups: true,
        category: { select: { family: true } },
        membership: { include: { installments: { include: { payments: true }, orderBy: { number: 'asc' } } } },
      },
    });
  }

  /**
   * Refait l'échéancier d'une cotisation pour un nouveau montant dû et / ou un nouveau mode : les tranches déjà réglées
   * sont gardées (une tranche partielle est ramenée au montant payé), le reste est réparti selon le mode.
   */
  private async reschedule(
    tx: Db,
    m: { id: string; feeScheduleId: string | null; installments: { id: string; amount: Prisma.Decimal; payments: { amount: Prisma.Decimal }[] }[] },
    plan: PaymentPlan,
    total: number,
    period: { startDate: Date; endDate: Date },
    cfg?: PaymentConfig,
    dueDates?: string[],
  ) {
    const config = cfg ?? (await this.config.get());
    const paidOf = (i: (typeof m.installments)[number]) => i.payments.reduce((t, p) => t + num(p.amount), 0);
    const paidTotal = m.installments.reduce((t, i) => t + paidOf(i), 0);
    const rest = Math.round((total - paidTotal) * 1000) / 1000;
    const fee = m.feeScheduleId ? await tx.feeSchedule.findUnique({ where: { id: m.feeScheduleId } }) : null;
    // Acompte du tarif seulement si rien n'a encore été payé (et jamais au-delà du montant dû).
    const deposit = paidTotal > 0 ? 0 : Math.min(num(fee?.depositAmount ?? 0), total);
    const schedule = rest > 0 ? planInstallments(plan, rest, deposit, period, todayIso(), config) : [];
    // Dates choisies pour ce joueur (motif obligatoire, vérifié par l'appelant).
    if (dueDates?.length) {
      if (dueDates.length !== schedule.length) throw new BadRequestException(`Indiquez ${schedule.length} date(s), une par tranche.`);
      dueDates.forEach((d, i) => (schedule[i].dueDate = d));
    }
    const kept: string[] = [];
    for (const i of m.installments) {
      const paid = paidOf(i);
      if (paid <= 0) {
        await tx.installment.delete({ where: { id: i.id } });
      } else {
        if (paid < num(i.amount)) await tx.installment.update({ where: { id: i.id }, data: { amount: paid } });
        kept.push(i.id);
      }
    }
    const count = kept.length + schedule.length;
    for (const [k, id] of kept.entries()) await tx.installment.update({ where: { id }, data: { number: k + 1, count } });
    for (const [k, inst] of schedule.entries()) {
      await tx.installment.create({
        data: { membershipId: m.id, number: kept.length + k + 1, count, dueDate: dayFromIso(inst.dueDate), amount: inst.amount },
      });
    }
    return { rest, count: schedule.length, paidTotal };
  }

  private periodOf(
    family: string,
    season: { startDate: Date; endDate: Date; leisureStartDate?: Date | null; leisureEndDate?: Date | null },
  ) {
    return family === 'LEISURE'
      ? { startDate: season.leisureStartDate ?? season.startDate, endDate: season.leisureEndDate ?? season.endDate }
      : season;
  }

  /**
   * Change le mode de paiement (comptant, semestre, mois) d'un joueur pour la saison. Pas encore de cotisation : elle est
   * créée. R7 : avant tout paiement, l'échéancier est simplement refait ; après un paiement, motif obligatoire, les
   * tranches déjà réglées sont gardées et le reste est rééchelonné.
   */
  async changePlan(actor: AuthUser, playerId: string, plan: PaymentPlan, reason?: string, seasonId?: string, dueDates?: string[]) {
    const season = await this.access.seasonOrActive(seasonId);
    assertSeasonOpen(season);
    const custom = Boolean(dueDates?.length);
    const motif = reason?.trim() || null;
    if (custom && !motif) throw rule.bad('R7', 'Dates choisies pour ce joueur : motif obligatoire.');
    let enrollment = await this.loadEnrollment(playerId, season.id);
    if (!enrollment) throw rule.bad('R7', 'Joueur non inscrit sur la saison : complétez sa date de naissance (catégorie) d’abord.');
    if (!enrollment.membership) {
      const m = await this.createMembership(actor, playerId, plan, season.id);
      if (!custom) return { created: true, membershipId: m.id };
      enrollment = (await this.loadEnrollment(playerId, season.id))!;
    }
    const m = enrollment.membership!;
    if (m.paymentPlan === plan && !custom) return { created: false, membershipId: m.id };
    if (m.paymentPlan !== plan) await this.assertPlan(plan);
    const paid = m.installments.some((i) => i.payments.length > 0);
    if (paid && !motif) throw rule.bad('R7', 'Des paiements sont déjà encaissés : motif obligatoire pour changer le mode de paiement.');
    await this.prisma.$transaction(async (tx) => {
      const r = await this.reschedule(tx, m, plan, num(m.totalAmount), this.periodOf(enrollment.category.family, season), undefined, dueDates);
      await tx.membership.update({ where: { id: m.id }, data: { paymentPlan: plan, version: { increment: 1 } } });
      await this.audit.log(
        actor.id,
        {
          action: 'Mode de paiement modifié',
          entity: 'Membership',
          entityId: m.id,
          target: `${fullName(enrollment.player)} · ${season.label}`,
          before: PLAN_LABEL[m.paymentPlan],
          after: `${PLAN_LABEL[plan]} · ${dt(r.rest)} restant en ${r.count} tranche(s)${custom ? ` · dates choisies : ${dueDates!.join(', ')}` : ''}`,
          reason: motif,
        },
        tx,
      );
    });
    return { created: false, membershipId: m.id };
  }

  /**
   * Réduction sur la cotisation : fratrie (pourcentage saisi pour le 2e enfant…), réduction spéciale (pourcentage ou
   * montant) ou exonération totale ; `kind` null retire la réduction. Le montant dû est recalculé depuis le tarif
   * (montant avant réduction) et l'échéancier refait. R7 : motif obligatoire, et jamais en dessous de ce qui est déjà payé.
   */
  async setDiscount(
    actor: AuthUser,
    playerId: string,
    d: { kind: DiscountKind | null; percent?: number; amount?: number; reason?: string },
    seasonId?: string,
  ) {
    const season = await this.access.seasonOrActive(seasonId);
    assertSeasonOpen(season);
    const enrollment = await this.loadEnrollment(playerId, season.id);
    if (!enrollment?.membership) throw rule.bad('R7', 'Pas encore de cotisation : choisissez d’abord le mode de paiement.');
    const m = enrollment.membership;
    const base = num(m.baseAmount ?? m.totalAmount);
    let discount = 0;
    if (d.kind === DiscountKind.EXEMPT) discount = base;
    else if (d.kind) {
      if (d.percent !== undefined && d.percent !== null) {
        if (d.percent <= 0 || d.percent > 100) throw new BadRequestException('Pourcentage entre 1 et 100.');
        discount = Math.round(base * d.percent * 10) / 1000;
      } else if (d.amount !== undefined && d.amount !== null) {
        if (d.amount <= 0 || d.amount > base) throw new BadRequestException(`Montant de réduction entre 0 et ${dt(base)}.`);
        discount = Math.round(d.amount * 1000) / 1000;
      } else throw new BadRequestException('Indiquez un pourcentage ou un montant de réduction.');
    }
    const total = Math.round((base - discount) * 1000) / 1000;
    const motif = d.reason?.trim() || null;
    if (d.kind && !motif) throw rule.bad('R7', 'Motif de la réduction obligatoire (ex. 2e enfant de la famille).');
    const paidTotal = m.installments.reduce((t, i) => t + i.payments.reduce((u, p) => u + num(p.amount), 0), 0);
    if (paidTotal > total + 0.0005) {
      throw rule.conflict('R7', `Déjà payé ${dt(paidTotal)} : plus que le nouveau montant (${dt(total)}). Un remboursement est nécessaire, pas une réduction.`);
    }
    const label = (k: DiscountKind | null, pct: number | null, amt: number) =>
      !k ? 'Aucune réduction' : k === DiscountKind.EXEMPT ? 'Exonération totale' : `${DISCOUNT_LABEL[k]} ${pct ? `${pct} %` : dt(amt)}`;
    await this.prisma.$transaction(async (tx) => {
      await this.reschedule(tx, m, m.paymentPlan, total, this.periodOf(enrollment.category.family, season));
      await tx.membership.update({
        where: { id: m.id },
        data: {
          baseAmount: base,
          totalAmount: total,
          discountKind: d.kind,
          discountPercent: d.kind && d.kind !== DiscountKind.EXEMPT && d.percent ? d.percent : null,
          discountAmount: d.kind ? discount : null,
          discountReason: d.kind ? motif : null,
          version: { increment: 1 },
        },
      });
      await this.audit.log(
        actor.id,
        {
          action: 'Réduction de cotisation',
          entity: 'Membership',
          entityId: m.id,
          target: `${fullName(enrollment.player)} · ${season.label}`,
          before: `${label(m.discountKind, m.discountPercent ? num(m.discountPercent) : null, num(m.discountAmount ?? 0))} · dû ${dt(num(m.totalAmount))}`,
          after: `${label(d.kind, d.percent ?? null, discount)} · dû ${dt(total)}`,
          reason: motif,
        },
        tx,
      );
    });
    return { total, discount, base };
  }

  /** Cotisation d'un joueur pour la fiche « Modifier » : montants, réduction, frères et sœurs inscrits (même parent). */
  async membershipInfo(playerId: string, seasonId?: string) {
    const season = await this.access.seasonOrActive(seasonId);
    const enrollment = await this.loadEnrollment(playerId, season.id);
    const parents = await this.prisma.parentLink.findMany({ where: { playerId }, select: { parentId: true } });
    const siblings = parents.length
      ? await this.prisma.player.findMany({
          where: {
            id: { not: playerId },
            archivedAt: null,
            parentLinks: { some: { parentId: { in: parents.map((p) => p.parentId) } } },
            enrollments: { some: { seasonId: season.id } },
          },
          select: { id: true, firstName: true, lastName: true, birthDate: true },
          orderBy: { birthDate: 'asc' },
        })
      : [];
    const m = enrollment?.membership;
    return {
      siblings: siblings.map((p) => ({ id: p.id, name: fullName(p) })),
      membership: m
        ? {
            paymentPlan: m.paymentPlan,
            base: num(m.baseAmount ?? m.totalAmount),
            total: num(m.totalAmount),
            paid: m.installments.reduce((t, i) => t + i.payments.reduce((u, p) => u + num(p.amount), 0), 0),
            discountKind: m.discountKind,
            discountPercent: m.discountPercent ? num(m.discountPercent) : null,
            discountAmount: m.discountAmount ? num(m.discountAmount) : null,
            discountReason: m.discountReason,
          }
        : null,
    };
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

  /** Aperçu des échéanciers d'une configuration (enregistrée ou en cours de saisie) pour un montant. */
  async previewConfig(raw: unknown, amount: number, deposit = 0) {
    const cfg = raw ? normalizePaymentConfig(raw) : await this.config.get();
    const season = await this.access.activeSeason();
    const today = todayIso();
    return (Object.keys(cfg.plans) as PaymentPlan[])
      .filter((p) => cfg.plans[p])
      .map((plan) => ({ plan, label: PLAN_LABEL[plan], schedule: planInstallments(plan, amount, deposit, season, today, cfg) }));
  }

  /**
   * Aperçu dans la fiche joueur : tranches déjà payées gardées et nouvelles tranches selon le mode choisi
   * (joueur inscrit), ou échéancier d'une nouvelle inscription d'après le tarif de la catégorie.
   */
  async previewPlan(plan: PaymentPlan, playerId?: string, categoryId?: string) {
    const season = await this.access.activeSeason();
    const cfg = await this.config.get();
    const today = todayIso();
    if (playerId) {
      const e = await this.loadEnrollment(playerId, season.id);
      if (e?.membership) {
        const m = e.membership;
        const paidOf = (i: (typeof m.installments)[number]) => i.payments.reduce((t, p) => t + num(p.amount), 0);
        const kept = m.installments.filter((i) => paidOf(i) > 0).map((i) => ({ dueDate: isoDay(i.dueDate), amount: Math.round(paidOf(i) * 1000) / 1000, paid: true }));
        const paidTotal = kept.reduce((t, k) => t + k.amount, 0);
        const total = num(m.totalAmount);
        const fee = m.feeScheduleId ? await this.prisma.feeSchedule.findUnique({ where: { id: m.feeScheduleId } }) : null;
        const deposit = paidTotal > 0 ? 0 : Math.min(num(fee?.depositAmount ?? 0), total);
        const rest = Math.round((total - paidTotal) * 1000) / 1000;
        const next = rest > 0 ? planInstallments(plan, rest, deposit, this.periodOf(e.category.family, season), today, cfg) : [];
        return { total, enabled: cfg.plans[plan], tranches: [...kept, ...next.map((n) => ({ ...n, paid: false }))], newCount: next.length };
      }
      if (e) categoryId = e.categoryId;
    }
    if (!categoryId) return { total: 0, enabled: cfg.plans[plan], tranches: [], newCount: 0 };
    const fee = await this.findFee(this.prisma, season.id, categoryId);
    if (!fee) return { total: 0, enabled: cfg.plans[plan], tranches: [], newCount: 0 };
    const category = await this.prisma.category.findUnique({ where: { id: categoryId }, select: { family: true } });
    const next = planInstallments(plan, num(fee.amount), num(fee.depositAmount), this.periodOf(category?.family ?? '', season), today, cfg);
    return { total: num(fee.amount), enabled: cfg.plans[plan], tranches: next.map((n) => ({ ...n, paid: false })), newCount: next.length };
  }

  /**
   * Après un changement de configuration : refait les tranches non payées des cotisations de la saison active selon
   * la nouvelle configuration (tranches payées gardées, R7 : motif obligatoire, audit). Retourne le nombre de cotisations.
   */
  async rescheduleAll(actor: AuthUser, reason: string) {
    const season = await this.access.activeSeason();
    assertSeasonOpen(season);
    const cfg = await this.config.get();
    const list = await this.prisma.membership.findMany({
      where: { enrollment: { seasonId: season.id, player: { archivedAt: null } } },
      include: { installments: { include: { payments: true }, orderBy: { number: 'asc' } }, enrollment: { select: { category: { select: { family: true } } } } },
    });
    let done = 0;
    for (const m of list) {
      const paid = m.installments.reduce((t, i) => t + i.payments.reduce((u, p) => u + num(p.amount), 0), 0);
      if (paid >= num(m.totalAmount) - 0.0005) continue;
      await this.prisma.$transaction((tx) => this.reschedule(tx, m, m.paymentPlan, num(m.totalAmount), this.periodOf(m.enrollment.category.family, season), cfg));
      done++;
    }
    await this.audit.log(actor.id, {
      action: 'Échéanciers refaits (configuration des paiements)',
      entity: 'Membership',
      target: `Saison ${season.label}`,
      after: `${done} cotisation(s) rééchelonnée(s)`,
      reason,
    });
    return { rescheduled: done };
  }

  view(r: Row) {
    const amount = num(r.amount);
    const paid = num(r.payments.reduce((sum, p) => sum + num(p.amount), 0));
    const remaining = Math.max(0, Math.round((amount - paid) * 1000) / 1000);
    const due = isoDay(r.dueDate);
    // En retard : échéance dépassée du délai de grâce réglé par le club.
    const grace = this.config.current().reminders.graceDays;
    const status: InstallmentStatus =
      remaining === 0 ? 'PAID' : addDaysIso(due, grace) < todayIso() ? 'LATE' : paid > 0 ? 'PARTIAL' : 'DUE';
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
