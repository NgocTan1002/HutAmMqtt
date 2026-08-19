import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env, projectRoot } from '../config/env.js';
import type { Telemetry } from '../mqtt/telemetry-schema.js';
import type { CommandRecord } from '../commands/command-service.js';
import type { EventRecord } from '../events/event-service.js';

const databasePath = resolve(projectRoot, env.DATABASE_PATH);
mkdirSync(dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
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

const insertTelemetryStatement = database.prepare(`
  INSERT INTO telemetry (
    device_id, temperature, humidity, coil_temperature, humidity_setpoint,
    temperature_setpoint, running_status, running_mode, water_tank_status,
    sensor_error, received_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertCommandStatement = database.prepare(`
  INSERT INTO command_log (id, device_id, mqtt_payload, status, response, created_at, completed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    status = excluded.status,
    response = excluded.response,
    completed_at = excluded.completed_at
`);

const insertEventStatement = database.prepare(`
  INSERT INTO event_log (id, device_id, type, severity, message, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

export function saveTelemetry(telemetry: Telemetry): void {
  insertTelemetryStatement.run(
    telemetry.deviceId,
    telemetry.temperature,
    telemetry.humidity,
    telemetry.coilTemperature,
    telemetry.humiditySetpoint,
    telemetry.temperatureSetpoint,
    telemetry.runningStatus,
    telemetry.runningMode,
    telemetry.waterTankStatus,
    telemetry.sensorError,
    telemetry.receivedAt,
  );
}

export function saveCommand(command: CommandRecord): void {
  upsertCommandStatement.run(
    command.id,
    command.deviceId,
    command.mqttPayload,
    command.status,
    command.response ?? null,
    command.createdAt,
    command.completedAt ?? null,
  );
}

type TelemetryHistoryRow = {
  temperature: number;
  humidity: number;
  coilTemperature: number;
  humiditySetpoint: number;
  temperatureSetpoint: number;
  runningStatus: string;
  runningMode: string;
  waterTankStatus: string;
  sensorError: number;
  receivedAt: string;
};

export function getTelemetryRange(deviceId: string, hours: number, maxPoints = 240): TelemetryHistoryRow[] {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = database.prepare(`
    SELECT
      temperature,
      humidity,
      coil_temperature AS coilTemperature,
      humidity_setpoint AS humiditySetpoint,
      temperature_setpoint AS temperatureSetpoint,
      running_status AS runningStatus,
      running_mode AS runningMode,
      water_tank_status AS waterTankStatus,
      sensor_error AS sensorError,
      received_at AS receivedAt
    FROM telemetry
    WHERE device_id = ? AND received_at >= ?
    ORDER BY received_at ASC
  `).all(deviceId, since) as unknown as TelemetryHistoryRow[];

  if (rows.length <= maxPoints) return rows;
  const bucketSize = Math.ceil(rows.length / maxPoints);
  const sampled: TelemetryHistoryRow[] = [];

  for (let index = 0; index < rows.length; index += bucketSize) {
    const bucket = rows.slice(index, index + bucketSize);
    const last = bucket[bucket.length - 1];
    const average = (field: 'temperature' | 'humidity' | 'coilTemperature') =>
      bucket.reduce((total, row) => total + row[field], 0) / bucket.length;
    sampled.push({
      ...last,
      temperature: average('temperature'),
      humidity: average('humidity'),
      coilTemperature: average('coilTemperature'),
    });
  }

  return sampled;
}

export function getCommandHistory(deviceId: string, limit: number): unknown[] {
  return database.prepare(`
    SELECT
      id,
      device_id AS deviceId,
      mqtt_payload AS mqttPayload,
      status,
      response,
      created_at AS createdAt,
      completed_at AS completedAt
    FROM command_log
    WHERE device_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(deviceId, limit);
}

export function saveEvent(event: EventRecord): void {
  insertEventStatement.run(
    event.id,
    event.deviceId,
    event.type,
    event.severity,
    event.message,
    event.createdAt,
  );
}

export function getEventHistory(deviceId: string, limit: number): unknown[] {
  return database.prepare(`
    SELECT
      id,
      device_id AS deviceId,
      type,
      severity,
      message,
      created_at AS createdAt
    FROM event_log
    WHERE device_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(deviceId, limit);
}
