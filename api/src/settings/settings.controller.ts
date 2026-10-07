import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsInt } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { SettingsService } from './settings.service';

class SetValueDto {
  @IsInt()
  value: number;
}

@ApiTags('Paramètres')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  all() {
    return this.settings.all();
  }

  @Patch(':key')
  @Roles(Role.ADMIN)
  async set(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() dto: SetValueDto) {
    const before = await this.settings.all();
    const after = await this.settings.set(key, dto.value);
    await this.audit.log(user.id, {
      action: 'Paramètre modifié',
      entity: 'Setting',
      entityId: key,
      target: key,
      before: String(before[key as keyof typeof before]),
      after: String(dto.value),
    });
    return after;
  }
}
