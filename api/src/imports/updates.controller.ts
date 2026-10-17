import { BadRequestException, Body, Controller, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { PaymentPlan } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { UpdatesService, type PaymentRawRow } from './updates.service';

/** Ligne du tableau des paiements corrigée à l'écran. */
class PaymentRowDto implements PaymentRawRow {
  @IsString() @MaxLength(120) name: string;
  @IsString() @MaxLength(120) nameAr: string;
  @IsString() @MaxLength(20) amount: string;
  @IsString() @MaxLength(20) paid: string;
  @IsString() @MaxLength(20) method: string;
  @IsString() @MaxLength(20) receipt: string;
  @IsString() @MaxLength(30) date: string;
}

class PaymentTableDto {
  @IsString() @MaxLength(200) fileName: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PaymentRowDto)
  rows: PaymentRowDto[];

  @IsOptional()
  @IsIn(Object.values(PaymentPlan).filter((p) => p !== PaymentPlan.CUSTOM))
  plan?: PaymentPlan;
}

type Upload = { buffer: Buffer; originalname: string; size: number };
const MAX_SIZE = 5 * 1024 * 1024;

function check(file?: Upload) {
  if (!file?.buffer?.length) throw new BadRequestException('Choisissez le fichier Excel (.xlsx).');
  if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('Format attendu : fichier Excel .xlsx.');
  return { buffer: file.buffer, name: Buffer.from(file.originalname, 'latin1').toString('utf8') };
}

const upload = () => UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIZE } }));

/** Mises à jour par fichier Excel : affectation aux groupes, paiements du cahier (aperçu puis confirmation). */
@ApiTags('Imports')
@ApiBearerAuth()
@Controller('imports')
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  @Post('groups/preview')
  @HttpCode(200)
  @Perm('groups.manage')
  @ApiConsumes('multipart/form-data')
  @upload()
  groupsPreview(@UploadedFile() file?: Upload) {
    const f = check(file);
    return this.updates.analyzeGroups(f.buffer, f.name);
  }

  @Post('groups/commit')
  @HttpCode(200)
  @Perm('groups.manage')
  @ApiConsumes('multipart/form-data')
  @upload()
  groupsCommit(@CurrentUser() user: AuthUser, @UploadedFile() file?: Upload, @Body('correctNames') correctNames?: string) {
    const f = check(file);
    return this.updates.commitGroups(user, f.buffer, f.name, correctNames !== 'false');
  }

  @Post('payments/preview')
  @HttpCode(200)
  @Perm('payments.collect')
  @ApiConsumes('multipart/form-data')
  @upload()
  paymentsPreview(@UploadedFile() file?: Upload) {
    const f = check(file);
    return this.updates.analyzePayments(f.buffer, f.name);
  }

  @Post('payments/commit')
  @HttpCode(200)
  @Perm('payments.collect')
  @ApiConsumes('multipart/form-data')
  @upload()
  paymentsCommit(@CurrentUser() user: AuthUser, @UploadedFile() file?: Upload, @Body('plan') plan?: string) {
    const f = check(file);
    const p = (Object.values(PaymentPlan) as string[]).includes(plan ?? '') ? (plan as PaymentPlan) : PaymentPlan.FULL;
    return this.updates.commitPayments(user, f.buffer, f.name, p);
  }

  /** Tableau des paiements corrigé à l'écran (photo du cahier lue par l'IA) : aperçu, rien n'est enregistré. */
  @Post('payments/preview-table')
  @HttpCode(200)
  @Perm('payments.collect')
  paymentsPreviewTable(@Body() dto: PaymentTableDto) {
    return this.updates.analyzePaymentTable(dto.rows, dto.fileName);
  }

  @Post('payments/commit-table')
  @HttpCode(200)
  @Perm('payments.collect')
  paymentsCommitTable(@CurrentUser() user: AuthUser, @Body() dto: PaymentTableDto) {
    return this.updates.commitPaymentTable(user, dto.rows, dto.fileName, dto.plan ?? PaymentPlan.FULL);
  }
}
