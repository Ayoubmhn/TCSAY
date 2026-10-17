import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { SeasonReportKind } from '@prisma/client';
import { IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { assertVersion } from '../common/rules';
import { readDocxText } from '../history/docx-reader';
import { PrismaService } from '../prisma/prisma.service';
import { SeasonReportsService } from './season-reports.service';

const KINDS = ['MORAL', 'FINANCIAL'] as const;
const LABEL: Record<SeasonReportKind, string> = { MORAL: 'Rapport moral', FINANCIAL: 'Rapport financier' };
const MAX_FILE = 10 * 1024 * 1024;
/** Clés des textes rédigés par le bureau (le reste du rapport vient de la base). */
const TEXT_KEYS: Record<SeasonReportKind, string[]> = {
  MORAL: ['intro', 'members', 'training', 'competition', 'difficulties', 'goals', 'conclusion'],
  FINANCIAL: ['intro', 'income', 'expenses', 'notes', 'conclusion'],
};

class DraftDto {
  @IsObject() texts: Record<string, string>;
  @IsOptional() @IsInt() @Min(0) version?: number;
}

class FileDto {
  @IsIn(KINDS) kind: SeasonReportKind;
}

class ArchiveDto {
  @IsString() @MinLength(3, { message: 'R8 · Motif obligatoire.' }) @MaxLength(300) reason: string;
}

/** Type réel du fichier d'après ses premiers octets : PDF, Word (.docx), JPG, PNG, WebP. */
function fileType(b: Buffer, name: string): string | null {
  if (b.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  if (b[0] === 0x50 && b[1] === 0x4b && /\.docx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (b[0] === 0xd0 && b[1] === 0xcf && /\.doc$/i.test(name)) return 'application/msword';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Rapports de fin de saison (assemblée générale) : rapport moral et rapport financier, préparés avec les chiffres
 * de la base et les textes du bureau ; archive des anciens rapports (Word, PDF, photo) par saison.
 */
@ApiTags('Saisons')
@ApiBearerAuth()
@Controller('seasons/:id/reports')
export class SeasonReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: SeasonReportsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Perm('stats.view', 'seasons.manage')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const season = await this.reports.season(id);
    const previous = await this.reports.previous(season);
    const [moral, financial, drafts, files, previousFiles] = await Promise.all([
      this.reports.moral(season),
      this.reports.financial(season),
      this.reports.drafts(season),
      this.prisma.seasonReportFile.findMany({
        where: { seasonId: id, archivedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
      }),
      // Rapports déposés de la saison précédente : modèle pour rédiger ceux de cette saison.
      previous
        ? this.prisma.seasonReportFile.findMany({
            where: { seasonId: previous.id, archivedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
          })
        : Promise.resolve([]),
    ]);
    return {
      season: { id: season.id, label: season.label, status: season.status },
      previous: previous ? { id: previous.id, label: previous.label } : null,
      moral,
      financial,
      drafts,
      files,
      previousFiles,
    };
  }

  /** Textes du bureau (R13 : version). */
  @Put('drafts/:kind')
  @Perm('seasons.manage', 'stats.view')
  async saveDraft(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Body() dto: DraftDto) {
    if (!(KINDS as readonly string[]).includes(kind)) throw new BadRequestException('Rapport inconnu.');
    const k = kind as SeasonReportKind;
    const season = await this.reports.season(id);
    const texts = Object.fromEntries(TEXT_KEYS[k].map((key) => [key, String(dto.texts?.[key] ?? '').slice(0, 6000)]));
    const before = await this.prisma.seasonReportDraft.findUnique({ where: { seasonId_kind: { seasonId: id, kind: k } } });
    if (before) assertVersion(before, dto.version, 'Ce rapport');
    const row = await this.reports.saveDraft(id, k, texts, user.id);
    await this.audit.log(user.id, { action: `${LABEL[k]} modifié`, entity: 'SeasonReportDraft', entityId: row.id, target: `Saison ${season.label}` });
    return { version: row.version, updatedAt: row.updatedAt };
  }

  /** Ancien rapport (Word, PDF ou photo, 10 Mo au plus), rangé dans la saison. */
  @Post('files')
  @HttpCode(200)
  @Perm('seasons.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE } }))
  async upload(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FileDto, @UploadedFile() file?: { buffer: Buffer; originalname: string; size: number }) {
    const season = await this.reports.season(id);
    if (!file?.buffer?.length) throw new BadRequestException('Choisissez le rapport (Word, PDF ou photo).');
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 150);
    const mime = fileType(file.buffer, name);
    if (!mime) throw new BadRequestException('Format accepté : Word (.docx, .doc), PDF, JPG, PNG ou WebP.');
    const row = await this.prisma.seasonReportFile.create({
      data: { seasonId: id, kind: dto.kind, fileName: name, mimeType: mime, size: file.size, data: file.buffer, uploadedById: user.id },
      select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
    });
    await this.audit.log(user.id, { action: `${LABEL[dto.kind]} déposé`, entity: 'SeasonReportFile', entityId: row.id, target: `Saison ${season.label}`, after: name });
    return row;
  }

  @Get('files/:fileId')
  @Perm('stats.view', 'seasons.manage')
  async download(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Res() res: Response) {
    const f = await this.prisma.seasonReportFile.findFirst({ where: { id: fileId, seasonId: id }, select: { fileName: true, mimeType: true, data: true } });
    if (!f) throw new NotFoundException('Rapport introuvable.');
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`);
    res.send(Buffer.from(f.data));
  }

  /** Texte d'un ancien rapport Word (.docx), paragraphe par paragraphe : à relire et reprendre pour le nouveau. */
  @Get('files/:fileId/text')
  @Perm('stats.view', 'seasons.manage')
  async text(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
    const f = await this.prisma.seasonReportFile.findFirst({ where: { id: fileId, seasonId: id }, select: { fileName: true, mimeType: true, data: true } });
    if (!f) throw new NotFoundException('Rapport introuvable.');
    if (!f.mimeType.includes('wordprocessingml')) throw new BadRequestException('Texte disponible pour les rapports Word (.docx) seulement : ouvrez le fichier.');
    try {
      return { fileName: f.fileName, paragraphs: readDocxText(Buffer.from(f.data)) };
    } catch {
      throw new BadRequestException('Document Word illisible.');
    }
  }

  /** R8 : jamais supprimé, retiré de la liste avec motif. */
  @Post('files/:fileId/archive')
  @HttpCode(200)
  @Perm('seasons.manage')
  async archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Body() dto: ArchiveDto) {
    const f = await this.prisma.seasonReportFile.findFirst({ where: { id: fileId, seasonId: id, archivedAt: null } });
    if (!f) throw new NotFoundException('Rapport introuvable.');
    await this.prisma.seasonReportFile.update({ where: { id: fileId }, data: { archivedAt: new Date(), archiveReason: dto.reason.trim() } });
    await this.audit.log(user.id, { action: `${LABEL[f.kind]} retiré`, entity: 'SeasonReportFile', entityId: fileId, target: f.fileName, reason: dto.reason });
    return { archived: true };
  }
}
