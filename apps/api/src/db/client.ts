import { existsSync, readFileSync } from 'node:fs';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

export const DB = Symbol('DB');
export type Db = NodePgDatabase<typeof schema>;
/** Conexión o transacción: los servicios aceptan ambas para poder componer operaciones atómicas. */
export type Tx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export function createPool(connectionString = env.DATABASE_URL) {
  return new Pool({
    connectionString,
    max: 10,
    ssl: sslConfig(),
    // Evita consultas colgadas que agoten el pool
    statement_timeout: 15_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function createDb(pool = createPool()): Db {
  return drizzle(pool, { schema });
}

/**
 * TLS hacia RDS. Con el paquete de certificados de AWS (incluido en la imagen) se verifica la
 * identidad del servidor; sin él, se cifra igual pero sin verificación (solo desarrollo).
 */
function sslConfig() {
  if (!env.DATABASE_SSL) return undefined;
  if (env.DATABASE_SSL_CA && existsSync(env.DATABASE_SSL_CA)) {
    return { ca: readFileSync(env.DATABASE_SSL_CA, 'utf8'), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}
