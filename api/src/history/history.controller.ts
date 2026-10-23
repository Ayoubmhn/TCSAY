import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { HistoricalKind } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { Feature } from '../modules/modules';
import { HistoryService, REGISTERS, type RawRow, type Register, type Source } from './history.service';

const MAX_FILE = 10 * 1024 * 1024;

class TableDto {
  @IsArray() @ArrayMaxSize(3000) table: RawRow[];
}

class CommitDto extends TableDto {
  @IsIn(['EXCEL', 'WORD', 'MANUAL']) source: Source;
  @IsOptional() @IsString() @MaxLength(150) fileName?: string;
}

class CancelDto {
  @IsString() @MinLength(3, { message: 'Motif obligatoire.' }) @MaxLength(300) reason: string;
}

const register = (r: string): Register => {
  if (!(REGISTERS as readonly string[]).includes(r)) throw new BadRequestException('Registre inconnu (PLAYERS, INCOME ou EXPENSE).');
  return r as Register;
};

/**
 * Import de l'historique (saisons passées) : lecture d'un fichier Excel ou Word en tableau modifiable, analyse,
 * enregistrement par lot (origine IMPORT, R14), annulation d'un lot avec motif ; bilan des saisons passées.
 */
@ApiTags('Import historique')
@ApiBearerAuth()
@Feature('import-historique')
@Controller('history')
@Perm('import.manage')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  overview() {
    return this.history.overview();
  }

  /** Fichier Excel (.xlsx) ou Word (.docx) → lignes du tableau (rien n'est enregistré). */
  @Post('read/:register')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE } }))
  read(@Param('register') r: string, @UploadedFile() file?: { buffer: Buffer; originalname: string }) {
    if (!file?.buffer?.length) throw new BadRequestException('Choisissez un fichier Excel (.xlsx) ou Word (.docx).');
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 150);
    if (!/\.(xlsx|docx)$/i.test(name)) throw new BadRequestException('Format accepté : Excel (.xlsx) ou Word (.docx). Un ancien .xls / .doc : enregistrez-le d’abord au nouveau format.');
    return { fileName: name, ...this.history.read(register(r), file.buffer, name) };
  }

  @Post(':seasonId/preview/:register')
  @HttpCode(200)
  preview(@Param('seasonId', ParseUUIDPipe) seasonId: string, @Param('register') r: string, @Body() dto: TableDto) {
    return this.history.preview(seasonId, register(r), dto.table);
  }

  @Post(':seasonId/commit/:register')
  @HttpCode(200)
  commit(@CurrentUser() user: AuthUser, @Param('seasonId', ParseUUIDPipe) seasonId: string, @Param('register') r: string, @Body() dto: CommitDto) {
    return this.history.commit(user, seasonId, register(r), dto.table, dto.source, dto.fileName?.trim() || null);
  }

  @Get(':seasonId/entries')
  entries(@Param('seasonId', ParseUUIDPipe) seasonId: string, @Query('kind') kind?: string) {
    return this.history.entries(seasonId, kind === 'EXPENSE' ? HistoricalKind.EXPENSE : HistoricalKind.INCOME);
  }

  @Post('batches/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.history.cancel(user, id, dto.reason);
  }
}
