import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { CommandRecord } from '../../commands/command-service.js';
import { env } from '../../config/env.js';
import type { EventRecord } from '../../events/event-service.js';
import type { Telemetry } from '../../mqtt/telemetry-schema.js';
import { createPostgresRepositories } from './create-postgres-repositories.js';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for the PostgreSQL smoke test.');

const options = {
  connectionString: env.DATABASE_URL,
  connectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT_MS,
  idleTimeoutMs: env.DATABASE_IDLE_TIMEOUT_MS,
  maxConnections: 2,
  useSsl: env.DATABASE_SSL,
};
const repositories = createPostgresRepositories(options);
const cleanupPool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1, ssl: env.DATABASE_SSL });
const receivedAt = new Date().toISOString();
const commandId = randomUUID();
const eventId = randomUUID();

try {
  const telemetry: Telemetry = {
    deviceId: env.DEVICE_ID,
    temperature: 27.1,
    humidity: 58.2,
    coilTemperature: 19.4,
    humiditySetpoint: 60,
    temperatureSetpoint: 30,
    runningStatus: 'SMOKE_TEST',
    runningMode: 'SMART',
    waterTankStatus: 'OK',
    sensorError: 0,
    receivedAt,
  };
  await repositories.telemetry.save(telemetry);
  const telemetryRows = await repositories.telemetry.getRange(env.DEVICE_ID, 1);
  if (!telemetryRows.some((row) => row.receivedAt === receivedAt)) {
    throw new Error('PostgreSQL telemetry smoke record was not returned.');
  }

  const command: CommandRecord = {
    id: commandId,
    deviceId: env.DEVICE_ID,
    mqttPayload: 'SMOKE_TEST',
    status: 'pending',
    createdAt: receivedAt,
  };
  await repositories.commands.save(command);
  await repositories.commands.save({ ...command, status: 'success', completedAt: new Date().toISOString() });
  if (!(await repositories.commands.getHistory(env.DEVICE_ID, 50)).some((row) => row.id === commandId)) {
    throw new Error('PostgreSQL command smoke record was not returned.');
  }

  const event: EventRecord = {
    id: eventId,
    deviceId: env.DEVICE_ID,
    type: 'SMOKE_TEST',
    severity: 'info',
    message: 'PostgreSQL smoke test',
    createdAt: receivedAt,
  };
  await repositories.events.save(event);
  if (!(await repositories.events.getHistory(env.DEVICE_ID, 50)).some((row) => row.id === eventId)) {
    throw new Error('PostgreSQL event smoke record was not returned.');
  }

  console.log('PostgreSQL smoke test passed for telemetry, command and event repositories.');
} finally {
  await cleanupPool.query('DELETE FROM event_logs WHERE id = $1', [eventId]);
  await cleanupPool.query('DELETE FROM command_logs WHERE id = $1', [commandId]);
  await cleanupPool.query('DELETE FROM telemetry WHERE device_id = $1 AND received_at = $2', [env.DEVICE_ID, receivedAt]);
  await repositories.close();
  await cleanupPool.end();
}
