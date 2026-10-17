import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { AllowPendingPassword, AuthUser, CurrentUser } from '../auth/auth-user';
import { PrismaService } from '../prisma/prisma.service';

class ListQuery {
  @IsOptional()
  @IsIn(['unread', 'all'])
  filter?: 'unread' | 'all';
}

/** Notifications dans l'application (cloche) : chacun ne voit que les siennes. */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    return this.prisma.notification.findMany({
      where: { userId: user.id, ...(q.filter === 'unread' ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true, broadcastId: true },
    });
  }

  /** Nombre de notifications non lues (interrogé toutes les 60 s par la cloche). */
  @Get('count')
  @AllowPendingPassword()
  async count(@CurrentUser() user: AuthUser) {
    return { unread: await this.prisma.notification.count({ where: { userId: user.id, readAt: null } }) };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    const { count } = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { read: count };
  }
}
