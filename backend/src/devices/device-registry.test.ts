import assert from 'node:assert/strict';
import test from 'node:test';
import type { CommandRecord } from '../commands/command-service.js';
import type { DeviceConfig } from '../configuration/configuration-types.js';
import type { Telemetry } from '../mqtt/telemetry-schema.js';
import { DeviceRegistry, DuplicateDeviceRuntimeError } from './device-registry.js';
import { DeviceRuntime, type PublishDeviceCommand } from './device-runtime.js';

function config(id: string, connectionId = 'connection-1', overrides: Partial<DeviceConfig> = {}): DeviceConfig {
  return {
    id,
    name: id,
    mqttConnectionId: connectionId,
    telemetryTopic: `${id}/nhan`,
    commandTopic: `${id}/caidat`,
    responseTopic: `${id}/nhan`,
    offlineAfterSeconds: 20,
    enabled: true,
    ...overrides,
  };
}

function telemetry(id: string): Telemetry {
  return {
    deviceId: id,
    temperature: 27,
    humidity: 58,
    coilTemperature: 19,
    humiditySetpoint: 60,
    temperatureSetpoint: 30,
    runningStatus: 'SYS_RUNNING',
    runningMode: 'SMART',
    waterTankStatus: 'OK',
    sensorError: 0,
    filterStatus: 0,
    fanStatus: 1,
    heaterStatus: 0,
    receivedAt: new Date().toISOString(),
  };
}

function createRegistry() {
  const published: PublishDeviceCommand[] = [];
  const commands: CommandRecord[] = [];
  const registry = new DeviceRegistry((deviceConfig) => new DeviceRuntime({
    config: deviceConfig,
    async publish(command) {
      published.push(command);
    },
    onCommandUpdate: (message) => commands.push(message.value),
    commandTimeoutMs: 60_000,
  }));
  return { registry, published, commands };
}

test('DeviceRegistry registers, finds and groups runtimes deterministically', () => {
  const fixture = createRegistry();
  fixture.registry.register(config('device-b'));
  fixture.registry.register(config('device-a'));
  fixture.registry.register(config('device-c', 'connection-2'));

  assert.equal(fixture.registry.size, 3);
  assert.deepEqual(fixture.registry.getAll().map((runtime) => runtime.getConfig().id), [
    'device-a',
    'device-b',
    'device-c',
  ]);
  assert.deepEqual(fixture.registry.getByConnectionId('connection-1').map((runtime) => runtime.getConfig().id), [
    'device-a',
    'device-b',
  ]);
  assert.throws(() => fixture.registry.register(config('device-a')), DuplicateDeviceRuntimeError);
  fixture.registry.shutdownAll();
});

test('DeviceRegistry keeps pending commands independent for each device', async () => {
  const fixture = createRegistry();
  const runtimeA = fixture.registry.register(config('device-a'));
  const runtimeB = fixture.registry.register(config('device-b'));
  runtimeA.handleTelemetry(telemetry('device-a'));
  runtimeB.handleTelemetry(telemetry('device-b'));

  await Promise.all([
    runtimeA.sendSettings({ humiditySetpoint: 60, temperatureSetpoint: 30, mode: 'SMART' }),
    runtimeB.sendSettings({ humiditySetpoint: 60, temperatureSetpoint: 30, mode: 'SMART' }),
  ]);
  assert.ok(runtimeA.getPendingCommand());
  assert.ok(runtimeB.getPendingCommand());
  assert.deepEqual(fixture.published.map((message) => message.topic).sort(), [
    'device-a/caidat',
    'device-b/caidat',
  ]);

  runtimeA.handleDeviceResponse('Da Nhan');
  assert.equal(runtimeA.getPendingCommand(), null);
  assert.ok(runtimeB.getPendingCommand());
  fixture.registry.shutdownAll();
  assert.equal(fixture.commands.filter((command) => command.status === 'error').length, 1);
});

test('DeviceRegistry applies updates and removes a disabled device safely', () => {
  const fixture = createRegistry();
  const runtime = fixture.registry.register(config('device-a'));
  const updated = fixture.registry.apply(config('device-a', 'connection-1', { name: 'Updated name' }));

  assert.equal(updated, runtime);
  assert.equal(runtime.getConfig().name, 'Updated name');
  assert.equal(fixture.registry.apply(config('device-a', 'connection-1', { enabled: false })), null);
  assert.equal(fixture.registry.get('device-a'), undefined);
  assert.equal(runtime.isStopped(), true);
});

test('DeviceRegistry changes MQTT status only for devices on the selected connection', () => {
  const fixture = createRegistry();
  fixture.registry.register(config('device-a', 'connection-1'));
  fixture.registry.register(config('device-b', 'connection-2'));

  fixture.registry.setMqttStatus('connection-1', 'connected');

  assert.equal(fixture.registry.get('device-a')?.getState().mqttStatus, 'connected');
  assert.equal(fixture.registry.get('device-b')?.getState().mqttStatus, 'connecting');
  fixture.registry.shutdownAll();
});

test('DeviceRegistry remove and shutdownAll dispose every runtime', () => {
  const fixture = createRegistry();
  const runtimeA = fixture.registry.register(config('device-a'));
  const runtimeB = fixture.registry.register(config('device-b'));

  assert.equal(fixture.registry.remove('device-a'), true);
  assert.equal(fixture.registry.remove('missing'), false);
  assert.equal(runtimeA.isStopped(), true);
  fixture.registry.shutdownAll();
  assert.equal(runtimeB.isStopped(), true);
  assert.equal(fixture.registry.size, 0);
});
