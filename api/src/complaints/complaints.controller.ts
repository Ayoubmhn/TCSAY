import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { ComplaintCategory, ComplaintKind, ComplaintStatus, Prisma, Role } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../auth/auth-user';
import { fullName } from '../common/rules';
import { imageType } from '../photos/photos.service';
import { PrismaService } from '../prisma/prisma.service';
import { ANSWER_HOURS, CATEGORY_LABEL, ComplaintsService, KIND_LABEL } from './complaints.service';

/** Au plus 5 réclamations par jour et par compte (anti-abus). */
const PER_DAY = 5;
const MAX_PHOTO = 1024 * 1024;

class CreateComplaintDto {
  @IsEnum(ComplaintKind) kind: ComplaintKind;
  @IsEnum(ComplaintCategory) category: ComplaintCategory;
  @IsString() @IsNotEmpty({ message: 'Objet obligatoire.' }) @MaxLength(120) subject: string;
  @IsString() @IsNotEmpty({ message: 'Décrivez votre demande.' }) @MaxLength(3000) body: string;
  @IsOptional() @IsUUID() playerId?: string;
  @IsOptional() @IsUUID() targetUserId?: string;
}

class MessageDto {
  @IsString() @IsNotEmpty({ message: 'Message vide.' }) @MaxLength(3000) body: string;
  @IsOptional() @IsBoolean() internal?: boolean;
}

class StatusDto {
  @IsIn([ComplaintStatus.IN_PROGRESS, ComplaintStatus.RESOLVED, ComplaintStatus.REJECTED]) status: ComplaintStatus;
  @IsOptional() @IsString() @MaxLength(3000) message?: string;
}

class SatisfactionDto {
  @IsBoolean() satisfied: boolean;
}

class ListQuery {
  @IsOptional() @IsEnum(ComplaintStatus) status?: ComplaintStatus;
  @IsOptional() @IsEnum(ComplaintCategory) category?: ComplaintCategory;
  @IsOptional() @IsIn(['open', 'closed', 'all']) state?: 'open' | 'closed' | 'all';
}

class TargetsQuery {
  @IsOptional() @IsString() @MaxLength(60) q?: string;
}

const STATUS_LABEL: Record<ComplaintStatus, string> = { NEW: 'Nouvelle', IN_PROGRESS: 'Prise en charge', RESOLVED: 'Résolue', REJECTED: 'Refusée' };
const OPEN: ComplaintStatus[] = [ComplaintStatus.NEW, ComplaintStatus.IN_PROGRESS];

const include = {
  author: { select: { id: true, firstName: true, lastName: true, roles: true } },
  target: { select: { id: true, firstName: true, lastName: true } },
  assignee: { select: { id: true, firstName: true, lastName: true } },
  player: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { messages: true } },
} satisfies Prisma.ComplaintInclude;

type Row = Prisma.ComplaintGetPayload<{ include: typeof include }>;

/**
 * Réclamations et suggestions : tout acteur écrit ; la catégorie décide qui traite (caisse, réservations,
 * direction technique, terrains ; comportement et urgent : président) ; échanges, statuts, satisfaction ;
 * la personne visée ne voit jamais la réclamation ; rappel après 72 h sans réponse.
 */
