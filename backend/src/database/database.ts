import { resolve } from 'node:path';
import { env, projectRoot } from '../config/env.js';
import { createPostgresRepositories } from './postgres/create-postgres-repositories.js';
import type { Repositories } from './repositories.js';
import { createSqliteRepositories } from './sqlite/create-sqlite-repositories.js';

export function createRepositories(): Repositories {
  if (env.DATABASE_DRIVER === 'postgres') {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL.');
    return createPostgresRepositories({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT_MS,
      idleTimeoutMs: env.DATABASE_IDLE_TIMEOUT_MS,
      maxConnections: env.DATABASE_POOL_MAX,
      useSsl: env.DATABASE_SSL,
    });
  }

  return createSqliteRepositories(resolve(projectRoot, env.DATABASE_PATH));
}

export type { Repositories } from './repositories.js';
