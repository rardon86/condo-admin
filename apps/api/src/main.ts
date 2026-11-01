import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';
import { runMigrations } from './db/migrate';

async function bootstrap() {
  if (env.RUN_MIGRATIONS) {
    await runMigrations();
    Logger.log('Migraciones aplicadas', 'Bootstrap');
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  app.set('trust proxy', 1); // detrás de ALB/CloudFront: IP real del cliente para la marcación
  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: false });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
  Logger.log(`API escuchando en :${env.PORT}/api`, 'Bootstrap');
}

bootstrap();
