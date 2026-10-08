import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Perm } from '../auth/auth-user';
import { MailService } from './mail.service';

@ApiTags('Emails envoyés')
@ApiBearerAuth()
@Perm('emails.view')
@Controller('emails')
export class EmailsController {
  constructor(private readonly mail: MailService) {}

  @Get()
  list() {
    return this.mail.list();
  }
}
