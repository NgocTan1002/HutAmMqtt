import assert from 'node:assert/strict';
import test from 'node:test';
import type { MqttConnectionConfig, DeviceConfig } from './configuration-types.js';
import type {
  DeviceDataUsage,
  DeviceRepository,
  MqttConnectionRepository,
} from '../database/repositories.js';
import { DeviceRegistry } from '../devices/device-registry.js';
import { DeviceRuntime } from '../devices/device-runtime.js';
import { RuntimeCoordinator } from '../devices/runtime-coordinator.js';
import {
  MqttConnectionManager,
  type ManagedMqttClient,
  type MqttConnectionEvents,
} from '../mqtt/mqtt-connection-manager.js';
import { TopicRouter } from '../mqtt/topic-router.js';
import { CredentialCipher } from '../security/credential-cipher.js';
import { ConfigurationError, ConfigurationService } from './configuration-service.js';
import { mqttConnectionUpdateSchema } from './configuration-schemas.js';

class MemoryConnectionRepository implements MqttConnectionRepository {
  public readonly rows = new Map<string, MqttConnectionConfig>();
  public deviceRepository?: MemoryDeviceRepository;
  public async getAll() { return [...this.rows.values()].map((value) => ({ ...value })); }
  public async getEnabled() { return (await this.getAll()).filter((value) => value.enabled); }
  public async getById(id: string) { const value = this.rows.get(id); return value ? { ...value } : null; }
  public async create(config: MqttConnectionConfig) { this.rows.set(config.id, { ...config }); return { ...config }; }
  public async update(config: MqttConnectionConfig) {
    if (!this.rows.has(config.id)) return null;
    this.rows.set(config.id, { ...config });
    return { ...config };
  }
  public async delete(id: string) { return this.rows.delete(id); }
  public async countDevices(id: string) {
    return [...(this.deviceRepository?.rows.values() ?? [])]
      .filter((device) => device.mqttConnectionId === id).length;
  }
}

class MemoryDeviceRepository implements DeviceRepository {
  public readonly rows = new Map<string, DeviceConfig>();
  public readonly usage = new Map<string, DeviceDataUsage>();
  public async getAll() { return [...this.rows.values()].map((value) => ({ ...value })); }
  public async getEnabled() { return (await this.getAll()).filter((value) => value.enabled); }
  public async getById(id: string) { const value = this.rows.get(id); return value ? { ...value } : null; }
  public async create(config: DeviceConfig) { this.rows.set(config.id, { ...config }); return { ...config }; }
  public async update(config: DeviceConfig) {
    if (!this.rows.has(config.id)) return null;
    this.rows.set(config.id, { ...config });
    return { ...config };
  }
  public async delete(id: string) { return this.rows.delete(id); }
  public async getDataUsage(id: string) {
    return this.usage.get(id) ?? { telemetry: 0, commands: 0, events: 0, total: 0 };
  }
}

class FakeClient implements ManagedMqttClient {
  public connected = false;
  public ended = false;
  public constructor(public readonly events: MqttConnectionEvents) {}
  public async subscribe() {}
  public async unsubscribe() {}
  public async publish() {}
  public async end() { this.ended = true; this.events.onClose(); }
}

function fixture(testConnectionFails = false) {
  const connections = new MemoryConnectionRepository();
  const devices = new MemoryDeviceRepository();
  connections.deviceRepository = devices;
  const cipher = CredentialCipher.fromBase64(CredentialCipher.generateKey());
  const clients: FakeClient[] = [];
  const testedPasswords: Array<string | null> = [];
  let manager: MqttConnectionManager;
  const registry = new DeviceRegistry((config) => new DeviceRuntime({
    config,
    publish: (command) => manager.publish(command.connectionId, command.topic, command.payload),
  }));
  const router = new TopicRouter({
    onTelemetry(message) { registry.get(message.deviceId)?.handleTelemetry(message.telemetry); },
    onDeviceResponse(message) { registry.get(message.deviceId)?.handleDeviceResponse(message.response); },
  });
  manager = new MqttConnectionManager({
    decryptPassword: (value) => cipher.decrypt(value),
    createClient(_config, events) {
      const client = new FakeClient(events);
      clients.push(client);
      return client;
    },
    onMessage(connectionId, topic, payload) { router.routeMessage(connectionId, topic, payload); },
    onStatusChanged(state) { registry.setMqttStatus(state.connectionId, state.status); },
  });
  const coordinator = new RuntimeCoordinator({
    mqttConnections: connections,
    devices,
    manager,
    registry,
    router,
  });
  const service = new ConfigurationService({
    mqttConnections: connections,
    devices,
    coordinator,
    manager,
    registry,
    cipher,
    async connectionTester(config) {
      testedPasswords.push(config.password);
      if (testConnectionFails) throw new Error('simulated connection failure');
      return { success: true, durationMs: 1 };
    },
  });
  return { service, connections, devices, manager, registry, clients, testedPasswords };
}

async function createBroker(value: ReturnType<typeof fixture>, overrides = {}) {
  return value.service.createMqttConnection({
    name: 'Broker A',
    brokerUrl: 'mqtt://localhost',
    port: 1883,
    useTls: false,
    username: 'operator',
    password: 'mqtt-secret',
    clientIdPrefix: 'factory',
    enabled: true,
    ...overrides,
  });
}

