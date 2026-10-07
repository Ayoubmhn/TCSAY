import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/auth-user';
import { AuditService } from './audit.service';

@ApiTags('Journal d’audit')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list() {
    const rows = await this.audit.list();
    return rows.map(({ user, ...row }) => ({ ...row, who: user ? `${user.firstName} ${user.lastName}` : 'Système' }));
  }
}
