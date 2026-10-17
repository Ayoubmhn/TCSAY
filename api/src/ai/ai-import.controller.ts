import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Put, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { AuthUser, can, CurrentUser, Perm } from '../auth/auth-user';
import { AI_LIMITS, AiImportService, type AiKind } from './ai-import.service';

class ConfigDto {
  @IsBoolean() enabled: boolean;
  /** Avertissement accepté : photos envoyées à Google, données utilisables par Google (niveau gratuit). */
  @IsOptional() @IsBoolean() accept?: boolean;
}

/** Droit nécessaire selon le cahier lu. */
const KIND_PERM: Record<AiKind, string> = { players: 'players.manage', payments: 'payments.collect' };

/** Lecture des photos du cahier par IA (Gemini, niveau gratuit) : la page devient un tableau à vérifier. */
@ApiTags('Imports')
@ApiBearerAuth()
@Controller('ai')
export class AiImportController {
  constructor(private readonly ai: AiImportService) {}

  @Get('status')
  @Perm('players.manage', 'payments.collect', 'permissions.manage')
  status() {
    return this.ai.status();
  }

  /** Président seulement. */
  @Put('config')
  @Perm('permissions.manage')
  configure(@CurrentUser() user: AuthUser, @Body() dto: ConfigDto) {
    return this.ai.configure(user, dto.enabled, dto.accept === true);
  }

  /** Photos (champ « photos », 6 au plus) d'une liste de joueurs ou du cahier des paiements. Rien n'est enregistré. */
  @Post('read/:kind')
  @HttpCode(200)
  @Perm('players.manage', 'payments.collect')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('photos', AI_LIMITS.photos, { limits: { fileSize: AI_LIMITS.photoBytes } }))
  read(@CurrentUser() user: AuthUser, @Param('kind') kind: string, @UploadedFiles() files?: { buffer: Buffer; size: number }[]) {
    if (kind !== 'players' && kind !== 'payments') throw new ForbiddenException('Cahier inconnu.');
    if (!can(user, KIND_PERM[kind])) {
      throw new ForbiddenException(kind === 'players' ? 'Autorisation « joueurs » manquante.' : 'Autorisation « paiements » manquante.');
    }
    return this.ai.readPages(user, kind, files ?? []);
  }
}
