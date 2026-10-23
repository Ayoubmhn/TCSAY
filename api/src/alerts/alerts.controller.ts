import { Body, Controller, HttpCode, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Perm, Public } from '../auth/auth-user';
import { AlertsService } from './alerts.service';
import { alert, alertsEnabled } from './telegram';

class ClientErrorDto {
  @IsString()
  @MaxLength(500)
  message!: string;

  /** Adresse de la page, sans ses paramètres. */
  @IsString()
  @MaxLength(200)
  page!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1500)
  stack?: string;
}

/** Erreurs de chunk ou de réseau : téléphone hors connexion ou nouvelle version en ligne, pas un bug. */
const NOISE = /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|NetworkError|Failed to fetch|Load failed/i;

/** Au plus 10 alertes « page en erreur » par heure : la route est publique, elle ne doit pas noyer les vraies alertes. */
const CLIENT_PER_HOUR = 10;
let clientSent: number[] = [];

@ApiTags('Alertes')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  /** Une page du site s'est plantée chez un utilisateur (écran « Cette page ne s'est pas ouverte »). */
  @Public()
  @Post('client-error')
  @HttpCode(204)
  clientError(@Body() dto: ClientErrorDto, @Req() req: Request) {
    if (NOISE.test(dto.message)) return;
    const now = Date.now();
    clientSent = clientSent.filter((t) => now - t < 3_600_000);
    if (clientSent.length >= CLIENT_PER_HOUR) return;
    clientSent.push(now);
    const page = dto.page.split('?')[0];
    const stack = (dto.stack ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);
    const ua = String(req.headers['user-agent'] ?? '');
    const device = /TCSAYApp/.test(ua) ? 'application Android' : /Mobile|Android|iPhone/.test(ua) ? 'téléphone' : 'ordinateur';
    void alert('error', 'Page du site en erreur', [`Page ${page} (${device})`, dto.message, ...stack], `client:${page}:${dto.message}`);
  }

  /** Message d'essai : vérifie TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID (président). */
  @Perm('permissions.manage')
  @Post('test')
  async test() {
    if (!alertsEnabled()) throw new ServiceUnavailableException('Alertes non réglées : ajoutez TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID dans api/.env, puis redémarrez.');
    const sent = await alert('info', 'Message d’essai', ['Les alertes du serveur arrivent bien ici.'], `test:${Date.now()}`);
    if (!sent) throw new ServiceUnavailableException('Telegram n’a pas accepté le message : vérifiez le jeton du bot et l’identifiant de la conversation (voir les logs).');
    return { sent };
  }

  /** Résumé du jour envoyé tout de suite (président). */
  @Perm('permissions.manage')
  @Post('summary')
  async summary() {
    if (!alertsEnabled()) throw new ServiceUnavailableException('Alertes non réglées : ajoutez TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID dans api/.env, puis redémarrez.');
    return { sent: await this.alerts.summary() };
  }
}
