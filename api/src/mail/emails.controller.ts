import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiProperty, ApiTags } from '@nestjs/swagger';
import { EmailStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { Perm } from '../auth/auth-user';
import { MailService } from './mail.service';

class ListEmailsQuery {
  @ApiPropertyOptional({ enum: EmailStatus })
  @IsOptional()
  @IsEnum(EmailStatus)
  status?: EmailStatus;
}

class TestEmailDto {
  @ApiProperty({ example: 'bureau@tennisclubdesayada.tn' })
  @IsEmail({}, { message: 'Adresse email invalide.' })
  to!: string;
}

@ApiTags('Emails envoyés')
@ApiBearerAuth()
@Perm('emails.view')
@Controller('emails')
export class EmailsController {
  constructor(private readonly mail: MailService) {}

  @Get()
  list(@Query() q: ListEmailsQuery) {
    return this.mail.list(q.status);
  }

  /** Serveur SMTP en vigueur (sans mot de passe) et compteurs de la file. */
  @Get('config')
  config() {
    return this.mail.overview();
  }

  /** Envoie un email de test immédiatement ; 400 avec l'erreur SMTP en cas d'échec. */
  @Post('test')
  @HttpCode(200)
  test(@Body() dto: TestEmailDto) {
    return this.mail.test(dto.to.trim());
  }

  /** Remet tous les emails en échec dans la file. */
  @Post('resend-failed')
  @HttpCode(200)
  resendFailed() {
    return this.mail.resendFailed();
  }

  @Post(':id/resend')
  @HttpCode(200)
  resend(@Param('id', ParseUUIDPipe) id: string) {
    return this.mail.resend(id);
  }
}
