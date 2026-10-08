import { ENV_FILE } from './env';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('TCSAY API')
    .setDescription('API du Tennis Club de Sayada')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config), {
    swaggerOptions: { persistAuthorization: true },
  });

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
  if (process.env.DEMO_MODE === 'true') Logger.warn('Mode démonstration : données fictives, mots de passe des comptes de démo figés.', 'Bootstrap');

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(ENV_FILE ? `Configuration lue dans ${ENV_FILE}` : 'Aucun fichier .env trouvé : valeurs par défaut.', 'Bootstrap');
  Logger.log(`API : http://localhost:${port}/api/v1 · Swagger : http://localhost:${port}/api/docs`, 'Bootstrap');
}

void bootstrap();
