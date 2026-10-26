import type { PoolConfig } from 'pg';
import { readSecret } from './secrets.js';

/** Postgres connection settings from the environment. The password comes from a secret file. */
export function connectionConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const url = env.DATABASE_URL;
  if (url) return { connectionString: url };
  const password = readSecret('PGPASSWORD', env);
  return {
    host: env.PGHOST ?? 'postgres',
    port: Number(env.PGPORT ?? 5432),
    user: env.PGUSER ?? 'family_time',
    database: env.PGDATABASE ?? 'family_time',
    ...(password ? { password } : {}),
  };
}
