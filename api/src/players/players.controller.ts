import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../auth/auth-user';
import { ChangeCategoryDto, CreatePlayerDto, ListPlayersQuery, UpdateContactDto, UpdatePlayerDto } from './players.dto';
import { PlayersService } from './players.service';

@ApiTags('Joueurs')
@ApiBearerAuth()
@Controller('players')
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  /** Liste admin ; le coach voit la liste pour choisir un élève (séance privée). */
  @Get()
  @Roles(Role.ADMIN, Role.COACH)
  list(@Query() q: ListPlayersQuery) {
    return this.players.list(q);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.players.get(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlayerDto) {
    return this.players.create(user, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlayerDto) {
    return this.players.update(user, id, dto);
  }

  @Post(':id/category')
  @Roles(Role.ADMIN)
  changeCategory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeCategoryDto) {
    return this.players.changeCategory(user, id, dto);
  }

  @Post(':id/archive')
  @Roles(Role.ADMIN)
  archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.players.archive(user, id);
  }

  @Post(':id/restore')
  @Roles(Role.ADMIN)
  restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.players.restore(user, id);
  }

  /** R9 : le joueur ou le parent modifie téléphone et email. */
  @Patch(':id/contact')
  @Roles(Role.PLAYER, Role.PARENT, Role.ADMIN)
  updateContact(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContactDto) {
    return this.players.updateContact(user, id, dto);
  }
}
