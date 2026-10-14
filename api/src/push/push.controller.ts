import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailKind } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUrl, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AllowPendingPassword, AuthUser, CurrentUser } from '../auth/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';

class KeysDto {
  @Matches(/^[A-Za-z0-9_-]{80,100}$/, { message: 'Clé p256dh invalide.' }) p256dh: string;
  @Matches(/^[A-Za-z0-9_-]{16,32}$/, { message: 'Clé auth invalide.' }) auth: string;
}

class SubscribeDto {
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Adresse de push invalide.' }) @MaxLength(1000) endpoint: string;
  @ValidateNested() @Type(() => KeysDto) keys: KeysDto;
  @IsOptional() @IsString() @MaxLength(300) userAgent?: string;
}

class EndpointDto {
  @IsString() @MaxLength(1000) endpoint: string;
}

/** Abonnement de l'appareil aux notifications push (chaque compte, sur chacun de ses appareils). */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** Clé publique VAPID à donner au navigateur pour s'abonner. */
  @Get('key')
  @AllowPendingPassword()
  async key() {
    return { publicKey: (await this.push.vapid()).publicKey };
  }

  @Post('subscribe')
  @HttpCode(200)
  async subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscribeDto) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { userId: user.id, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent: dto.userAgent?.slice(0, 300) ?? null },
      update: { userId: user.id, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent: dto.userAgent?.slice(0, 300) ?? null },
    });
    return { ok: true, devices: await this.prisma.pushSubscription.count({ where: { userId: user.id } }) };
  }

  @Post('unsubscribe')
  @HttpCode(200)
  async unsubscribe(@CurrentUser() user: AuthUser, @Body() dto: EndpointDto) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId: user.id, endpoint: dto.endpoint } });
    return { ok: true };
  }

  /** Notification d'essai vers ses propres appareils. */
  @Post('test')
  @HttpCode(200)
  async test(@CurrentUser() user: AuthUser) {
    await this.prisma.notification.create({
      data: { userId: user.id, kind: EmailKind.OTHER, title: 'TCSAY · notification d’essai', body: 'Les notifications arrivent bien sur cet appareil.', link: '/notifications' },
    });
    await this.push.flush();
    return { ok: true };
  }
}
