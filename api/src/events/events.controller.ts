import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Public, Roles, Perm } from '../auth/auth-user';
import { dayFromIso, isoDay, todayIso } from '../common/dates';
import { notFound } from '../common/rules';
import { PrismaService } from '../prisma/prisma.service';

class CreateEventDto {
  @IsString()
  @IsNotEmpty({ message: 'Titre obligatoire.' })
  @MaxLength(100)
  title: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date au format AAAA-MM-JJ.' })
  date: string;

  @IsString()
  @IsNotEmpty({ message: 'Lieu obligatoire.' })
  @MaxLength(100)
  place: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  tag: string;
}

@ApiTags('Événements')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Événements publics à venir. */
  @Public()
  @Get()
  async list() {
    const rows = await this.prisma.event.findMany({
      where: { published: true, date: { gte: dayFromIso(todayIso()) } },
      orderBy: { date: 'asc' },
    });
    return rows.map((e) => ({ ...e, date: isoDay(e.date) }));
  }

  @Post()
  @Perm('stats.view', 'players.manage')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateEventDto) {
    const event = await this.prisma.event.create({
      data: { title: dto.title.trim(), date: dayFromIso(dto.date), place: dto.place.trim(), tag: dto.tag.trim() },
    });
    await this.audit.log(user.id, { action: 'Événement créé', entity: 'Event', entityId: event.id, target: event.title });
    return event;
  }

  /** Un événement n'a aucun lien : suppression réelle (R8). */
  @Delete(':id')
  @Perm('stats.view', 'players.manage')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw notFound('Événement');
    await this.prisma.event.delete({ where: { id } });
    await this.audit.log(user.id, { action: 'Événement supprimé', entity: 'Event', entityId: id, target: event.title });
    return { ok: true };
  }
}
