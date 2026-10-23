import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Prisma, ProjectStatus, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { Feature } from '../modules/modules';
import { dayFromIso, isoDay, todayIso } from '../common/dates';
import { dt, num } from '../common/money';
import { assertVersion, fullName } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';

export const PROJECT_CATEGORIES = ['COURT', 'LIGHTING', 'RENOVATION', 'BUILDING', 'EQUIPMENT', 'OTHER'] as const;
export const PROJECT_CATEGORY_LABEL: Record<(typeof PROJECT_CATEGORIES)[number], string> = {
  COURT: 'Terrain (construction, résine, gazon)',
  LIGHTING: 'Éclairage',
  RENOVATION: 'Rénovation',
  BUILDING: 'Locaux (vestiaires, club-house)',
  EQUIPMENT: 'Matériel',
  OTHER: 'Autre',
};
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  IDEA: 'Idée',
  QUOTES: 'Devis en cours',
  APPROVED: 'Validé',
  IN_PROGRESS: 'En cours',
  DONE: 'Terminé',
  CANCELLED: 'Abandonné',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILE = 5 * 1024 * 1024;
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
/** Changements d'état à la main (la validation passe par le choix d'un devis). */
const MANUAL: Partial<Record<ProjectStatus, ProjectStatus[]>> = {
  IDEA: ['QUOTES', 'CANCELLED'],
  QUOTES: ['IDEA', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'APPROVED', 'CANCELLED'],
  DONE: ['IN_PROGRESS'],
  CANCELLED: ['IDEA'],
};

