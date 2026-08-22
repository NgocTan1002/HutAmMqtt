import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceConfig, MqttConnectionConfig } from '../configuration/configuration-types.js';
import type { DeviceRepository, MqttConnectionRepository } from '../database/repositories.js';
import {
  MqttConnectionManager,
  type ManagedMqttClient,
  type MqttConnectionEvents,
} from '../mqtt/mqtt-connection-manager.js';
import { TopicRouter } from '../mqtt/topic-router.js';
import { DeviceRegistry } from './device-registry.js';
import { DeviceRuntime } from './device-runtime.js';
import { RuntimeCoordinator } from './runtime-coordinator.js';

function connection(id = 'connection-1', overrides: Partial<MqttConnectionConfig> = {}): MqttConnectionConfig {
  return {
    id,
    name: id,
    brokerUrl: 'mqtt://localhost',
    port: 1883,
    useTls: false,
    username: null,
    encryptedPassword: null,
    clientIdPrefix: 'test',
    enabled: true,
    ...overrides,
  };
}

function device(id: string, overrides: Partial<DeviceConfig> = {}): DeviceConfig {
  return {
    id,
    name: id,
    mqttConnectionId: 'connection-1',
    telemetryTopic: `${id}/nhan`,
    commandTopic: `${id}/caidat`,
    responseTopic: `${id}/nhan`,
    offlineAfterSeconds: 20,
    enabled: true,
    ...overrides,
  };
}

function payload(temperature: number): Buffer {
  return Buffer.from(JSON.stringify({
    Tdo: temperature,
    Hdo: 60.5,
    Tgian: 19.4,
    NguongAmSmt: 60,
    NguongNhietCON: 30,
    'Running Status': 'SYS_RUNNING',
    'Running Mode': 'SMART',
    'Water Tank Status': 'OK',
    'Sensor Error': 0,
    'Loc Status': 0,
    'Fan Status': 1,
    'Heater Status': 0,
  }));
}

class FakeClient implements ManagedMqttClient {
  public connected = false;
  public ended = false;
  public constructor(public readonly events: MqttConnectionEvents) {}
  public async subscribe(): Promise<void> {}
  public async unsubscribe(): Promise<void> {}
  public async publish(): Promise<void> {}
  public async end(): Promise<void> {
    this.ended = true;
    this.connected = false;
    this.events.onClose();
  }
  public async connect(): Promise<void> {
    this.connected = true;
    this.events.onConnect();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('RuntimeCoordinator loads devices and hot-applies add, remove and broker changes', async () => {
  let connectionRows = [connection()];
  let deviceRows = [device('mayhutam1'), device('mayhutam2')];
  const connectionRepository: Pick<MqttConnectionRepository, 'getEnabled'> = {
    async getEnabled() { return connectionRows.map((value) => ({ ...value })); },
  };
  const deviceRepository: Pick<DeviceRepository, 'getEnabled'> = {
    async getEnabled() { return deviceRows.map((value) => ({ ...value })); },
  };
  const clients: FakeClient[] = [];
  let router: TopicRouter;
  let manager: MqttConnectionManager;
  const registry = new DeviceRegistry((configuration) => new DeviceRuntime({
    config: configuration,
    publish: (command) => manager.publish(command.connectionId, command.topic, command.payload),
    commandTimeoutMs: 60_000,
  }));
  router = new TopicRouter({
    onTelemetry(message) { registry.get(message.deviceId)!.handleTelemetry(message.telemetry); },
    onDeviceResponse(message) { registry.get(message.deviceId)!.handleDeviceResponse(message.response); },
  });
  manager = new MqttConnectionManager({
    createClient(_configuration, events) {
      const client = new FakeClient(events);
      clients.push(client);
      return client;
    },
    onMessage(connectionId, topic, mqttPayload) {
      router.routeMessage(connectionId, topic, mqttPayload);
    },
    onStatusChanged(state) {
      registry.setMqttStatus(state.connectionId, state.status);
    },
  });
  const coordinator = new RuntimeCoordinator({
    mqttConnections: connectionRepository,
    devices: deviceRepository,
    manager,
    registry,
    router,
  });

  const initial = await coordinator.refresh();
  await clients[0].connect();
  clients[0].events.onMessage('mayhutam1/nhan', payload(21));
  clients[0].events.onMessage('mayhutam2/nhan', payload(29));

  assert.equal(initial.devices.length, 2);
  assert.equal(registry.get('mayhutam1')?.getState().telemetry?.temperature, 21);
  assert.equal(registry.get('mayhutam2')?.getState().telemetry?.temperature, 29);

  deviceRows = [device('mayhutam2'), device('mayhutam3')];
  await coordinator.refresh();
  assert.equal(registry.get('mayhutam1'), undefined);
  assert.ok(registry.get('mayhutam3'));
  assert.deepEqual(manager.getState('connection-1')?.subscriptions, ['mayhutam2/nhan', 'mayhutam3/nhan']);

  connectionRows = [connection('connection-1', { port: 1884 })];
  await coordinator.refresh();
  assert.equal(clients.length, 2);
  assert.equal(clients[0].ended, true);
  assert.equal(registry.get('mayhutam2')?.getState().mqttStatus, 'connecting');

  registry.shutdownAll();
  await manager.shutdown();
});

test('RuntimeCoordinator skips a device whose broker is disabled', async () => {
  const skipped: string[] = [];
  const manager = new MqttConnectionManager({
    createClient(_configuration, events) { return new FakeClient(events); },
    onMessage() {},
  });
  const registry = new DeviceRegistry((configuration) => new DeviceRuntime({
    config: configuration,
    async publish() {},
  }));
  const router = new TopicRouter({ onTelemetry() {}, onDeviceResponse() {} });
  const coordinator = new RuntimeCoordinator({
    mqttConnections: { async getEnabled() { return []; } },
    devices: { async getEnabled() { return [device('orphan')]; } },
    manager,
    registry,
    router,
    onSkippedDevice(value) { skipped.push(value.id); },
  });

  const snapshot = await coordinator.refresh();
  assert.deepEqual(skipped, ['orphan']);
  assert.deepEqual(snapshot.skippedDevices.map((value) => value.id), ['orphan']);
  assert.equal(registry.size, 0);
  await manager.shutdown();
});
