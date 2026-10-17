import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role, Season } from '@prisma/client';
import { AuthUser, CurrentUser, Roles, Perm } from '../auth/auth-user';
import { ChangeSeasonStatusDto } from './dto/change-season-status.dto';
import { CreateSeasonDto } from './dto/create-season.dto';
import { QuerySeasonsDto } from './dto/query-seasons.dto';
import { UpdateSeasonDto } from './dto/update-season.dto';
import { SeasonsService } from './seasons.service';

@ApiTags('Saisons')
@ApiBearerAuth()
@Controller('seasons')
export class SeasonsController {
  constructor(private readonly seasons: SeasonsService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les saisons' })
  findAll(@Query() query: QuerySeasonsDto): Promise<Season[]> {
    return this.seasons.findAll(query);
  }

  @Get('active')
  @ApiOperation({ summary: 'Saison active' })
  findActive(): Promise<Season> {
    return this.seasons.findActive();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d’une saison' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Season> {
    return this.seasons.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Créer une saison (brouillon ou historique)' })
  @Perm('seasons.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSeasonDto): Promise<Season> {
    return this.seasons.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier une saison (R1, R13)' })
  @Perm('seasons.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSeasonDto,
  ): Promise<Season> {
    return this.seasons.update(user.id, id, dto);
  }

  @Post(':id/status')
  @ApiOperation({ summary: 'Changer le statut : activer, clôturer, rouvrir avec motif (R1, R2, R13)' })
  @Perm('seasons.manage')
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeSeasonStatusDto,
  ): Promise<Season> {
    return this.seasons.changeStatus(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archiver une saison (R8, R13)' })
  @ApiQuery({ name: 'version', type: Number, description: 'Version lue avant archivage (R13)' })
  @Perm('seasons.manage')
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('version', ParseIntPipe) version: number,
  ): Promise<Season> {
    return this.seasons.archive(user.id, id, version);
  }
}
