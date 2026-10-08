import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReservationType, Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, Roles, Perm } from '../auth/auth-user';
import { todayIso } from '../common/dates';
import { ReservationsService } from './reservations.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);

class DayQuery {
  @IsOptional()
  @Matches(DATE, { message: 'Date au format AAAA-MM-JJ.' })
  date?: string;

  @IsOptional()
  @IsUUID()
  playerId?: string;
}

class CreateReservationDto {
  @IsUUID('all', { message: 'Terrain obligatoire.' })
  courtId: string;

  @Matches(DATE, { message: 'Date au format AAAA-MM-JJ.' })
  date: string;

  /** Départ « HH:MM », à l'heure pile ou à la demi-heure (ex. « 17:30 »). */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):(00|30)$/, { message: 'Heure de départ au format HH:MM (heure pile ou demi-heure).' })
  time?: string;

  /** Ancien format (heure pile) : utiliser « time ». */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID()
  playerId?: string;

  @IsOptional()
  @IsEnum(ReservationType)
  type?: ReservationType;
}

class CancelDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

@ApiTags('Réservations')
@ApiBearerAuth()
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get('grid')
  grid(@CurrentUser() user: AuthUser, @Query() q: DayQuery) {
    return this.reservations.grid(user, q.date ?? todayIso(), q.playerId);
  }

  @Get('mine')
  @Roles(Role.PLAYER, Role.PARENT, Role.COACH)
  mine(@CurrentUser() user: AuthUser, @Query() q: DayQuery) {
    return this.reservations.mine(user, q.playerId);
  }

  @Get()
  @Perm('reservations.manage', 'planning.view')
  byDay(@Query() q: DayQuery) {
    return this.reservations.byDay(q.date ?? todayIso());
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReservationDto) {
    return this.reservations.create(user, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.reservations.cancel(user, id, dto.reason);
  }
}