test('ConfigurationService encrypts, masks, preserves and clears MQTT passwords', async () => {
  const value = fixture();
  const created = await createBroker(value);
  const stored = value.connections.rows.get(created.id)!;

  assert.equal(stored.encryptedPassword?.startsWith('enc:v1:'), true);
  assert.equal(JSON.stringify(created).includes('mqtt-secret'), false);
  assert.equal(JSON.stringify(created).includes(stored.encryptedPassword!), false);
  assert.equal(created.hasPassword, true);

  await value.service.testStoredMqttConnection(created.id);
  assert.deepEqual(value.testedPasswords, ['mqtt-secret']);

  await value.service.updateMqttConnection(created.id, { name: 'Renamed' });
  assert.equal(value.connections.rows.get(created.id)?.encryptedPassword, stored.encryptedPassword);
  const cleared = await value.service.updateMqttConnection(created.id, { password: null });
  assert.equal(cleared.hasPassword, false);
  assert.equal(value.connections.rows.get(created.id)?.encryptedPassword, null);
  await value.manager.shutdown();
});

test('ConfigurationService hot-applies devices and rejects topic conflicts', async () => {
  const value = fixture();
  const broker = await createBroker(value, { password: null });
  const first = await value.service.createDevice({
    id: 'mayhutam1',
    name: 'Máy hút ẩm 1',
    mqttConnectionId: broker.id,
    telemetryTopic: 'mayhutam1/nhan',
    commandTopic: 'mayhutam1/caidat',
    responseTopic: 'mayhutam1/nhan',
    offlineAfterSeconds: 20,
    enabled: true,
  });
  assert.equal(first.id, 'mayhutam1');
  assert.ok(value.registry.get('mayhutam1'));

  await assert.rejects(
    value.service.createDevice({
      id: 'mayhutam2',
      name: 'Máy hút ẩm 2',
      mqttConnectionId: broker.id,
      telemetryTopic: 'mayhutam2/nhan',
      commandTopic: 'mayhutam1/nhan',
      responseTopic: 'mayhutam2/nhan',
      offlineAfterSeconds: 20,
      enabled: true,
    }),
    (error: unknown) => error instanceof ConfigurationError && error.code === 'TOPIC_CONFLICT',
  );
  await assert.rejects(
    value.service.deleteMqttConnection(broker.id),
    (error: unknown) => error instanceof ConfigurationError && error.code === 'BROKER_IN_USE',
  );

  await value.service.updateDevice('mayhutam1', { enabled: false });
  assert.equal(value.registry.get('mayhutam1'), undefined);
  await value.service.deleteDevice('mayhutam1');
  await value.service.deleteMqttConnection(broker.id);
  assert.equal(value.connections.rows.size, 0);
  await value.manager.shutdown();
});

test('ConfigurationService protects device history and disabled brokers', async () => {
  const value = fixture();
  const broker = await createBroker(value, { password: null });
  await value.service.createDevice({
    id: 'history-device',
    name: 'History device',
    mqttConnectionId: broker.id,
    telemetryTopic: 'history/nhan',
    commandTopic: 'history/caidat',
    responseTopic: 'history/nhan',
    offlineAfterSeconds: 20,
    enabled: true,
  });
  value.devices.usage.set('history-device', { telemetry: 1, commands: 0, events: 0, total: 1 });
  await assert.rejects(
    value.service.deleteDevice('history-device'),
    (error: unknown) => error instanceof ConfigurationError && error.code === 'DEVICE_HAS_DATA',
  );

  await value.service.updateDevice('history-device', { enabled: false });
  await value.service.updateMqttConnection(broker.id, { enabled: false });
  await assert.rejects(
    value.service.updateDevice('history-device', { enabled: true }),
    (error: unknown) => error instanceof ConfigurationError && error.code === 'BROKER_DISABLED',
  );
  await value.manager.shutdown();
});

test('ConfigurationService validates broker URL and reconnects only the selected broker', async () => {
  const value = fixture();
  await assert.rejects(
    createBroker(value, { brokerUrl: 'mqtt://user:secret@localhost' }),
    (error: unknown) => error instanceof ConfigurationError && error.code === 'INVALID_BROKER_URL',
  );
  await assert.rejects(
    createBroker(value, { brokerUrl: 'mqtt://localhost', useTls: true }),
    (error: unknown) => error instanceof ConfigurationError && error.code === 'INVALID_BROKER_URL',
  );

  const broker = await createBroker(value, { password: null });
  const oldClient = value.clients[0];
  await value.service.reconnectMqttConnection(broker.id);
  assert.equal(oldClient.ended, true);
  assert.equal(value.clients.length, 2);
  await value.manager.shutdown();
});

test('partial MQTT update schema does not apply create defaults', () => {
  assert.deepEqual(mqttConnectionUpdateSchema.parse({ name: 'Only name' }), { name: 'Only name' });
});

test('ConfigurationService converts MQTT test failures without exposing credentials', async () => {
  const value = fixture(true);
  await assert.rejects(
    value.service.testNewMqttConnection({
      name: 'Failure test',
      brokerUrl: 'mqtt://localhost',
      port: 1,
      useTls: false,
      username: 'user',
      password: 'must-not-leak',
      clientIdPrefix: null,
    }),
    (error: unknown) => error instanceof ConfigurationError
      && error.code === 'MQTT_TEST_FAILED'
      && !error.message.includes('must-not-leak'),
  );
  await value.manager.shutdown();
});
