import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { CommandRecord } from '../../commands/command-service.js';
import type { EventRecord } from '../../events/event-service.js';
import type { Telemetry } from '../../mqtt/telemetry-schema.js';
import { createSqliteRepositories } from './create-sqlite-repositories.js';

function createTemporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'nhiet-am-mqtt-phase1-'));
  return { directory, databasePath: join(directory, 'test.db') };
}

function telemetry(deviceId: string, index: number): Telemetry {
  return {
    deviceId,
    temperature: 25 + index,
    humidity: 55 + index,
    coilTemperature: 20 + index,
    humiditySetpoint: 60,
    temperatureSetpoint: 28,
    runningStatus: 'SYS_RUNNING',
    runningMode: 'SMART',
    waterTankStatus: 'OK',
    sensorError: 0,
    receivedAt: new Date(Date.now() - (3 - index) * 1_000).toISOString(),
  };
}

test('SQLite repositories persist and query telemetry by device', async (context) => {
  const temporary = createTemporaryDatabase();
  const repositories = createSqliteRepositories(temporary.databasePath);
  context.after(() => {
    repositories.close();
    rmSync(temporary.directory, { recursive: true, force: true });
  });

  await repositories.telemetry.save(telemetry('device-1', 0));
  await repositories.telemetry.save(telemetry('device-2', 1));
  await repositories.telemetry.save(telemetry('device-1', 2));

  const history = await repositories.telemetry.getRange('device-1', 1);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((row) => row.temperature), [25, 27]);
  assert.ok(history[0].receivedAt < history[1].receivedAt);
});

test('SQLite command repository updates an existing command instead of duplicating it', async (context) => {
  const temporary = createTemporaryDatabase();
  const repositories = createSqliteRepositories(temporary.databasePath);
  context.after(() => {
    repositories.close();
    rmSync(temporary.directory, { recursive: true, force: true });
  });

  const pending: CommandRecord = {
    id: 'command-1',
    deviceId: 'device-1',
    mqttPayload: 'ALL=SH=60.0,ST=28.0,MD=0\r\n',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await repositories.commands.save(pending);
  await repositories.commands.save({
    ...pending,
    status: 'success',
    response: 'Đã xác nhận qua telemetry.',
    completedAt: new Date().toISOString(),
  });

  const commands = await repositories.commands.getHistory('device-1', 20);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].status, 'success');
  assert.equal(commands[0].response, 'Đã xác nhận qua telemetry.');
  assert.ok(commands[0].completedAt);
});

test('SQLite event repository returns typed events in newest-first order', async (context) => {
  const temporary = createTemporaryDatabase();
  const repositories = createSqliteRepositories(temporary.databasePath);
  context.after(() => {
    repositories.close();
    rmSync(temporary.directory, { recursive: true, force: true });
  });

  const older: EventRecord = {
    id: 'event-1',
    deviceId: 'device-1',
    type: 'DEVICE_OFFLINE',
    severity: 'danger',
    message: 'Thiết bị đã mất kết nối.',
    createdAt: new Date(Date.now() - 1_000).toISOString(),
  };
  const newer: EventRecord = {
    ...older,
    id: 'event-2',
    type: 'DEVICE_ONLINE',
    severity: 'info',
    message: 'Thiết bị đã kết nối trở lại.',
    createdAt: new Date().toISOString(),
  };
  await repositories.events.save(older);
  await repositories.events.save(newer);

  const events = await repositories.events.getHistory('device-1', 30);
  assert.deepEqual(events.map((event) => event.id), ['event-2', 'event-1']);
  assert.equal(events[0].severity, 'info');
});

test('SQLite schema initialization is idempotent and close is safe to repeat', async () => {
  const temporary = createTemporaryDatabase();
  const first = createSqliteRepositories(temporary.databasePath);
  first.close();
  first.close();

  const second = createSqliteRepositories(temporary.databasePath);
  assert.deepEqual(await second.commands.getHistory('device-1', 20), []);
  assert.deepEqual(await second.mqttConnections.getEnabled(), []);
  assert.deepEqual(await second.devices.getEnabled(), []);
  assert.equal(await second.mqttConnections.getById('connection-1'), null);
  assert.equal(await second.devices.getById('device-1'), null);
  second.close();
  rmSync(temporary.directory, { recursive: true, force: true });
});
