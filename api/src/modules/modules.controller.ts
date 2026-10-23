import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth-user';
import { disabledModules } from './modules';

@ApiTags('Modules')
@Public()
@Controller('modules')
export class ModulesController {
  /** Modules coupés pour cette mise en ligne : le site les retire (menu, écrans, langue). Public : la connexion en a besoin. */
  @Get()
  list(): { disabled: string[] } {
    return { disabled: disabledModules() };
  }
}
