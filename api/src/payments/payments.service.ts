import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { isoDay, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { assertSeasonOpen, fullName, notFound, rule } from '../common/rules';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

export type InstallmentStatus = 'PAID' | 'PARTIAL' | 'DUE' | 'LATE';

const include = {
  payments: { orderBy: { paidAt: 'asc' as const } },
  membership: {
    include: {
      enrollment: {
        include: {
          player: { select: { id: true, firstName: true, lastName: true, email: true } },
          season: { select: { id: true, label: true, status: true } },
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
  async installments(user: AuthUser, seasonId?: string, playerId?: string) {
    const season = await this.access.seasonOrActive(seasonId);
    const pid = user.role === Role.ADMIN ? playerId : await this.access.resolvePlayer(user, playerId);
    const rows = await this.prisma.installment.findMany({
      where: { membership: { enrollment: { seasonId: season.id, playerId: pid, player: { archivedAt: null } } } },
      include,
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
    });
    return rows.map((r) => this.view(r));
  }

  /** Encaissement en espèces par l'admin. R7 : jamais au-delà du restant. */
  async cash(actor: AuthUser, installmentId: string, amount: number, note?: string) {
    const inst = await this.find(installmentId);
    assertSeasonOpen(inst.membership.enrollment.season);
    const { paid, remaining } = this.view(inst);
    if (amount <= 0) throw new BadRequestException('Saisissez un montant positif.');
    if (amount > remaining + 1e-9) throw new BadRequestException(`Montant supérieur au restant (${dt(remaining)}).`);
    const player = inst.membership.enrollment.player;
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: { installmentId, amount, method: 'CASH', recordedById: actor.id, note: note?.trim() || null },
      });
      await this.audit.log(
        actor.id,
        {
          action: 'Paiement encaissé (espèces)',
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

  /** Crée la cotisation et ses tranches depuis le tarif (groupe du joueur, sinon catégorie). */
  async createMembership(actor: AuthUser, playerId: string, seasonId?: string) {
    const season = await this.access.seasonOrActive(seasonId);
    assertSeasonOpen(season);
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { playerId_seasonId: { playerId, seasonId: season.id } },
      include: { membership: true, player: true, groups: true },
    });
    if (!enrollment) throw notFound('Inscription');
    if (enrollment.membership) throw rule.conflict('R7', 'Cotisation déjà créée pour cette saison.');
    const groupIds = enrollment.groups.map((g) => g.groupId);
    const fee =
      (groupIds.length
        ? await this.prisma.feeSchedule.findFirst({ where: { seasonId: season.id, groupId: { in: groupIds } } })
        : null) ??
      (await this.prisma.feeSchedule.findFirst({
        where: { seasonId: season.id, categoryId: enrollment.categoryId, groupId: null },
      })) ??
      (await this.prisma.feeSchedule.findFirst({ where: { seasonId: season.id, categoryId: enrollment.categoryId } }));
    if (!fee) throw new BadRequestException('Aucun tarif pour la catégorie ou le groupe de ce joueur : créez d’abord le tarif.');

    const total = num(fee.amount);
    const n = fee.installmentsCount;
    const base = Math.floor((total / n) * 1000) / 1000;
    const start = season.startDate;
    const membership = await this.prisma.$transaction(async (tx) => {
      const m = await tx.membership.create({ data: { enrollmentId: enrollment.id, feeScheduleId: fee.id, totalAmount: total } });
      for (let i = 0; i < n; i++) {
        // Échéances réparties sur 9 mois à partir du 2e mois de saison (à ajuster par l'admin).
        const due = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1 + Math.floor((i * 9) / n), 15));
        const amount = i === n - 1 ? Math.round((total - base * (n - 1)) * 1000) / 1000 : base;
        await tx.installment.create({ data: { membershipId: m.id, number: i + 1, count: n, dueDate: due, amount } });
      }
      await this.audit.log(
        actor.id,
        {
          action: 'Cotisation créée',
          entity: 'Membership',
          entityId: m.id,
          target: `${fullName(enrollment.player)} · ${season.label}`,
          after: `${dt(total)} en ${n} tranche(s)`,
        },
        tx,
      );
      return m;
    });
    return membership;
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
      player: r.membership.enrollment.player,
      season: r.membership.enrollment.season,
      payments: r.payments.map((p) => ({ id: p.id, amount: num(p.amount), paidAt: p.paidAt, method: p.method, kind: p.kind })),
    };
  }

  private async find(id: string) {
    const inst = await this.prisma.installment.findUnique({ where: { id }, include });
    if (!inst) throw notFound('Tranche');
    return inst;
  }
}
