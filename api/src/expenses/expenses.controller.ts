import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { ExpenseCategory, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { dayFromIso, isoDay, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { assertVersion } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  UTILITIES: 'Factures (STEG, SONEDE, internet)',
  EQUIPMENT: 'Matériel (balles, raquettes)',
  MAINTENANCE: 'Entretien (terrains, locaux)',
  TAX: 'Déclarations fiscales et taxes',
  SOCIAL: 'Déclarations sociales (CNSS)',
  INSURANCE: 'Assurances',
  FEDERATION: 'Fédération (licences, engagements)',
  TRAVEL: 'Déplacements et tournois',
  SERVICES: 'Prestataires (comptable, nettoyage)',
  OTHER: 'Autres',
};
const METHODS = ['CASH', 'CHEQUE', 'TRANSFER'] as const;
const METHOD_LABEL: Record<(typeof METHODS)[number], string> = { CASH: 'Espèces', CHEQUE: 'Chèque', TRANSFER: 'Virement' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILE = 5 * 1024 * 1024;
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

class ListQuery {
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  @IsOptional() @IsEnum(ExpenseCategory) category?: ExpenseCategory;
  @IsOptional() @IsIn(['paid', 'due', 'late', 'archived']) state?: 'paid' | 'due' | 'late' | 'archived';
  @IsOptional() @IsString() @MaxLength(60) q?: string;
}

class ExpenseDto {
  @IsEnum(ExpenseCategory, { message: 'Catégorie obligatoire.' }) category: ExpenseCategory;
  @IsString() @IsNotEmpty({ message: 'Libellé obligatoire.' }) @MaxLength(160) label: string;
  @IsOptional() @IsString() @MaxLength(120) supplier?: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Montant invalide.' }) @Min(0.001, { message: 'Montant positif.' }) amount: number;
  @Matches(DATE, { message: 'Date obligatoire.' }) date: string;
  @IsOptional() @Matches(DATE) dueDate?: string | null;
  /** Déjà payée : date du paiement. */
  @IsOptional() @Matches(DATE) paidAt?: string | null;
  @IsOptional() @IsIn(METHODS) method?: (typeof METHODS)[number] | null;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class UpdateDto extends ExpenseDto {
  @IsInt() @Min(1) version: number;
}

class PayDto {
  @Matches(DATE, { message: 'Date du paiement obligatoire.' }) paidAt: string;
  @IsIn(METHODS, { message: 'Mode : espèces, chèque ou virement.' }) method: (typeof METHODS)[number];
}

class ArchiveDto {
  @IsString() @IsNotEmpty({ message: 'Le motif est obligatoire.' }) @MaxLength(300) reason: string;
}

type Row = Prisma.ExpenseGetPayload<{ select: typeof SELECT }>;
const SELECT = {
  id: true,
  category: true,
  label: true,
  supplier: true,
  reference: true,
  amount: true,
  date: true,
  dueDate: true,
  paidAt: true,
  method: true,
  note: true,
  fileName: true,
  archivedAt: true,
  archiveReason: true,
  version: true,
  createdAt: true,
  createdBy: { select: { firstName: true, lastName: true } },
  project: { select: { id: true, title: true } },
} satisfies Prisma.ExpenseSelect;

/**
 * Dépenses du club (factures, déclarations fiscales et sociales, matériel…) : saisie, paiement, justificatif, archivage
 * avec motif (R8), contrôle de version (R13), audit. Droit « expenses.manage » (agent administratif par défaut).
 */
@ApiTags('Dépenses')
@ApiBearerAuth()
@Perm('expenses.manage')
@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(e: Row) {
    const today = todayIso();
    const due = e.dueDate ? isoDay(e.dueDate) : null;
    const state = e.archivedAt ? 'ARCHIVED' : e.paidAt ? 'PAID' : due && due < today ? 'LATE' : 'DUE';
    return {
      id: e.id,
      category: e.category,
      categoryLabel: EXPENSE_CATEGORY_LABEL[e.category],
      label: e.label,
      supplier: e.supplier,
      reference: e.reference,
      amount: num(e.amount),
      date: isoDay(e.date),
      dueDate: due,
      paidAt: e.paidAt ? isoDay(e.paidAt) : null,
      method: e.method,
      methodLabel: e.method ? METHOD_LABEL[e.method as (typeof METHODS)[number]] : null,
      note: e.note,
      fileName: e.fileName,
      state,
      archiveReason: e.archiveReason,
      version: e.version,
      createdBy: `${e.createdBy.firstName} ${e.createdBy.lastName}`.trim(),
      project: e.project,
    };
  }

  private async find(id: string) {
    const e = await this.prisma.expense.findUnique({ where: { id }, select: SELECT });
    if (!e) throw new NotFoundException('Dépense introuvable.');
    return e;
  }

  @Get('categories')
  categories() {
    return Object.entries(EXPENSE_CATEGORY_LABEL).map(([value, label]) => ({ value, label }));
  }

  @Get()
  async list(@Query() q: ListQuery) {
    const today = dayFromIso(todayIso());
    const words = (q.q ?? '').trim().split(/\s+/).filter((w) => w.length >= 2);
    const where: Prisma.ExpenseWhereInput = {
      archivedAt: q.state === 'archived' ? { not: null } : null,
      ...(q.category ? { category: q.category } : {}),
      ...(q.from || q.to ? { date: { ...(q.from ? { gte: dayFromIso(q.from) } : {}), ...(q.to ? { lte: dayFromIso(q.to) } : {}) } } : {}),
      ...(q.state === 'paid' ? { paidAt: { not: null } } : q.state === 'due' ? { paidAt: null } : q.state === 'late' ? { paidAt: null, dueDate: { lt: today } } : {}),
      AND: words.map((w) => ({
        OR: [{ label: { contains: w, mode: 'insensitive' } }, { supplier: { contains: w, mode: 'insensitive' } }, { reference: { contains: w, mode: 'insensitive' } }],
      })),
    };
    const rows = (await this.prisma.expense.findMany({ where, select: SELECT, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] })).map((e) => this.view(e));
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const byCategory = new Map<string, { category: string; label: string; total: number; count: number }>();
    for (const r of rows) {
      const c = byCategory.get(r.category) ?? { category: r.category, label: r.categoryLabel, total: 0, count: 0 };
      c.total = round(c.total + r.amount);
      c.count++;
      byCategory.set(r.category, c);
    }
    return {
      rows,
      totals: {
        all: round(rows.reduce((t, r) => t + r.amount, 0)),
        paid: round(rows.filter((r) => r.state === 'PAID').reduce((t, r) => t + r.amount, 0)),
        due: round(rows.filter((r) => r.state === 'DUE' || r.state === 'LATE').reduce((t, r) => t + r.amount, 0)),
        late: rows.filter((r) => r.state === 'LATE').length,
        byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total),
      },
    };
  }

  private data(dto: ExpenseDto) {
    if (dto.paidAt && dto.paidAt > todayIso()) throw new BadRequestException('Date de paiement dans le futur.');
    return {
      category: dto.category,
      label: dto.label.trim(),
      supplier: dto.supplier?.trim() || null,
      reference: dto.reference?.trim() || null,
      amount: dto.amount,
      date: dayFromIso(dto.date),
      dueDate: dto.dueDate ? dayFromIso(dto.dueDate) : null,
      paidAt: dto.paidAt ? dayFromIso(dto.paidAt) : null,
      method: dto.paidAt ? (dto.method ?? 'CASH') : null,
      note: dto.note?.trim() || null,
    };
  }

  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() dto: ExpenseDto) {
    const e = await this.prisma.expense.create({ data: { ...this.data(dto), createdById: actor.id }, select: SELECT });
    await this.audit.log(actor.id, { action: 'Dépense saisie', entity: 'Expense', entityId: e.id, target: e.label, after: `${EXPENSE_CATEGORY_LABEL[e.category]} · ${dt(num(e.amount))}` });
    return this.view(e);
  }

  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDto) {
    const before = await this.find(id);
    if (before.archivedAt) throw new BadRequestException('Dépense archivée : restaurez-la avant de la modifier.');
    assertVersion(before, dto.version, 'Cette dépense');
    const e = await this.prisma.expense.update({ where: { id }, data: { ...this.data(dto), version: { increment: 1 } }, select: SELECT });
    await this.audit.log(actor.id, {
      action: 'Dépense modifiée',
      entity: 'Expense',
      entityId: id,
      target: e.label,
      before: `${dt(num(before.amount))} · ${isoDay(before.date)}${before.paidAt ? ' · payée' : ''}`,
      after: `${dt(num(e.amount))} · ${isoDay(e.date)}${e.paidAt ? ' · payée' : ''}`,
    });
    return this.view(e);
  }

  @Post(':id/pay')
  @HttpCode(200)
  async pay(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto) {
    const before = await this.find(id);
    if (before.archivedAt) throw new BadRequestException('Dépense archivée.');
    if (before.paidAt) throw new BadRequestException('Dépense déjà payée.');
    if (dto.paidAt > todayIso()) throw new BadRequestException('Date de paiement dans le futur.');
    const e = await this.prisma.expense.update({ where: { id }, data: { paidAt: dayFromIso(dto.paidAt), method: dto.method, version: { increment: 1 } }, select: SELECT });
    await this.audit.log(actor.id, { action: 'Dépense payée', entity: 'Expense', entityId: id, target: e.label, after: `${dt(num(e.amount))} · ${METHOD_LABEL[dto.method]} · ${dto.paidAt}` });
    return this.view(e);
  }

  /** R8 : jamais supprimée, archivée avec motif (restaurable). */
  @Post(':id/archive')
  @HttpCode(200)
  async archive(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ArchiveDto) {
    const before = await this.find(id);
    if (before.archivedAt) return this.view(before);
    const e = await this.prisma.expense.update({ where: { id }, data: { archivedAt: new Date(), archiveReason: dto.reason.trim(), version: { increment: 1 } }, select: SELECT });
    await this.audit.log(actor.id, { action: 'Dépense archivée', entity: 'Expense', entityId: id, target: e.label, reason: dto.reason.trim() });
    return this.view(e);
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.find(id);
    const e = await this.prisma.expense.update({ where: { id }, data: { archivedAt: null, archiveReason: null, version: { increment: 1 } }, select: SELECT });
    await this.audit.log(actor.id, { action: 'Dépense restaurée', entity: 'Expense', entityId: id, target: e.label });
    return this.view(e);
  }

  /** Justificatif (PDF ou image, 5 Mo au plus) : remplace le précédent. */
  @Post(':id/file')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE } }))
  async upload(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: { buffer: Buffer; originalname: string; mimetype: string }) {
    const before = await this.find(id);
    if (!file?.buffer?.length) throw new BadRequestException('Choisissez le justificatif (PDF ou image).');
    if (!FILE_TYPES.includes(file.mimetype)) throw new BadRequestException('Justificatif : PDF, JPG, PNG ou WEBP.');
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 120);
    const e = await this.prisma.expense.update({
      where: { id },
      data: { fileName: name, fileType: file.mimetype, fileData: file.buffer, version: { increment: 1 } },
      select: SELECT,
    });
    await this.audit.log(actor.id, { action: 'Justificatif ajouté', entity: 'Expense', entityId: id, target: before.label, after: name });
    return this.view(e);
  }

  @Get(':id/file')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const e = await this.prisma.expense.findUnique({ where: { id }, select: { fileName: true, fileType: true, fileData: true } });
    if (!e?.fileData) throw new NotFoundException('Aucun justificatif.');
    res.setHeader('Content-Type', e.fileType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(e.fileName ?? 'justificatif')}`);
    res.send(Buffer.from(e.fileData));
  }
}