class ProjectDto {
  @IsString() @IsNotEmpty({ message: 'Titre obligatoire.' }) @MaxLength(120) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsIn(PROJECT_CATEGORIES, { message: 'Type de projet inconnu.' }) category: (typeof PROJECT_CATEGORIES)[number];
  @Type(() => Number) @IsInt() @Min(1) @Max(3) priority: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) estimatedAmount?: number | null;
  @IsOptional() @Matches(DATE) targetDate?: string | null;
  @IsOptional() @IsUUID() seasonId?: string | null;
  @IsOptional() @IsUUID() responsibleId?: string | null;
}
class UpdateDto extends ProjectDto {
  @IsInt() @Min(1) version: number;
}
class StatusDto {
  @IsIn(Object.keys(ProjectStatus)) status: ProjectStatus;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsInt() @Min(1) version: number;
}
class QuoteDto {
  @IsString() @IsNotEmpty({ message: 'Fournisseur obligatoire.' }) @MaxLength(120) supplier: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Montant invalide.' }) @Min(0.001, { message: 'Montant positif.' }) amount: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650) delayDays?: number;
  @IsOptional() @Matches(DATE) validUntil?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
class ChooseDto {
  @IsUUID() quoteId: string;
  @IsString() @MinLength(3, { message: 'Motif de la décision obligatoire.' }) @MaxLength(500) reason: string;
  @IsInt() @Min(1) version: number;
}
class ReasonDto {
  @IsString() @MinLength(3, { message: 'Motif obligatoire.' }) @MaxLength(300) reason: string;
}
class LinkDto {
  @IsUUID() expenseId: string;
}
class ListQuery {
  @IsOptional() @IsIn(['active', 'done', 'cancelled', 'archived', 'all']) state?: string;
}

const LIST = {
  id: true,
  title: true,
  description: true,
  category: true,
  status: true,
  priority: true,
  estimatedAmount: true,
  targetDate: true,
  seasonId: true,
  responsibleId: true,
  chosenQuoteId: true,
  decisionReason: true,
  decidedAt: true,
  archivedAt: true,
  archiveReason: true,
  version: true,
  createdAt: true,
  season: { select: { label: true } },
  responsible: { select: { firstName: true, lastName: true } },
  quotes: { where: { archivedAt: null }, select: { id: true, amount: true } },
  chosenQuote: { select: { id: true, supplier: true, amount: true } },
  expenses: { where: { archivedAt: null }, select: { amount: true, paidAt: true } },
} satisfies Prisma.ProjectSelect;
type Row = Prisma.ProjectGetPayload<{ select: typeof LIST }>;

/**
 * Projets du club (rénovation, terrain, éclairage, matériel) : devis comparés, décision du bureau avec motif (le devis
 * choisi valide le projet), dépenses rattachées pour suivre le réel face au devis, archivage avec motif (R8), version
 * (R13), audit. Lecture : « budget.manage » ou « stats.view » ; modification : « budget.manage ».
 */
@ApiTags('Projets et budget')
@ApiBearerAuth()
@Feature('budget')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(p: Row) {
    const amounts = p.quotes.map((q) => num(q.amount));
    const spent = p.expenses.filter((e) => e.paidAt).reduce((t, e) => t + num(e.amount), 0);
    const committed = p.expenses.reduce((t, e) => t + num(e.amount), 0);
    const budget = p.chosenQuote ? num(p.chosenQuote.amount) : p.estimatedAmount !== null ? num(p.estimatedAmount) : null;
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      category: p.category,
      categoryLabel: PROJECT_CATEGORY_LABEL[p.category as (typeof PROJECT_CATEGORIES)[number]] ?? p.category,
      status: p.status,
      statusLabel: STATUS_LABEL[p.status],
      priority: p.priority,
      estimatedAmount: p.estimatedAmount !== null ? num(p.estimatedAmount) : null,
      targetDate: p.targetDate ? isoDay(p.targetDate) : null,
      seasonId: p.seasonId,
      seasonLabel: p.season?.label ?? null,
      responsibleId: p.responsibleId,
      responsible: p.responsible ? fullName(p.responsible).trim() : null,
      quotes: p.quotes.length,
      minQuote: amounts.length ? Math.min(...amounts) : null,
      maxQuote: amounts.length ? Math.max(...amounts) : null,
      chosenQuote: p.chosenQuote ? { id: p.chosenQuote.id, supplier: p.chosenQuote.supplier, amount: num(p.chosenQuote.amount) } : null,
      decisionReason: p.decisionReason,
      decidedAt: p.decidedAt,
      budget,
      spent: Math.round(spent * 1000) / 1000,
      committed: Math.round(committed * 1000) / 1000,
      archivedAt: p.archivedAt,
      archiveReason: p.archiveReason,
      version: p.version,
    };
  }

  private async find(id: string) {
    const p = await this.prisma.project.findUnique({ where: { id }, select: LIST });
    if (!p) throw new NotFoundException('Projet introuvable.');
    return p;
  }

  /** Membres du bureau (responsable d'un projet). */
  private people() {
    return this.prisma.user.findMany({
      where: { isActive: true, roles: { hasSome: [Role.PRESIDENT, Role.ADMIN_AGENT, Role.SUPERVISOR, Role.TECH_DIRECTOR, Role.ADMIN] } },
      orderBy: [{ firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    });
  }

  @Get()
  @Perm('budget.manage', 'stats.view')
  async list(@Query() q: ListQuery) {
    const state = q.state ?? 'active';
    const where: Prisma.ProjectWhereInput =
      state === 'archived'
        ? { archivedAt: { not: null } }
        : state === 'all'
          ? { archivedAt: null }
          : state === 'done'
            ? { archivedAt: null, status: 'DONE' }
            : state === 'cancelled'
              ? { archivedAt: null, status: 'CANCELLED' }
              : { archivedAt: null, status: { notIn: ['DONE', 'CANCELLED'] } };
    const [rows, people, seasons] = await Promise.all([
      this.prisma.project.findMany({ where, orderBy: [{ priority: 'asc' }, { targetDate: 'asc' }, { createdAt: 'desc' }], select: LIST }),
      this.people(),
      this.prisma.season.findMany({ where: { archivedAt: null, status: { in: ['DRAFT', 'ACTIVE'] } }, orderBy: { startDate: 'asc' }, select: { id: true, label: true } }),
    ]);
    const projects = rows.map((r) => this.view(r));
    const open = projects.filter((p) => ['APPROVED', 'IN_PROGRESS'].includes(p.status));
    return {
      projects,
      totals: {
        approved: Math.round(open.reduce((t, p) => t + (p.budget ?? 0), 0) * 1000) / 1000,
        spent: Math.round(open.reduce((t, p) => t + p.spent, 0) * 1000) / 1000,
        ideas: projects.filter((p) => ['IDEA', 'QUOTES'].includes(p.status)).reduce((t, p) => t + (p.minQuote ?? p.estimatedAmount ?? 0), 0),
      },
      categories: PROJECT_CATEGORIES.map((k) => ({ key: k, label: PROJECT_CATEGORY_LABEL[k] })),
      people: people.map((u) => ({ id: u.id, name: fullName(u).trim() })),
      seasons,
    };
  }

  @Get(':id')
  @Perm('budget.manage', 'stats.view')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.find(id);
    const [quotes, expenses, candidates] = await Promise.all([
      this.prisma.projectQuote.findMany({
        where: { projectId: id },
        orderBy: [{ archivedAt: 'asc' }, { amount: 'asc' }],
        select: { id: true, supplier: true, amount: true, delayDays: true, validUntil: true, note: true, fileName: true, archivedAt: true, createdAt: true },
      }),
      this.prisma.expense.findMany({ where: { projectId: id, archivedAt: null }, orderBy: { date: 'asc' }, select: { id: true, label: true, supplier: true, amount: true, date: true, paidAt: true } }),
      // Dépenses sans projet des 18 derniers mois, à rattacher.
      this.prisma.expense.findMany({
        where: { projectId: null, archivedAt: null, date: { gte: dayFromIso(`${Number(todayIso().slice(0, 4)) - 2}-01-01`) } },
        orderBy: { date: 'desc' },
        take: 200,
        select: { id: true, label: true, supplier: true, amount: true, date: true, paidAt: true },
      }),
    ]);
    const today = todayIso();
    const active = quotes.filter((q) => !q.archivedAt);
    const min = active.length ? Math.min(...active.map((q) => num(q.amount))) : null;
    const fastest = active.filter((q) => q.delayDays !== null).sort((a, b) => a.delayDays! - b.delayDays!)[0]?.id ?? null;
    const exp = (e: (typeof expenses)[number]) => ({ id: e.id, label: e.label, supplier: e.supplier, amount: num(e.amount), date: isoDay(e.date), paidAt: e.paidAt ? isoDay(e.paidAt) : null });
    return {
      ...this.view(p),
      quotes: quotes.map((q) => ({
        id: q.id,
        supplier: q.supplier,
        amount: num(q.amount),
        delayDays: q.delayDays,
        validUntil: q.validUntil ? isoDay(q.validUntil) : null,
        expired: q.validUntil ? isoDay(q.validUntil) < today : false,
        note: q.note,
        fileName: q.fileName,
        archived: Boolean(q.archivedAt),
        cheapest: !q.archivedAt && min !== null && num(q.amount) === min && active.length > 1,
        fastest: !q.archivedAt && q.id === fastest && active.length > 1,
        gap: min !== null && !q.archivedAt ? Math.round((num(q.amount) - min) * 1000) / 1000 : null,
        chosen: q.id === p.chosenQuoteId,
      })),
      expenses: expenses.map(exp),
      candidates: candidates.map(exp),
    };
  }

  @Post()
  @Perm('budget.manage')
  async create(@CurrentUser() actor: AuthUser, @Body() dto: ProjectDto) {
    const p = await this.prisma.project.create({ data: { ...this.data(dto), createdById: actor.id }, select: LIST });
    await this.audit.log(actor.id, { action: 'Projet créé', entity: 'Project', entityId: p.id, target: p.title, after: dto.estimatedAmount ? `${dt(dto.estimatedAmount)} estimés` : null });
    return this.view(p);
  }

  private data(dto: ProjectDto) {
    return {
      title: dto.title.trim(),
      description: dto.description?.trim() || null,
      category: dto.category,
      priority: dto.priority,
      estimatedAmount: dto.estimatedAmount ?? null,
      targetDate: dto.targetDate ? dayFromIso(dto.targetDate) : null,
      seasonId: dto.seasonId || null,
      responsibleId: dto.responsibleId || null,
    };
  }

  @Patch(':id')
  @Perm('budget.manage')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDto) {
    const before = await this.find(id);
    assertVersion(before, dto.version, 'Ce projet');
    if (before.archivedAt) throw new BadRequestException('R8 · Projet archivé : restaurez-le d’abord.');
    const p = await this.prisma.project.update({ where: { id }, data: { ...this.data(dto), version: { increment: 1 } }, select: LIST });
    await this.audit.log(actor.id, {
      action: 'Projet modifié',
      entity: 'Project',
      entityId: id,
      target: p.title,
      before: before.estimatedAmount !== null ? `${dt(before.estimatedAmount)} estimés` : null,
      after: dto.estimatedAmount ? `${dt(dto.estimatedAmount)} estimés` : null,
    });
    return this.view(p);
  }

  @Post(':id/status')
  @HttpCode(200)
  @Perm('budget.manage')
  async status(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    const before = await this.find(id);
    assertVersion(before, dto.version, 'Ce projet');
    if (!MANUAL[before.status]?.includes(dto.status)) {
      throw new BadRequestException(
        dto.status === 'APPROVED' ? 'Un projet se valide en choisissant un devis (décision du bureau avec motif).' : `Passage de « ${STATUS_LABEL[before.status]} » à « ${STATUS_LABEL[dto.status]} » impossible.`,
      );
    }
    const backwards = dto.status === 'CANCELLED' || (before.status === 'CANCELLED' && dto.status === 'IDEA') || (before.status === 'DONE' && dto.status === 'IN_PROGRESS');
    if (backwards && (dto.reason?.trim().length ?? 0) < 3) throw new BadRequestException('Motif obligatoire.');
    // Retour à l'idée : le devis choisi est libéré (nouvelle décision nécessaire).
    const reset = dto.status === 'IDEA' ? { chosenQuoteId: null, decisionReason: null, decidedAt: null, decidedById: null } : {};
    const p = await this.prisma.project.update({ where: { id }, data: { status: dto.status, ...reset, version: { increment: 1 } }, select: LIST });
    await this.audit.log(actor.id, {
      action: 'Projet : changement d’état',
      entity: 'Project',
      entityId: id,
      target: p.title,
      before: STATUS_LABEL[before.status],
      after: STATUS_LABEL[dto.status],
      reason: dto.reason?.trim() || null,
    });
    return this.view(p);
  }

  @Post(':id/quotes')
  @HttpCode(200)
  @Perm('budget.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE } }))
  async addQuote(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuoteDto, @UploadedFile() file?: { buffer: Buffer; originalname: string; mimetype: string }) {
    const p = await this.find(id);
    if (p.archivedAt || ['DONE', 'CANCELLED'].includes(p.status)) throw new BadRequestException('Projet terminé, abandonné ou archivé : aucun nouveau devis.');
    if (file?.buffer?.length && !FILE_TYPES.includes(file.mimetype)) throw new BadRequestException('Devis : PDF, JPG, PNG ou WEBP.');
    const name = file?.buffer?.length ? Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 120) : null;
    const q = await this.prisma.projectQuote.create({
      data: {
        projectId: id,
        supplier: dto.supplier.trim(),
        amount: dto.amount,
        delayDays: dto.delayDays ?? null,
        validUntil: dto.validUntil ? dayFromIso(dto.validUntil) : null,
        note: dto.note?.trim() || null,
        fileName: name,
        fileType: name ? file!.mimetype : null,
        fileData: name ? file!.buffer : null,
        createdById: actor.id,
      },
    });
    if (p.status === 'IDEA') await this.prisma.project.update({ where: { id }, data: { status: 'QUOTES', version: { increment: 1 } } });
    await this.audit.log(actor.id, { action: 'Devis ajouté', entity: 'ProjectQuote', entityId: q.id, target: `${p.title} · ${q.supplier}`, after: dt(dto.amount) });
    return { id: q.id };
  }

  @Get(':id/quotes/:quoteId/file')
  @Perm('budget.manage', 'stats.view')
  async quoteFile(@Param('id', ParseUUIDPipe) id: string, @Param('quoteId', ParseUUIDPipe) quoteId: string, @Res() res: Response) {
    const q = await this.prisma.projectQuote.findFirst({ where: { id: quoteId, projectId: id }, select: { fileName: true, fileType: true, fileData: true } });
    if (!q?.fileData) throw new NotFoundException('Aucun fichier pour ce devis.');
    res.setHeader('Content-Type', q.fileType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(q.fileName ?? 'devis')}`);
    res.send(Buffer.from(q.fileData));
  }

  /** Devis écarté (gardé dans l'historique, R8) ; le devis choisi ne peut pas l'être. */
  @Post(':id/quotes/:quoteId/archive')
  @HttpCode(200)
  @Perm('budget.manage')
  async archiveQuote(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('quoteId', ParseUUIDPipe) quoteId: string, @Body() dto: ReasonDto) {
    const p = await this.find(id);
    if (p.chosenQuoteId === quoteId) throw new BadRequestException('C’est le devis choisi : choisissez-en un autre avant de l’écarter.');
    const q = await this.prisma.projectQuote.findFirst({ where: { id: quoteId, projectId: id, archivedAt: null } });
    if (!q) throw new NotFoundException('Devis introuvable.');
    await this.prisma.projectQuote.update({ where: { id: quoteId }, data: { archivedAt: new Date() } });
    await this.audit.log(actor.id, { action: 'Devis écarté', entity: 'ProjectQuote', entityId: quoteId, target: `${p.title} · ${q.supplier}`, reason: dto.reason });
    return { archived: true };
  }

  /** Décision du bureau : le devis choisi valide le projet (motif obligatoire, audit). */
  @Post(':id/choose')
  @HttpCode(200)
  @Perm('budget.manage')
  async choose(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChooseDto) {
    const before = await this.find(id);
    assertVersion(before, dto.version, 'Ce projet');
    if (!['IDEA', 'QUOTES', 'APPROVED', 'IN_PROGRESS'].includes(before.status) || before.archivedAt) throw new BadRequestException('Projet terminé, abandonné ou archivé.');
    const q = await this.prisma.projectQuote.findFirst({ where: { id: dto.quoteId, projectId: id, archivedAt: null } });
    if (!q) throw new BadRequestException('Devis introuvable pour ce projet.');
    const p = await this.prisma.project.update({
      where: { id },
      data: {
        chosenQuoteId: q.id,
        decisionReason: dto.reason.trim(),
        decidedAt: new Date(),
        decidedById: actor.id,
        status: before.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'APPROVED',
        version: { increment: 1 },
      },
      select: LIST,
    });
    await this.audit.log(actor.id, {
      action: before.chosenQuote ? 'Projet : devis changé' : 'Projet validé (devis choisi)',
      entity: 'Project',
      entityId: id,
      target: p.title,
      before: before.chosenQuote ? `${before.chosenQuote.supplier} · ${dt(before.chosenQuote.amount)}` : STATUS_LABEL[before.status],
      after: `${q.supplier} · ${dt(q.amount)}`,
      reason: dto.reason.trim(),
    });
    return this.view(p);
  }

  @Post(':id/expenses')
  @HttpCode(200)
  @Perm('budget.manage')
  async link(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkDto) {
    const p = await this.find(id);
    const e = await this.prisma.expense.findUnique({ where: { id: dto.expenseId }, select: { id: true, label: true, projectId: true, archivedAt: true, amount: true } });
    if (!e || e.archivedAt) throw new NotFoundException('Dépense introuvable.');
    if (e.projectId && e.projectId !== id) throw new BadRequestException('Cette dépense est déjà rattachée à un autre projet.');
    await this.prisma.expense.update({ where: { id: e.id }, data: { projectId: id } });
    await this.audit.log(actor.id, { action: 'Dépense rattachée au projet', entity: 'Project', entityId: id, target: p.title, after: `${e.label} · ${dt(e.amount)}` });
    return { linked: true };
  }

  @Post(':id/expenses/:expenseId/unlink')
  @HttpCode(200)
  @Perm('budget.manage')
  async unlink(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('expenseId', ParseUUIDPipe) expenseId: string) {
    const p = await this.find(id);
    const e = await this.prisma.expense.findFirst({ where: { id: expenseId, projectId: id }, select: { label: true, amount: true } });
    if (!e) throw new NotFoundException('Dépense non rattachée à ce projet.');
    await this.prisma.expense.update({ where: { id: expenseId }, data: { projectId: null } });
    await this.audit.log(actor.id, { action: 'Dépense détachée du projet', entity: 'Project', entityId: id, target: p.title, before: `${e.label} · ${dt(e.amount)}` });
    return { unlinked: true };
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Perm('budget.manage')
  async archive(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    const p = await this.find(id);
    if (p.archivedAt) throw new BadRequestException('Projet déjà archivé.');
    await this.prisma.project.update({ where: { id }, data: { archivedAt: new Date(), archiveReason: dto.reason.trim(), version: { increment: 1 } } });
    await this.audit.log(actor.id, { action: 'Projet archivé', entity: 'Project', entityId: id, target: p.title, reason: dto.reason });
    return { archived: true };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Perm('budget.manage')
  async restore(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const p = await this.find(id);
    await this.prisma.project.update({ where: { id }, data: { archivedAt: null, archiveReason: null, version: { increment: 1 } } });
    await this.audit.log(actor.id, { action: 'Projet restauré', entity: 'Project', entityId: id, target: p.title });
    return { restored: true };
  }
}
