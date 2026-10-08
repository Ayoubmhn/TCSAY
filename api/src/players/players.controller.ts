import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Perm, Roles } from '../auth/auth-user';
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
  @Perm('players.manage', 'payments.collect', 'groups.manage')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.players.get(id);
  }

  @Get(':id/profile')
  @Perm('players.manage', 'payments.collect', 'groups.manage', 'parents.manage')
  profile(@Param('id', ParseUUIDPipe) id: string) {
    return this.players.profile(id);
  }

  @Post()
  @Perm('players.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlayerDto) {
    return this.players.create(user, dto);
  }

  @Patch(':id')
  @Perm('players.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlayerDto) {
    return this.players.update(user, id, dto);
  }

  @Post(':id/category')
  @Perm('players.manage')
  changeCategory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeCategoryDto) {
    return this.players.changeCategory(user, id, dto);
  }

  @Post(':id/archive')
  @Perm('players.manage')
  archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.players.archive(user, id);
  }

  @Post(':id/restore')
  @Perm('players.manage')
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
