import { ENV_FILE } from './env';
import { Logger, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AlertExceptionFilter } from './alerts/alert-exception.filter';
import { alert, describeError } from './alerts/telegram';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { applyHttpSecurity, swaggerEnabled } from './security/http-security';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api/v1');
  // En-têtes de sécurité, CORS, limite de requêtes, adresse réelle derrière l'hébergeur.
  applyHttpSecurity(app);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // Filet de sécurité (erreur imprévue → 500 + alerte Telegram), puis traduction des erreurs Prisma (409, 404…).
  app.useGlobalFilters(new AlertExceptionFilter(app.get(HttpAdapterHost).httpAdapter), new PrismaExceptionFilter());
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('TCSAY API')
    .setDescription('API du Tennis Club de Sayada')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  if (swaggerEnabled()) {
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config), {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Hébergement de test (une seule adresse) : l'API sert aussi le site web compilé (web/dist).
  const webDist = resolve(__dirname, '..', '..', 'web', 'dist');
  if (process.env.SERVE_WEB === 'true' && existsSync(webDist)) {
    app.useStaticAssets(webDist, { index: false });
    // Routes du site (React Router) : toute page hors /api renvoie index.html.
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(join(webDist, 'index.html'));
    });
    Logger.log(`Site web servi depuis ${webDist}`, 'Bootstrap');
  }
  const dbName = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
    } catch {
      return '?';
    }
  })();
  Logger.log(`Base de données : ${dbName}${process.env.TCSAY_PRODUCTION === 'true' ? ' (PRODUCTION)' : ''}`, 'Bootstrap');
  if (process.env.DEMO_MODE === 'true') Logger.warn('Mode démonstration : données fictives, mots de passe des comptes de démo figés.', 'Bootstrap');

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(ENV_FILE ? `Configuration lue dans ${ENV_FILE}` : 'Aucun fichier .env trouvé : valeurs par défaut.', 'Bootstrap');
  Logger.log(
    `API : http://localhost:${port}/api/v1${swaggerEnabled() ? ` · Swagger : http://localhost:${port}/api/docs` : ' · Swagger désactivé (production)'}`,
    'Bootstrap',
  );
}

// Erreur que personne n'a attrapée (tâche de fond, promesse oubliée) : écrite dans les logs et signalée, sans arrêter
// le serveur. Une exception synchrone laisse le processus dans un état incertain : alerte, puis arrêt (l'hébergeur
// relance l'API).
process.on('unhandledRejection', (reason) => {
  Logger.error(`Promesse rejetée sans traitement : ${describeError(reason).join(' | ')}`, 'Processus');
  void alert('error', 'Erreur non traitée (le serveur continue)', describeError(reason), `rejection:${describeError(reason)[0]}`);
});
process.on('uncaughtException', (error) => {
  Logger.error(`Exception non traitée : ${describeError(error).join(' | ')}`, 'Processus');
  void alert('error', 'Le serveur s’est arrêté (redémarrage automatique)', describeError(error), 'crash').finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 10_000).unref();
});

bootstrap().catch((error: unknown) => {
  Logger.error(`Démarrage impossible : ${describeError(error).join(' | ')}`, 'Bootstrap');
  void alert('error', 'Le serveur ne démarre pas', describeError(error), 'boot').finally(() => process.exit(1));
});
