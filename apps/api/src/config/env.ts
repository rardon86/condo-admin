import { z } from 'zod';

const DEV_SECRET = /change-me/;
const emptyAsUndefined = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' ? undefined : v), t);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().default('postgres://app:app@localhost:5432/residencial'),
    DATABASE_SSL: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-please'),
    JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-please'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    /** Superusuario inicial: se crea al arrancar solo si no existe (nunca se resetea su contraseña). */
    SUPERADMIN_USERNAME: emptyAsUndefined(z.string().min(3).optional()),
    SUPERADMIN_PASSWORD: emptyAsUndefined(z.string().min(8).optional()),
    SUPERADMIN_EMAIL: emptyAsUndefined(z.string().email().optional()),
    RUN_MIGRATIONS: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production') {
      for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
        if (DEV_SECRET.test(v[key]) || v[key].length < 32) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'Secreto inseguro en producción' });
        }
      }
    }
  });

/** En AWS, ECS inyecta las credenciales de RDS por separado (desde Secrets Manager); se arma la URL aquí. */
function withDatabaseUrl(e: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (e.DATABASE_URL || !e.DB_HOST) return e;
  const user = encodeURIComponent(e.DB_USER ?? 'app');
  const pass = encodeURIComponent(e.DB_PASSWORD ?? '');
  return { ...e, DATABASE_URL: `postgres://${user}:${pass}@${e.DB_HOST}:${e.DB_PORT ?? 5432}/${e.DB_NAME ?? 'residencial'}` };
}

export const env = schema.parse(withDatabaseUrl(process.env));
export type Env = typeof env;
