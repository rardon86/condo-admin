import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';
import { runMigrations } from './db/migrate';
import { closedMessage, isOpen, parseServiceHours } from './common/service-hours';

async function bootstrap() {
  if (env.RUN_MIGRATIONS) {
    await runMigrations();
    Logger.log('Migraciones aplicadas', 'Bootstrap');
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Cadena real: AWS = navegador → CloudFront → ALB → contenedor (2 saltos); servidor propio = navegador → Caddy → contenedor (1).
  // Se confía en exactamente TRUST_PROXY saltos para obtener la IP real del cliente (limitación de tasa y evidencia
  // de marcación) sin aceptar X-Forwarded-For falsificados.
  app.set('trust proxy', env.NODE_ENV === 'production' ? env.TRUST_PROXY : 'loopback');
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

  // Horario de servicio: fuera de él todo responde 503 con el aviso (la web lo muestra sin cerrar la sesión).
  const hours = parseServiceHours(env.SERVICE_HOURS, env.SERVICE_TIMEZONE);
  if (hours) {
    const message = closedMessage(hours);
    app.use((req: { path: string }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
      if (req.path === '/api/health' || isOpen(hours)) return next();
      res.status(503).json({ statusCode: 503, message });
    });
    Logger.log(`Horario de servicio ${env.SERVICE_HOURS} (${env.SERVICE_TIMEZONE})`, 'Bootstrap');
  }

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
