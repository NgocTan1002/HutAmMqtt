import { resolve } from 'node:path';
import { runner } from 'node-pg-migrate';
import { env, projectRoot } from '../../config/env.js';

const direction = process.argv[2] === 'down' ? 'down' : 'up';

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run PostgreSQL migrations.');
}

await runner({
  databaseUrl: env.DATABASE_URL,
  dir: resolve(projectRoot, 'backend/migrations'),
  direction,
  migrationsTable: 'pgmigrations',
  count: direction === 'down' ? 1 : Number.POSITIVE_INFINITY,
  verbose: true,
});
