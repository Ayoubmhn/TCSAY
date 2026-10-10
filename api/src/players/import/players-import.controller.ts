import { BadRequestException, Controller, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Perm } from '../../auth/auth-user';
import { PlayersImportService } from './players-import.service';

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

  /** Enregistre les lignes valides en une seule fois (les lignes en erreur sont ignorées). */
  @Post('commit')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIZE } }))
  commit(@CurrentUser() user: AuthUser, @UploadedFile() file?: Upload) {
    const f = check(file);
    return this.importer.commit(user, f.buffer, f.name);
  }
}