@ApiTags('Réclamations')
@ApiBearerAuth()
@Controller('complaints')
export class ComplaintsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly complaints: ComplaintsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  private view(c: Row, handler: boolean) {
    return {
      id: c.id,
      number: c.number,
      kind: c.kind,
      kindLabel: KIND_LABEL[c.kind],
      category: c.category,
      categoryLabel: CATEGORY_LABEL[c.category],
      subject: c.subject,
      body: c.body,
      status: c.status,
      statusLabel: STATUS_LABEL[c.status],
      author: handler ? { id: c.author.id, name: fullName(c.author).trim(), space: c.authorSpace } : null,
      player: c.player ? { id: c.player.id, name: fullName(c.player).trim() } : null,
      target: c.target ? { id: c.target.id, name: fullName(c.target).trim() } : null,
      assignee: c.assignee ? fullName(c.assignee).trim() : null,
      hasPhoto: Boolean(c.photoMime),
      satisfied: c.satisfied,
      messages: c._count.messages,
      late: OPEN.includes(c.status) && Date.now() - c.lastActivityAt.getTime() > ANSWER_HOURS * 3_600_000,
      createdAt: c.createdAt,
      closedAt: c.closedAt,
      lastActivityAt: c.lastActivityAt,
      version: c.version,
    };
  }

  /** Réclamation visible : son auteur, ou un responsable qui la traite. */
  private async load(user: AuthUser, id: string) {
    const c = await this.prisma.complaint.findUnique({ where: { id }, include });
    if (!c) throw new NotFoundException('Réclamation introuvable.');
    if (c.authorId === user.id && user.role !== Role.ADMIN) return { c, handler: false };
    const scope = this.complaints.scope(user);
    if (scope && (await this.prisma.complaint.count({ where: { AND: [{ id }, scope] } }))) return { c, handler: true };
    if (c.authorId === user.id) return { c, handler: false };
    throw new NotFoundException('Réclamation introuvable.');
  }

  @Get('mine')
  async mine(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.complaint.findMany({ where: { authorId: user.id }, include, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((c) => this.view(c, false));
  }

  /** Personnes qu'on peut viser (entraîneurs, personnel du club) : elles ne verront pas la réclamation. */
  @Get('targets')
  async targets(@Query() q: TargetsQuery) {
    const s = q.q?.trim();
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        roles: { hasSome: [Role.COACH, Role.ADMIN_AGENT, Role.SUPERVISOR, Role.TECH_DIRECTOR] },
        ...(s ? { OR: [{ firstName: { contains: s, mode: 'insensitive' } }, { lastName: { contains: s, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 20,
      select: { id: true, firstName: true, lastName: true, roles: true },
    });
    return users.map((u) => ({ id: u.id, name: fullName(u).trim(), role: u.roles.includes(Role.COACH) ? 'Entraîneur' : 'Personnel' }));
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateComplaintDto) {
    const since = new Date(Date.now() - 86_400_000);
    if ((await this.prisma.complaint.count({ where: { authorId: user.id, createdAt: { gte: since } } })) >= PER_DAY) {
      throw new BadRequestException(`Au plus ${PER_DAY} envois par jour : complétez une réclamation déjà envoyée.`);
    }
    if (dto.playerId) await this.access.resolvePlayer(user.role === Role.ADMIN ? { ...user, role: Role.PARENT } : user, dto.playerId);
    if (dto.targetUserId === user.id) throw new BadRequestException('Vous ne pouvez pas vous viser vous-même.');
    if (dto.targetUserId && !(await this.prisma.user.findFirst({ where: { id: dto.targetUserId, isActive: true } }))) throw new NotFoundException('Personne introuvable.');
    const c = await this.prisma.complaint.create({
      data: {
        kind: dto.kind,
        category: dto.category,
        subject: dto.subject.trim(),
        body: dto.body.trim(),
        authorId: user.id,
        authorSpace: user.space,
        playerId: dto.playerId ?? null,
        targetUserId: dto.targetUserId ?? null,
      },
      include,
    });
    await this.audit.log(user.id, { action: `${KIND_LABEL[c.kind]} envoyée`, entity: 'Complaint', entityId: c.id, target: `n° ${c.number} · ${CATEGORY_LABEL[c.category]}` });
    const to = await this.complaints.handlers(c);
    await this.complaints.notify(
      to,
      c.kind === ComplaintKind.URGENT ? `🚨 Signalement urgent n° ${c.number}` : `${KIND_LABEL[c.kind]} n° ${c.number} : ${c.subject}`,
      `${CATEGORY_LABEL[c.category]} · ${fullName(user).trim()}`,
      `/admin/reclamations/${c.id}`,
    );
    return this.view(c, false);
  }

  /** Photo jointe (facultative), par l'auteur juste après l'envoi : JPG, PNG ou WEBP, 1 Mo. */
  @Post(':id/photo')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO } }))
  async photo(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: { buffer: Buffer }) {
    const c = await this.prisma.complaint.findUnique({ where: { id } });
    if (!c || c.authorId !== user.id) throw new NotFoundException('Réclamation introuvable.');
    if (!file?.buffer?.length) throw new BadRequestException('Choisissez une photo.');
    const mime = imageType(file.buffer);
    if (!mime) throw new BadRequestException('Photo : JPG, PNG ou WEBP.');
    await this.prisma.complaint.update({ where: { id }, data: { photo: file.buffer, photoMime: mime } });
    return { ok: true };
  }

  @Get(':id/photo')
  async photoFile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    await this.load(user, id);
    const c = await this.prisma.complaint.findUnique({ where: { id }, select: { photo: true, photoMime: true } });
    if (!c?.photo || !c.photoMime) throw new NotFoundException('Aucune photo.');
    res.setHeader('Content-Type', c.photoMime);
    res.setHeader('Content-Disposition', 'inline');
    res.send(Buffer.from(c.photo));
  }

  /** Responsables : réclamations qu'ils traitent (ouvertes par défaut). */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    const scope = this.complaints.scope(user);
    if (!scope) throw new ForbiddenException('Vous ne traitez aucune catégorie de réclamations.');
    const state = q.state ?? 'open';
    const rows = await this.prisma.complaint.findMany({
      where: {
        AND: [
          scope,
          q.status ? { status: q.status } : state === 'open' ? { status: { in: OPEN } } : state === 'closed' ? { status: { notIn: OPEN } } : {},
          q.category ? { category: q.category } : {},
        ],
      },
      include,
      orderBy: [{ kind: 'desc' }, { lastActivityAt: 'asc' }],
      take: 200,
    });
    // Urgents d'abord, puis les plus anciennes sans activité.
    rows.sort((a, b) => Number(b.kind === ComplaintKind.URGENT) - Number(a.kind === ComplaintKind.URGENT) || a.lastActivityAt.getTime() - b.lastActivityAt.getTime());
    return rows.map((c) => this.view(c, true));
  }

  /** Tableau du bureau : ouvertes, urgentes, temps moyen de traitement, satisfaction, catégories (90 jours). */
  @Get('stats')
  async stats(@CurrentUser() user: AuthUser) {
    const scope = this.complaints.scope(user);
    if (!scope) throw new ForbiddenException('Vous ne traitez aucune catégorie de réclamations.');
    const since = new Date(Date.now() - 90 * 86_400_000);
    const rows = await this.prisma.complaint.findMany({
      where: { AND: [scope, { OR: [{ createdAt: { gte: since } }, { status: { in: OPEN } }] }] },
      select: { status: true, kind: true, category: true, createdAt: true, closedAt: true, satisfied: true, lastActivityAt: true },
    });
    const closed = rows.filter((r) => r.closedAt);
    const rated = closed.filter((r) => r.satisfied !== null);
    const byCategory = (Object.keys(CATEGORY_LABEL) as ComplaintCategory[])
      .map((c) => ({ category: c, label: CATEGORY_LABEL[c], count: rows.filter((r) => r.category === c).length }))
      .filter((c) => c.count)
      .sort((a, b) => b.count - a.count);
    return {
      open: rows.filter((r) => OPEN.includes(r.status)).length,
      urgent: rows.filter((r) => OPEN.includes(r.status) && r.kind === ComplaintKind.URGENT).length,
      late: rows.filter((r) => OPEN.includes(r.status) && Date.now() - r.lastActivityAt.getTime() > ANSWER_HOURS * 3_600_000).length,
      total90: rows.filter((r) => r.createdAt >= since).length,
      averageHours: closed.length ? Math.round(closed.reduce((s, r) => s + (r.closedAt!.getTime() - r.createdAt.getTime()), 0) / closed.length / 3_600_000) : null,
      satisfaction: rated.length ? Math.round((rated.filter((r) => r.satisfied).length / rated.length) * 100) : null,
      byCategory,
    };
  }

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const { c, handler } = await this.load(user, id);
    const messages = await this.prisma.complaintMessage.findMany({
      where: { complaintId: id, ...(handler ? {} : { internal: false }) },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...this.view(c, handler),
      canHandle: handler,
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        internal: m.internal,
        mine: m.authorId === user.id,
        // L'auteur voit « Club » pour les réponses de la direction.
        author: m.authorId === c.authorId ? (handler ? fullName(m.author).trim() : 'Vous') : handler ? fullName(m.author).trim() : 'Club TCSAY',
        fromAuthor: m.authorId === c.authorId,
        createdAt: m.createdAt,
      })),
    };
  }

  @Post(':id/messages')
  @HttpCode(200)
  async message(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MessageDto) {
    const { c, handler } = await this.load(user, id);
    if (!OPEN.includes(c.status) && !handler) throw new BadRequestException('Réclamation close : envoyez une nouvelle réclamation si besoin.');
    const internal = handler && Boolean(dto.internal);
    await this.prisma.complaintMessage.create({ data: { complaintId: id, authorId: user.id, body: dto.body.trim(), internal } });
    await this.prisma.complaint.update({ where: { id }, data: { lastActivityAt: handler ? new Date() : c.lastActivityAt, version: { increment: 1 } } });
    if (internal) return { ok: true };
    if (handler) await this.complaints.notify([c.authorId], `Réponse à votre réclamation n° ${c.number}`, c.subject, `/reclamations/${id}`);
    else {
      const to = c.assigneeId ? [c.assigneeId] : await this.complaints.handlers(c);
      await this.complaints.notify(to, `Nouveau message · réclamation n° ${c.number}`, c.subject, `/admin/reclamations/${id}`);
    }
    return { ok: true };
  }

  @Post(':id/status')
  @HttpCode(200)
  async status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    const { c, handler } = await this.load(user, id);
    if (!handler) throw new ForbiddenException('Réservé aux responsables.');
    const closing = dto.status === ComplaintStatus.RESOLVED || dto.status === ComplaintStatus.REJECTED;
    if (closing && !dto.message?.trim()) throw new BadRequestException('Expliquez la réponse apportée (message à l’auteur).');
    await this.prisma.$transaction(async (tx) => {
      if (dto.message?.trim()) await tx.complaintMessage.create({ data: { complaintId: id, authorId: user.id, body: dto.message.trim() } });
      await tx.complaint.update({
        where: { id },
        data: {
          status: dto.status,
          assigneeId: c.assigneeId ?? user.id,
          closedAt: closing ? new Date() : null,
          satisfied: closing ? null : c.satisfied,
          lastActivityAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.audit.log(user.id, { action: `Réclamation : ${STATUS_LABEL[dto.status]}`, entity: 'Complaint', entityId: id, target: `n° ${c.number}`, before: STATUS_LABEL[c.status], after: STATUS_LABEL[dto.status] }, tx);
    });
    await this.complaints.notify(
      [c.authorId],
      `Réclamation n° ${c.number} : ${STATUS_LABEL[dto.status].toLowerCase()}`,
      dto.message?.trim() ? dto.message.trim().slice(0, 140) : c.subject,
      `/reclamations/${id}`,
    );
    return { ok: true };
  }

  @Post(':id/satisfaction')
  @HttpCode(200)
  async satisfaction(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SatisfactionDto) {
    const c = await this.prisma.complaint.findUnique({ where: { id } });
    if (!c || c.authorId !== user.id) throw new NotFoundException('Réclamation introuvable.');
    if (OPEN.includes(c.status)) throw new BadRequestException('La réclamation n’est pas encore close.');
    await this.prisma.complaint.update({ where: { id }, data: { satisfied: dto.satisfied } });
    if (!dto.satisfied && c.assigneeId) {
      await this.complaints.notify([c.assigneeId], `Réclamation n° ${c.number} : auteur non satisfait`, c.subject, `/admin/reclamations/${id}`);
    }
    return { ok: true };
  }
}
