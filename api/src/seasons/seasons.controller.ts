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
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Season } from '@prisma/client';
import { ChangeSeasonStatusDto } from './dto/change-season-status.dto';
import { CreateSeasonDto } from './dto/create-season.dto';
import { QuerySeasonsDto } from './dto/query-seasons.dto';
import { UpdateSeasonDto } from './dto/update-season.dto';
import { SeasonsService } from './seasons.service';

// TODO S1 : réserver la création, la modification et l'archivage à l'admin (@Roles).
@ApiTags('Saisons')
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
  create(@Body() dto: CreateSeasonDto): Promise<Season> {
    return this.seasons.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier une saison (R1, R13)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSeasonDto): Promise<Season> {
    return this.seasons.update(id, dto);
  }

  @Post(':id/status')
  @ApiOperation({ summary: 'Changer le statut : activer, clôturer, rouvrir avec motif (R1, R2, R13)' })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeSeasonStatusDto,
  ): Promise<Season> {
    return this.seasons.changeStatus(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archiver une saison (R8, R13)' })
  @ApiQuery({ name: 'version', type: Number, description: 'Version lue avant archivage (R13)' })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('version', ParseIntPipe) version: number,
  ): Promise<Season> {
    return this.seasons.archive(id, version);
  }
}
