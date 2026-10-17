import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/**
 * Traduit les erreurs Prisma en réponses HTTP lisibles :
 * P2002 (unicité) → 409, P2025 / P2001 (introuvable) → 404, P2003 (clé étrangère) / P2034 (conflit de transaction) → 409, autres → 400.
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientValidationError,
    host: ArgumentsHost,
  ): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.BAD_REQUEST;
    let message = 'Requête invalide.';

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          const target = (exception.meta?.target as string[] | undefined)?.join(', ');
          status = HttpStatus.CONFLICT;
          message = target ? `Valeur déjà utilisée (${target}).` : 'Valeur déjà utilisée.';
          break;
        }
        case 'P2001':
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Élément introuvable.';
          break;
        case 'P2034':
          status = HttpStatus.CONFLICT;
          message = 'Conflit d’écriture simultanée : réessayez.';
          break;
        case 'P2003':
          status = HttpStatus.CONFLICT;
          message = 'Opération impossible : élément lié à d’autres données.';
          break;
        default:
          this.logger.warn(`Erreur Prisma ${exception.code} : ${exception.message}`);
      }
    } else {
      this.logger.warn(exception.message);
    }

    res.status(status).json({ statusCode: status, message, error: HttpStatus[status] });
  }
}
