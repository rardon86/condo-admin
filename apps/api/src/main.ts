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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Cadena real: navegador → CloudFront → ALB → contenedor. Se confía en exactamente 2 saltos para
  // obtener la IP real del cliente (limitación de tasa y evidencia de marcación) sin aceptar X-Forwarded-For falsificados.
  app.set('trust proxy', env.NODE_ENV === 'production' ? 2 : 'loopback');
  app.disable('x-powered-by');

  // Cuerpos limitados (anti-DoS). 1 MB alcanza para logos ya redimensionados; nada de formularios urlencoded.
  app.useBodyParser('json', { limit: '1mb' });

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    }),
  );
  // Respuestas de la API nunca se guardan en cachés intermedias (contienen datos privados).
  app.use((req: { path: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    if (!req.path.includes('/public/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // En producción el frontend y la API comparten dominio (CloudFront): no se habilita CORS.
  const origins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter((o) => o && o !== '*');
  if (origins.length) app.enableCors({ origin: origins, credentials: false, maxAge: 600 });

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');

  // Tiempos máximos (anti slow-loris). keepAlive > timeout inactivo del ALB (60 s).
  const server = app.getHttpServer();
  server.requestTimeout = 30_000;
  server.headersTimeout = 35_000;
  server.keepAliveTimeout = 65_000;
  Logger.log(`API escuchando en :${env.PORT}/api`, 'Bootstrap');
}

bootstrap();
