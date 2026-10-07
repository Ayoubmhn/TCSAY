import { Injectable, Logger } from '@nestjs/common';
import { EmailKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sendSmtp } from './smtp';

/** Envoi d'emails + historique (écran « Emails envoyés »). Un échec d'envoi ne bloque jamais l'action métier. */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly prisma: PrismaService) {}

  async send(to: string, subject: string, text: string, kind: EmailKind): Promise<void> {
    let error: string | null = null;
    try {
      await sendSmtp({
        host: process.env.SMTP_HOST ?? 'localhost',
        port: Number(process.env.SMTP_PORT ?? 1025),
        from: process.env.MAIL_FROM ?? 'no-reply@tennisclubdesayada.tn',
        to,
        subject,
        text,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Email non envoyé à ${to} : ${error}`);
    }
    await this.prisma.emailLog.create({
      data: { to, subject, body: text, kind, status: error ? 'FAILED' : 'SENT', error },
    });
  }

  credentials(to: string, firstName: string, login: string, password: string) {
    return this.send(
      to,
      'Vos identifiants TCSAY',
      [
        `Bonjour ${firstName},`,
        '',
        'Votre compte sur la plateforme du Tennis Club de Sayada a été créé.',
        `Identifiant : ${login}`,
        `Mot de passe temporaire : ${password}`,
        '',
        'Vous devrez choisir un nouveau mot de passe à la première connexion.',
        '',
        'Le bureau du TCSAY',
      ].join('\n'),
      'CREDENTIALS',
    );
  }

  list(limit = 200) {
    return this.prisma.emailLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, to: true, subject: true, kind: true, status: true, error: true, createdAt: true },
    });
  }
}
