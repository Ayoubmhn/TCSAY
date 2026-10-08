import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentKind, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { dayFromIso, isoDay, localDayOf } from '../common/dates';
import { dt, num } from '../common/money';
import { fullName, notFound, rule } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';
import { amountInArabicWords } from './arabic-amount';
import { normalizeLayout, RECEIPT_LAYOUT_KEY, type ReceiptLayout } from './receipt-layout';

/** Numéro du carnet tel qu'imprimé (7 chiffres : 0002313). */
export const receiptNo = (n: number) => String(n).padStart(7, '0');

/** « 1ère tranche », « 2e tranche » ; paiement en une fois : « Cotisation ». */
export const trancheLabel = (number: number, count: number) =>
  count <= 1 ? 'Cotisation' : number === 1 ? '1ère tranche' : `${number}e tranche`;

const paymentInclude = {
  installment: {
    select: {
      number: true,
      count: true,
      membership: {
        select: {
          enrollment: {
            select: {
              season: { select: { label: true } },
              player: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  parentLinks: { select: { parent: { select: { firstName: true, lastName: true, isActive: true } } } },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PaymentInclude;

const receiptInclude = {
  payment: { include: paymentInclude },
  issuedBy: { select: { firstName: true, lastName: true } },
  voidedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ReceiptInclude;

type ReceiptRow = Prisma.ReceiptGetPayload<{ include: typeof receiptInclude }>;

export type ReceiptInput = {
  number: number;
  payerName: string;
  amountWords: string;
  label: string;
  chequeNumber?: string;
  issuedOn: string;
};

/**
 * Reçus des paiements : le numéro pré-imprimé du carnet est saisi à l'impression (unique, jamais réutilisé),
 * les valeurs imprimées sont conservées. Un reçu n'est jamais supprimé : il est annulé avec motif.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: { q?: string; status?: 'ACTIVE' | 'VOIDED' }) {
    const q = filters.q?.trim();
    const asNumber = q && /^\d+$/.test(q) ? Number(q) : undefined;
    const name = (term: string) => [
      { firstName: { contains: term, mode: 'insensitive' as const } },
      { lastName: { contains: term, mode: 'insensitive' as const } },
    ];
    const rows = await this.prisma.receipt.findMany({
      where: {
        ...(filters.status === 'ACTIVE' ? { voidedAt: null } : filters.status === 'VOIDED' ? { voidedAt: { not: null } } : {}),
        ...(asNumber !== undefined
          ? { number: asNumber }
          : q
            ? {
                OR: [
                  { payerName: { contains: q, mode: 'insensitive' as const } },
                  { payment: { installment: { membership: { enrollment: { player: { OR: name(q) } } } } } },
                ],
              }
            : {}),
      },
      include: receiptInclude,
      orderBy: { number: 'desc' },
      take: 300,
    });
    return rows.map((r) => this.view(r));
  }

  async get(id: string) {
    return this.view(await this.find(id));
  }

  /** Numéro proposé : le dernier utilisé + 1 (l'admin saisit celui du carnet). */
  async nextNumber() {
    const last = await this.prisma.receipt.findFirst({ orderBy: { number: 'desc' }, select: { number: true } });
    return { next: last ? last.number + 1 : null, last: last?.number ?? null };
  }

  /** Reçus d'un paiement + valeurs proposées pour un nouveau reçu. */
  async forPayment(paymentId: string) {
    const payment = await this.findPayment(paymentId);
    const receipts = await this.prisma.receipt.findMany({ where: { paymentId }, include: receiptInclude, orderBy: { createdAt: 'desc' } });
    const enrollment = payment.installment.membership.enrollment;
    const parent = enrollment.player.parentLinks.find((l) => l.parent.isActive)?.parent;
    const amount = num(payment.amount);
    return {
      payment: {
        id: payment.id,
        amount,
        method: payment.method,
        chequeNumber: payment.chequeNumber,
        paidAt: payment.paidAt,
        player: { id: enrollment.player.id, firstName: enrollment.player.firstName, lastName: enrollment.player.lastName },
        installment: { number: payment.installment.number, count: payment.installment.count },
        season: enrollment.season.label,
      },
      active: receipts.find((r) => !r.voidedAt) ? this.view(receipts.find((r) => !r.voidedAt)!) : null,
      history: receipts.map((r) => this.view(r)),
      draft: {
        payerName: fullName(parent ?? enrollment.player),
        amountWords: amountInArabicWords(amount),
        label: trancheLabel(payment.installment.number, payment.installment.count),
        chequeNumber: payment.chequeNumber ?? '',
        issuedOn: localDayOf(payment.paidAt),
        seasonLabel: enrollment.season.label,
      },
      ...(await this.nextNumber()),
    };
  }

  async create(actor: AuthUser, paymentId: string, input: ReceiptInput) {
    const payment = await this.findPayment(paymentId);
    if (payment.kind !== PaymentKind.PAYMENT) throw new BadRequestException('Un reçu ne s’émet que pour un encaissement.');
    const active = await this.prisma.receipt.findFirst({ where: { paymentId, voidedAt: null }, select: { number: true } });
    if (active) {
      throw rule.conflict('R7', `Ce paiement a déjà le reçu n° ${receiptNo(active.number)} : réimprimez-le, ou annulez-le avant d’en émettre un autre.`);
    }
    await this.assertNumberFree(input.number);
    const enrollment = payment.installment.membership.enrollment;
    const created = await this.prisma.$transaction(async (tx) => {
      const r = await tx.receipt.create({
        data: {
          number: input.number,
          paymentId,
          payerName: input.payerName.trim(),
          amount: payment.amount,
          amountWords: input.amountWords.trim(),
          label: input.label.trim(),
          method: payment.method,
          chequeNumber: payment.method === 'CHEQUE' ? input.chequeNumber?.trim() || payment.chequeNumber : null,
          seasonLabel: enrollment.season.label,
          issuedOn: dayFromIso(input.issuedOn),
          issuedById: actor.id,
        },
      });
      await this.audit.log(
        actor.id,
        {
          action: 'Reçu émis',
          entity: 'Receipt',
          entityId: r.id,
          target: `Reçu n° ${receiptNo(r.number)} · ${fullName(enrollment.player)} · Tranche ${payment.installment.number}/${payment.installment.count}`,
          after: `${dt(payment.amount)} · reçu de ${r.payerName}`,
        },
        tx,
      );
      return r;
    });
    return this.get(created.id);
  }

  /** Impression (carnet ou PDF) : compteur et date ; une réimpression est tracée dans l'audit. */
  async printed(actor: AuthUser, id: string, kind: 'CARNET' | 'PDF' | 'COPY') {
    const r = await this.find(id);
    if (r.voidedAt) throw rule.conflict('R7', `Le reçu n° ${receiptNo(r.number)} est annulé : il ne peut plus être imprimé.`);
    await this.prisma.receipt.update({ where: { id }, data: { printCount: { increment: 1 }, lastPrintedAt: new Date() } });
    if (r.printCount > 0) {
      await this.audit.log(actor.id, {
        action: kind === 'PDF' ? 'Reçu réédité (PDF)' : 'Reçu réimprimé',
        entity: 'Receipt',
        entityId: id,
        target: `Reçu n° ${receiptNo(r.number)} · ${r.payerName}`,
        after: `${r.printCount + 1} impression(s)`,
      });
    }
    return this.get(id);
  }

  /** Annulation (reçu raté, erreur) : motif obligatoire ; le numéro reste pris. */
  async void(actor: AuthUser, id: string, reason: string) {
    const r = await this.find(id);
    if (r.voidedAt) throw rule.conflict('R7', `Le reçu n° ${receiptNo(r.number)} est déjà annulé.`);
    if (!reason.trim()) throw new BadRequestException('Motif obligatoire pour annuler un reçu.');
    await this.prisma.$transaction(async (tx) => {
      await tx.receipt.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason.trim(), voidedById: actor.id } });
      await this.audit.log(
        actor.id,
        { action: 'Reçu annulé', entity: 'Receipt', entityId: id, target: `Reçu n° ${receiptNo(r.number)} · ${r.payerName}`, before: 'Valide', after: 'Annulé', reason },
        tx,
      );
    });
    return this.get(id);
  }

  async layout(): Promise<ReceiptLayout> {
    const row = await this.prisma.setting.findUnique({ where: { key: RECEIPT_LAYOUT_KEY } });
    let saved: unknown = null;
    try {
      saved = row ? JSON.parse(row.value) : null;
    } catch {
      saved = null;
    }
    return normalizeLayout(saved);
  }

  async saveLayout(actor: AuthUser, raw: unknown): Promise<ReceiptLayout> {
    const layout = normalizeLayout(raw);
    const value = JSON.stringify(layout);
    await this.prisma.setting.upsert({ where: { key: RECEIPT_LAYOUT_KEY }, create: { key: RECEIPT_LAYOUT_KEY, value }, update: { value } });
    await this.audit.log(actor.id, {
      action: 'Réglage d’impression des reçus',
      entity: 'Setting',
      target: 'Carnet de reçus',
      after: `décalage ${layout.offsetX} / ${layout.offsetY} mm · texte ${layout.fontSize} pt`,
    });
    return layout;
  }

  private async assertNumberFree(number: number) {
    const used = await this.prisma.receipt.findUnique({ where: { number }, include: receiptInclude });
    if (!used) return;
    const who = fullName(used.payment.installment.membership.enrollment.player);
    throw rule.conflict(
      'R7',
      used.voidedAt
        ? `Le reçu n° ${receiptNo(number)} a été annulé (${used.voidReason}) : un numéro du carnet ne se réutilise pas.`
        : `Le reçu n° ${receiptNo(number)} est déjà utilisé (${who}, ${isoDay(used.issuedOn)}).`,
    );
  }

  private async find(id: string) {
    const r = await this.prisma.receipt.findUnique({ where: { id }, include: receiptInclude });
    if (!r) throw notFound('Reçu');
    return r;
  }

  private async findPayment(id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id }, include: paymentInclude });
    if (!p) throw notFound('Paiement');
    return p;
  }

  private view(r: ReceiptRow) {
    const enrollment = r.payment.installment.membership.enrollment;
    return {
      id: r.id,
      number: r.number,
      numberText: receiptNo(r.number),
      paymentId: r.paymentId,
      payerName: r.payerName,
      amount: num(r.amount),
      amountWords: r.amountWords,
      label: r.label,
      method: r.method,
      chequeNumber: r.chequeNumber,
      seasonLabel: r.seasonLabel,
      issuedOn: isoDay(r.issuedOn),
      printCount: r.printCount,
      lastPrintedAt: r.lastPrintedAt,
      createdAt: r.createdAt,
      issuedBy: fullName(r.issuedBy),
      voidedAt: r.voidedAt,
      voidReason: r.voidReason,
      voidedBy: r.voidedBy ? fullName(r.voidedBy) : null,
      player: { id: enrollment.player.id, firstName: enrollment.player.firstName, lastName: enrollment.player.lastName },
      installment: { number: r.payment.installment.number, count: r.payment.installment.count },
    };
  }
}
