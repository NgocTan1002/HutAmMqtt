import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type SqliteDatabaseContext = {
  database: DatabaseSync;
  close(): void;
};

function initializeSchema(database: DatabaseSync): void {
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      temperature REAL NOT NULL,
      humidity REAL NOT NULL,
      coil_temperature REAL NOT NULL,
      humidity_setpoint REAL NOT NULL,
      temperature_setpoint REAL NOT NULL,
      running_status TEXT NOT NULL,
      running_mode TEXT NOT NULL,
      water_tank_status TEXT NOT NULL,
      sensor_error INTEGER NOT NULL,
      received_at TEXT NOT NULL
    )
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_telemetry_device_received_at
    ON telemetry(device_id, received_at DESC)
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS command_log (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      mqtt_payload TEXT NOT NULL,
      status TEXT NOT NULL,
      response TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    )
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_command_log_device_created_at
    ON command_log(device_id, created_at DESC)
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS event_log (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_event_log_device_created_at
    ON event_log(device_id, created_at DESC)
  `);
  database.exec('PRAGMA optimize');
}

export function createSqliteDatabase(databasePath: string): SqliteDatabaseContext {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  initializeSchema(database);
  let closed = false;

  return {
    database,
    close() {
      if (closed) return;
      database.close();
      closed = true;
    },
  };
}
