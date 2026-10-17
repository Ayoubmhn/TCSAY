import { PaymentPlan } from '@prisma/client';
import { BadRequestException, Controller, HttpCode, Post, UploadedFile, UseInterceptors, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Perm } from '../../auth/auth-user';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { PlayersImportService, type RawRow } from './players-import.service';

/** Ligne du tableau de l'aperçu, corrigée à l'écran. */
class RawRowDto implements RawRow {
  @IsString() @MaxLength(20) n: string;
  @IsString() @MaxLength(20) gender: string;
  @IsString() @MaxLength(120) name: string;
  @IsString() @MaxLength(120) nameAr: string;
  @IsString() @MaxLength(30) birth: string;
  @IsString() @MaxLength(80) phone: string;
  @IsString() @MaxLength(120) email: string;
  @IsString() @MaxLength(120) parent: string;
  @IsString() @MaxLength(200) parentEmail: string;
  @IsString() @MaxLength(80) group: string;
  @IsString() @MaxLength(80) city: string;
  @IsString() @MaxLength(300) remark: string;
}

class TableDto {
  @IsString()
  @MaxLength(200)
  fileName: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => RawRowDto)
  rows: RawRowDto[];

  @IsOptional()
  @IsIn(Object.values(PaymentPlan).filter((p) => p !== PaymentPlan.CUSTOM))
  plan?: PaymentPlan;
}

type Upload = { buffer: Buffer; originalname: string; size: number };
const MAX_SIZE = 5 * 1024 * 1024;

function check(file?: Upload) {
  if (!file?.buffer?.length) throw new BadRequestException('Choisissez le fichier Excel (.xlsx) des joueurs.');
  if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('Format attendu : fichier Excel .xlsx.');
  return { buffer: file.buffer, name: Buffer.from(file.originalname, 'latin1').toString('utf8') };
}

/** Import des joueurs depuis le fichier Excel du cahier (champ « file »). */
@ApiTags('Joueurs')
@ApiBearerAuth()
@Perm('players.manage')
@Controller('players/import')
export class PlayersImportController {
  constructor(private readonly importer: PlayersImportService) {}

  /** Aperçu : rien n'est enregistré. */
  @Post('preview')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIZE } }))
  preview(@UploadedFile() file?: Upload) {
    const f = check(file);
    return this.importer.analyze(f.buffer, f.name);
  }

  /** Aperçu du tableau corrigé à l'écran (rien n'est enregistré). */
  @Post('preview-table')
  @HttpCode(200)
  previewTable(@Body() dto: TableDto) {
    return this.importer.analyzeTable(dto.rows, dto.fileName);
  }

  /** Enregistre le tableau corrigé à l'écran (réanalysé ; les lignes en erreur sont ignorées). */
  @Post('commit-table')
  @HttpCode(200)
  commitTable(@CurrentUser() user: AuthUser, @Body() dto: TableDto) {
    return this.importer.commitTable(user, dto.rows, dto.fileName, dto.plan ?? PaymentPlan.FULL);
  }

  /** Enregistre les lignes valides en une seule fois (les lignes en erreur sont ignorées). */
  @Post('commit')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIZE } }))
  commit(@CurrentUser() user: AuthUser, @UploadedFile() file?: Upload, @Body('plan') plan?: string) {
    const f = check(file);
    // Mode de paiement de la cotisation créée pour chaque joueur inscrit (modifiable ensuite dans sa fiche).
    const paymentPlan = (Object.values(PaymentPlan) as string[]).includes(plan ?? '') ? (plan as PaymentPlan) : PaymentPlan.FULL;
    return this.importer.commit(user, f.buffer, f.name, paymentPlan);
  }
}
