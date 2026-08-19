import pg from 'pg';
import { env } from '../../config/env.js';

const verifyTestDatabase = process.argv[2] === 'test';
const databaseUrl = verifyTestDatabase ? process.env.TEST_DATABASE_URL : env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(`${verifyTestDatabase ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is required to verify PostgreSQL.`);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
  max: 1,
  ssl: env.DATABASE_SSL,
});

try {
  console.log(`Database target: ${verifyTestDatabase ? 'test' : 'application'}`);
  const tables = await pool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  const indexes = await pool.query<{ indexname: string }>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
    ORDER BY indexname
  `);
  const counts = await pool.query<{
    brokers: number;
    devices: number;
    telemetry: number;
    commands: number;
    events: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::integer FROM mqtt_connections) AS brokers,
      (SELECT COUNT(*)::integer FROM devices) AS devices,
      (SELECT COUNT(*)::integer FROM telemetry) AS telemetry,
      (SELECT COUNT(*)::integer FROM command_logs) AS commands,
      (SELECT COUNT(*)::integer FROM event_logs) AS events
  `);

  console.log(`Tables: ${tables.rows.map((row) => row.table_name).join(', ')}`);
  console.log(`Indexes: ${indexes.rows.map((row) => row.indexname).join(', ')}`);
  console.log('Record counts:', counts.rows[0]);
} finally {
  await pool.end();
}
