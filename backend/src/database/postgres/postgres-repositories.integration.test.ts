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
  const crudConnectionId = randomUUID();
  const crudDeviceId = `phase5-${randomUUID()}`;

  context.after(async () => {
    await setupPool.query('DELETE FROM event_logs WHERE device_id = $1', [deviceId]);
    await setupPool.query('DELETE FROM command_logs WHERE device_id = $1', [deviceId]);
    await setupPool.query('DELETE FROM telemetry WHERE device_id = $1', [deviceId]);
    await setupPool.query('DELETE FROM devices WHERE id = $1', [deviceId]);
    await setupPool.query('DELETE FROM devices WHERE id = $1', [crudDeviceId]);
    await setupPool.query('DELETE FROM mqtt_connections WHERE id = $1', [connectionId]);
    await setupPool.query('DELETE FROM mqtt_connections WHERE id = $1', [crudConnectionId]);
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
    filterStatus: 0,
    fanStatus: 1,
    heaterStatus: 0,
    receivedAt,
  };
  await repositories.telemetry.save(telemetry);
  const telemetryHistory = await repositories.telemetry.getRange(deviceId, 1);
  assert.equal(telemetryHistory.length, 1);
  assert.equal(telemetryHistory[0].temperature, 27.5);
  assert.equal(telemetryHistory[0].filterStatus, 0);
  assert.equal(telemetryHistory[0].fanStatus, 1);
  assert.equal(telemetryHistory[0].heaterStatus, 0);
  assert.equal(telemetryHistory[0].receivedAt, receivedAt);
  assert.equal((await repositories.telemetry.getExportRange(
    deviceId,
    new Date(Date.now() - 60_000).toISOString(),
    new Date(Date.now() + 60_000).toISOString(),
    10,
  )).length, 1);

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
  assert.equal((await repositories.commands.getRange(
    deviceId,
    new Date(Date.now() - 60_000).toISOString(),
    new Date(Date.now() + 60_000).toISOString(),
    10,
  )).length, 1);

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
  assert.equal((await repositories.events.getRange(
    deviceId,
    new Date(Date.now() - 60_000).toISOString(),
    new Date(Date.now() + 60_000).toISOString(),
    10,
  )).length, 1);
  assert.equal(await repositories.checkHealth(), true);
  assert.deepEqual(await repositories.devices.getDataUsage(deviceId), {
    telemetry: 1,
    commands: 1,
    events: 1,
    total: 3,
  });

  const crudConnection = await repositories.mqttConnections.create({
    id: crudConnectionId,
    name: 'Phase 5 CRUD broker',
    brokerUrl: 'mqtt://localhost',
    port: 1884,
    useTls: false,
    username: null,
    encryptedPassword: null,
    clientIdPrefix: 'phase5',
    enabled: true,
  });
  assert.equal(crudConnection.id, crudConnectionId);
  assert.ok((await repositories.mqttConnections.getAll()).some((row) => row.id === crudConnectionId));
  assert.equal((await repositories.mqttConnections.update({
    ...crudConnection,
    name: 'Phase 5 CRUD broker updated',
    enabled: false,
  }))?.name, 'Phase 5 CRUD broker updated');

  const crudDevice = await repositories.devices.create({
    id: crudDeviceId,
    name: 'Phase 5 CRUD device',
    mqttConnectionId: crudConnectionId,
    telemetryTopic: `${crudDeviceId}/nhan`,
    commandTopic: `${crudDeviceId}/caidat`,
    responseTopic: `${crudDeviceId}/nhan`,
    offlineAfterSeconds: 25,
    enabled: false,
  });
  assert.ok((await repositories.devices.getAll()).some((row) => row.id === crudDeviceId));
  assert.equal(await repositories.mqttConnections.countDevices(crudConnectionId), 1);
  assert.deepEqual(await repositories.devices.getDataUsage(crudDeviceId), {
    telemetry: 0,
    commands: 0,
    events: 0,
    total: 0,
  });
  assert.equal((await repositories.devices.update({ ...crudDevice, name: 'Updated device' }))?.name, 'Updated device');
  assert.equal(await repositories.devices.delete(crudDeviceId), true);
  assert.equal(await repositories.mqttConnections.delete(crudConnectionId), true);

  await setupPool.query('UPDATE devices SET enabled = FALSE WHERE id = $1', [deviceId]);
  assert.ok(!(await repositories.devices.getEnabled()).some((row) => row.id === deviceId));
  assert.equal((await repositories.devices.getById(deviceId))?.enabled, false);

  await setupPool.query('UPDATE mqtt_connections SET enabled = FALSE WHERE id = $1', [connectionId]);
  assert.ok(!(await repositories.mqttConnections.getEnabled()).some((row) => row.id === connectionId));
  assert.equal((await repositories.mqttConnections.getById(connectionId))?.enabled, false);
});
