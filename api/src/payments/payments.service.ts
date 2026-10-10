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
