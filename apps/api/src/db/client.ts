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
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  });
}

export function createDb(pool = createPool()): Db {
  return drizzle(pool, { schema });
}
