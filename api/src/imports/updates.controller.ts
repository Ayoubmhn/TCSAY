import { BadRequestException, Body, Controller, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { PaymentPlan } from '@prisma/client';
import { AuthUser, CurrentUser, Perm } from '../auth/auth-user';
import { UpdatesService } from './updates.service';

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
}
