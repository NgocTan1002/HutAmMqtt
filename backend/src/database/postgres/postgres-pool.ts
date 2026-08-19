import pg from 'pg';

const { Pool } = pg;

export type PostgresPoolOptions = {
  connectionString: string;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  maxConnections: number;
  useSsl: boolean;
};

export function createPostgresPool(options: PostgresPoolOptions): pg.Pool {
  const pool = new Pool({
    connectionString: options.connectionString,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    idleTimeoutMillis: options.idleTimeoutMs,
    max: options.maxConnections,
    query_timeout: options.connectionTimeoutMs,
    ssl: options.useSsl,
  });

  pool.on('error', (error) => {
    console.error('Unexpected PostgreSQL pool error:', error);
  });

  return pool;
}
