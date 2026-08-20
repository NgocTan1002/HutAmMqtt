import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import type { CommandRecord } from '../../commands/command-service.js';
import type { EventRecord } from '../../events/event-service.js';
import type { Telemetry } from '../../mqtt/telemetry-schema.js';
import { projectRoot } from '../../config/env.js';
import { createPostgresRepositories } from './create-postgres-repositories.js';

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL migration and repositories work together', { skip: !databaseUrl }, async (context) => {
  assert.ok(databaseUrl);

  await runner({
    databaseUrl,
    dir: resolve(projectRoot, 'backend/migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Number.POSITIVE_INFINITY,
    verbose: false,
  });
  // A second run must be a safe no-op.
  await runner({
    databaseUrl,
    dir: resolve(projectRoot, 'backend/migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Number.POSITIVE_INFINITY,
    verbose: false,
  });

  const setupPool = new Pool({ connectionString: databaseUrl, max: 2 });
  const repositories = createPostgresRepositories({
    connectionString: databaseUrl,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 5_000,
    maxConnections: 2,
    useSsl: false,
  });
  const connectionId = randomUUID();
  const deviceId = `phase2-${randomUUID()}`;

  context.after(async () => {
    await setupPool.query('DELETE FROM event_logs WHERE device_id = $1', [deviceId]);
    await setupPool.query('DELETE FROM command_logs WHERE device_id = $1', [deviceId]);
    await setupPool.query('DELETE FROM telemetry WHERE device_id = $1', [deviceId]);
    await setupPool.query('DELETE FROM devices WHERE id = $1', [deviceId]);
    await setupPool.query('DELETE FROM mqtt_connections WHERE id = $1', [connectionId]);
    await repositories.close();
    await setupPool.end();
  });

  await setupPool.query(
    `INSERT INTO mqtt_connections (
      id, name, broker_url, port, use_tls, username, encrypted_password, client_id_prefix
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [connectionId, 'Phase 2 integration broker', 'mqtt://localhost', 1883, false, 'tester', 'encrypted', 'phase2'],
  );
  await setupPool.query(
    `INSERT INTO devices (
      id, name, mqtt_connection_id, telemetry_topic, command_topic, response_topic
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [deviceId, 'Phase 2 integration device', connectionId, `${deviceId}/nhan`, `${deviceId}/caidat`, `${deviceId}/nhan`],
  );

  assert.deepEqual(await repositories.mqttConnections.getById(connectionId), {
    id: connectionId,
    name: 'Phase 2 integration broker',
    brokerUrl: 'mqtt://localhost',
    port: 1883,
    useTls: false,
    username: 'tester',
    encryptedPassword: 'encrypted',
    clientIdPrefix: 'phase2',
    enabled: true,
  });
  assert.ok((await repositories.mqttConnections.getEnabled()).some((row) => row.id === connectionId));
  assert.equal(await repositories.mqttConnections.getById(randomUUID()), null);

  assert.deepEqual(await repositories.devices.getById(deviceId), {
    id: deviceId,
    name: 'Phase 2 integration device',
    mqttConnectionId: connectionId,
    telemetryTopic: `${deviceId}/nhan`,
    commandTopic: `${deviceId}/caidat`,
    responseTopic: `${deviceId}/nhan`,
    offlineAfterSeconds: 20,
    enabled: true,
  });
  assert.ok((await repositories.devices.getEnabled()).some((row) => row.id === deviceId));
  assert.equal(await repositories.devices.getById(`missing-${randomUUID()}`), null);

  const receivedAt = new Date().toISOString();
  const telemetry: Telemetry = {
    deviceId,
    temperature: 27.5,
    humidity: 60.5,
    coilTemperature: 19.2,
    humiditySetpoint: 60,
    temperatureSetpoint: 30,
    runningStatus: 'SYS_RUNNING',
    runningMode: 'SMART',
    waterTankStatus: 'OK',
    sensorError: 0,
    receivedAt,
  };
  await repositories.telemetry.save(telemetry);
  const telemetryHistory = await repositories.telemetry.getRange(deviceId, 1);
  assert.equal(telemetryHistory.length, 1);
  assert.equal(telemetryHistory[0].temperature, 27.5);
  assert.equal(telemetryHistory[0].receivedAt, receivedAt);

  const command: CommandRecord = {
    id: randomUUID(),
    deviceId,
    mqttPayload: 'ALL=SH=60.0,ST=30.0,MD=0\r\n',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await repositories.commands.save(command);
  await repositories.commands.save({
    ...command,
    status: 'success',
    response: 'Confirmed',
    completedAt: new Date().toISOString(),
  });
  const commands = await repositories.commands.getHistory(deviceId, 20);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].status, 'success');

  const event: EventRecord = {
    id: randomUUID(),
    deviceId,
    type: 'DEVICE_ONLINE',
    severity: 'info',
    message: 'Device connected.',
    createdAt: new Date().toISOString(),
  };
  await repositories.events.save(event);
  const events = await repositories.events.getHistory(deviceId, 20);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, event.id);
  assert.equal(await repositories.checkHealth(), true);

  await setupPool.query('UPDATE devices SET enabled = FALSE WHERE id = $1', [deviceId]);
  assert.ok(!(await repositories.devices.getEnabled()).some((row) => row.id === deviceId));
  assert.equal((await repositories.devices.getById(deviceId))?.enabled, false);

  await setupPool.query('UPDATE mqtt_connections SET enabled = FALSE WHERE id = $1', [connectionId]);
  assert.ok(!(await repositories.mqttConnections.getEnabled()).some((row) => row.id === connectionId));
  assert.equal((await repositories.mqttConnections.getById(connectionId))?.enabled, false);
});
