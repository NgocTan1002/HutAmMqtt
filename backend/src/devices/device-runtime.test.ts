import assert from 'node:assert/strict';
import test from 'node:test';
import type { CommandRecord } from '../commands/command-service.js';
import type { DeviceConfig } from '../configuration/configuration-types.js';
import type { EventRecord } from '../events/event-service.js';
import type { Telemetry } from '../mqtt/telemetry-schema.js';
import type { DeviceState } from '../state/device-state.js';
import { DeviceRuntime, type PublishDeviceCommand } from './device-runtime.js';

function config(overrides: Partial<DeviceConfig> = {}): DeviceConfig {
  return {
    id: 'device-1',
    name: 'Device 1',
    mqttConnectionId: 'connection-1',
    telemetryTopic: 'device-1/nhan',
    commandTopic: 'device-1/caidat',
    responseTopic: 'device-1/nhan',
    offlineAfterSeconds: 20,
    enabled: true,
    ...overrides,
  };
}

function telemetry(deviceId = 'device-1', receivedAt = new Date().toISOString()): Telemetry {
  return {
    deviceId,
    temperature: 27.5,
    humidity: 58.5,
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
}

function createRuntime(deviceConfig = config()) {
  const published: PublishDeviceCommand[] = [];
  const telemetryMessages: Telemetry[] = [];
  const states: DeviceState[] = [];
  const commands: CommandRecord[] = [];
  const events: EventRecord[] = [];
  const runtime = new DeviceRuntime({
    config: deviceConfig,
    async publish(command) {
      published.push(command);
    },
    onTelemetry: (message) => telemetryMessages.push(message.value),
    onStateChanged: (message) => states.push(message.value),
    onCommandUpdate: (message) => commands.push(message.value),
    onEvent: (message) => events.push(message.value),
    commandTimeoutMs: 60_000,
  });
  return { runtime, published, telemetryMessages, states, commands, events };
}

test('DeviceRuntime owns state and routes telemetry callbacks with device context', () => {
  const fixture = createRuntime();
  const input = telemetry();
  const state = fixture.runtime.handleTelemetry(input);

  assert.equal(state.deviceId, 'device-1');
  assert.equal(state.connectionStatus, 'ONLINE');
  assert.equal(state.telemetry?.temperature, 27.5);
  assert.equal(state.telemetry?.filterStatus, 0);
  assert.equal(state.telemetry?.fanStatus, 1);
  assert.equal(state.telemetry?.heaterStatus, 0);
  assert.deepEqual(fixture.telemetryMessages, [input]);
  assert.equal(fixture.states.at(-1)?.deviceId, 'device-1');
  assert.throws(() => fixture.runtime.handleTelemetry(telemetry('device-2')), /cannot be handled/);
});

test('DeviceRuntime publishes settings to its own connection and command topic', async () => {
  const fixture = createRuntime();
  fixture.runtime.handleTelemetry(telemetry());

  const pending = await fixture.runtime.sendSettings({
    humiditySetpoint: 60,
    temperatureSetpoint: 30,
    mode: 'SMART',
  });
  assert.equal(pending.status, 'pending');
  assert.deepEqual(fixture.published[0], {
    connectionId: 'connection-1',
    deviceId: 'device-1',
    topic: 'device-1/caidat',
    payload: 'ALL=SH=60.0,ST=30.0,MD=0\r\n',
  });

  fixture.runtime.handleDeviceResponse('Da Nhan cai dat');
  assert.equal(fixture.commands.at(-1)?.status, 'success');
  assert.equal(fixture.runtime.getPendingCommand(), null);
});

test('DeviceRuntime emits an offline event when its own timeout expires', () => {
  const fixture = createRuntime();
  const receivedAt = new Date('2026-08-20T08:00:00.000Z');
  fixture.runtime.handleTelemetry(telemetry('device-1', receivedAt.toISOString()));

  const state = fixture.runtime.tick(new Date(receivedAt.getTime() + 21_000));
  assert.equal(state.connectionStatus, 'OFFLINE');
  assert.equal(fixture.events.at(-1)?.type, 'DEVICE_OFFLINE');
  assert.equal(fixture.events.at(-1)?.deviceId, 'device-1');
});

test('DeviceRuntime updates non-routing configuration and applies the new offline timeout', () => {
  const fixture = createRuntime();
  const receivedAt = new Date('2026-08-20T08:00:00.000Z');
  fixture.runtime.handleTelemetry(telemetry('device-1', receivedAt.toISOString()));
  fixture.runtime.updateConfig(config({ name: 'Updated device', offlineAfterSeconds: 5 }));

  assert.equal(fixture.runtime.getConfig().name, 'Updated device');
  assert.equal(fixture.runtime.getState(new Date(receivedAt.getTime() + 6_000)).connectionStatus, 'OFFLINE');
});

test('DeviceRuntime rejects routing changes while a command is pending', async () => {
  const fixture = createRuntime();
  fixture.runtime.handleTelemetry(telemetry());
  await fixture.runtime.sendSettings({ humiditySetpoint: 60, temperatureSetpoint: 30, mode: 'SMART' });

  assert.throws(
    () => fixture.runtime.updateConfig(config({ commandTopic: 'device-1/new-command' })),
    /pending command/,
  );
  assert.equal(fixture.runtime.getConfig().commandTopic, 'device-1/caidat');
  fixture.runtime.handleDeviceResponse('Da Nhan');
});

test('DeviceRuntime shutdown completes a pending command and prevents later work', async () => {
  const fixture = createRuntime();
  fixture.runtime.handleTelemetry(telemetry());
  await fixture.runtime.sendSettings({ humiditySetpoint: 60, temperatureSetpoint: 30, mode: 'SMART' });

  fixture.runtime.shutdown('Thiết bị bị xóa.');

  assert.equal(fixture.runtime.isStopped(), true);
  assert.equal(fixture.commands.at(-1)?.status, 'error');
  assert.equal(fixture.commands.at(-1)?.response, 'Thiết bị bị xóa.');
  await assert.rejects(
    fixture.runtime.sendSettings({ humiditySetpoint: 60, temperatureSetpoint: 30, mode: 'SMART' }),
    /has stopped/,
  );
});

test('DeviceRuntime refuses commands while the device is offline', async () => {
  const fixture = createRuntime();
  await assert.rejects(
    fixture.runtime.sendSettings({ humiditySetpoint: 60, temperatureSetpoint: 30, mode: 'SMART' }),
    /ngoại tuyến/,
  );
  assert.deepEqual(fixture.published, []);
});
