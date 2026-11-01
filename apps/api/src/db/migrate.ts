import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './client';

export async function runMigrations(connectionString?: string) {
  const pool = createPool(connectionString);
  try {
    await migrate(createDb(pool), { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => console.log('✔ Migraciones aplicadas'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
