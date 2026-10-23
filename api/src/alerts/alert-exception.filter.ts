import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { alert, describeError } from './telegram';

/**
 * Filet de sécurité de toutes les requêtes : une erreur imprévue (bug, base injoignable…) répond 500 à cette
 * requête seulement, est écrite dans les logs et envoyée sur Telegram. Les refus normaux (400, 403, 404, 409…)
 * ne déclenchent aucune alerte.
 */
@Catch()
export class AlertExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Erreur');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException) || exception.getStatus() >= 500) {
      const req = host.switchToHttp().getRequest<Request & { user?: AuthUser }>();
      const route = `${req?.method ?? '?'} ${(req?.originalUrl ?? req?.url ?? '?').split('?')[0]}`;
      const lines = describeError(exception);
      this.logger.error(`${route} : ${lines.join(' | ')}`);
      void alert(
        'error',
        'Erreur du serveur (500)',
        [route, ...(req?.user ? [`Compte ${req.user.id} (${req.user.role})`] : []), ...lines],
        `500:${route.replace(/\/[0-9a-z-]{20,}/gi, '/:id')}:${lines[0]}`,
      );
    }
    super.catch(exception, host);
  }
}
