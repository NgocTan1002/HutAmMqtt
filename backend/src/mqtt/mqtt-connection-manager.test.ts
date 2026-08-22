import assert from 'node:assert/strict';
import test from 'node:test';
import type { MqttConnectionConfig } from '../configuration/configuration-types.js';
import {
  MqttConnectionManager,
  type ManagedMqttClient,
  type MqttConnectionEvents,
} from './mqtt-connection-manager.js';

function config(id: string, overrides: Partial<MqttConnectionConfig> = {}): MqttConnectionConfig {
  return {
    id,
    name: `Broker ${id}`,
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

class FakeClient implements ManagedMqttClient {
  public connected = false;
  public readonly subscribed: string[][] = [];
  public readonly unsubscribed: string[][] = [];
  public readonly published: Array<{ topic: string; payload: string }> = [];
  public ended = false;

  public constructor(public readonly events: MqttConnectionEvents) {}

  public async subscribe(topics: string[]): Promise<void> {
    this.subscribed.push([...topics]);
  }

  public async unsubscribe(topics: string[]): Promise<void> {
    this.unsubscribed.push([...topics]);
  }

  public async publish(topic: string, payload: string): Promise<void> {
    this.published.push({ topic, payload });
  }

  public async end(): Promise<void> {
    this.connected = false;
    this.ended = true;
    this.events.onClose();
  }

  public async connect(): Promise<void> {
    this.connected = true;
    this.events.onConnect();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function fixture() {
  const clients = new Map<string, FakeClient[]>();
  const messages: Array<{ connectionId: string; topic: string; payload: string }> = [];
  const manager = new MqttConnectionManager({
    createClient(connection, events) {
      const client = new FakeClient(events);
      clients.set(connection.id, [...(clients.get(connection.id) ?? []), client]);
      return client;
    },
    onMessage(connectionId, topic, payload) {
      messages.push({ connectionId, topic, payload: payload.toString() });
    },
  });
  return { manager, clients, messages };
}

test('MqttConnectionManager connects two brokers and keeps their messages isolated', async () => {
  const value = fixture();
  await value.manager.syncConnections([config('a'), config('b')]);
  const clientA = value.clients.get('a')![0];
  const clientB = value.clients.get('b')![0];
  await clientA.connect();
  await clientB.connect();

  clientA.events.onMessage('mayhutam1/nhan', Buffer.from('A'));
  clientB.events.onMessage('mayhutam1/nhan', Buffer.from('B'));

  assert.deepEqual(value.messages, [
    { connectionId: 'a', topic: 'mayhutam1/nhan', payload: 'A' },
    { connectionId: 'b', topic: 'mayhutam1/nhan', payload: 'B' },
  ]);
  assert.equal(value.manager.getState('a')?.status, 'connected');
  assert.equal(value.manager.getState('b')?.status, 'connected');
  await value.manager.shutdown();
});

test('MqttConnectionManager subscribes and publishes on the selected broker only', async () => {
  const value = fixture();
  await value.manager.syncConnections([config('a'), config('b')]);
  await value.manager.setSubscriptions('a', ['mayhutam1/nhan']);
  await value.manager.setSubscriptions('b', ['mayhutam2/nhan']);
  const clientA = value.clients.get('a')![0];
  const clientB = value.clients.get('b')![0];
  await clientA.connect();
  await clientB.connect();
  await value.manager.publish('b', 'mayhutam2/caidat', 'SET');

  assert.deepEqual(clientA.subscribed.at(-1), ['mayhutam1/nhan']);
  assert.deepEqual(clientB.subscribed.at(-1), ['mayhutam2/nhan']);
  assert.deepEqual(clientA.published, []);
  assert.deepEqual(clientB.published, [{ topic: 'mayhutam2/caidat', payload: 'SET' }]);
  await value.manager.shutdown();
});

test('MqttConnectionManager reconnects only a changed configuration and preserves subscriptions', async () => {
  const value = fixture();
  await value.manager.syncConnections([config('a'), config('b')]);
  await value.manager.setSubscriptions('a', ['a/nhan']);
  const oldA = value.clients.get('a')![0];
  const oldB = value.clients.get('b')![0];

  await value.manager.syncConnections([config('a', { port: 1884 }), config('b')]);
  const newA = value.clients.get('a')![1];
  await newA.connect();

  assert.equal(oldA.ended, true);
  assert.equal(oldB.ended, false);
  assert.deepEqual(newA.subscribed.at(-1), ['a/nhan']);
  await value.manager.shutdown();
});

test('an error or removal on one broker does not stop another broker', async () => {
  const value = fixture();
  await value.manager.syncConnections([config('a'), config('b')]);
  const clientA = value.clients.get('a')![0];
  const clientB = value.clients.get('b')![0];
  await clientA.connect();
  await clientB.connect();
  clientA.events.onError(new Error('connection refused'));

  assert.equal(value.manager.getState('a')?.status, 'error');
  assert.equal(value.manager.getState('b')?.status, 'connected');

  await value.manager.syncConnections([config('b')]);
  assert.equal(clientA.ended, true);
  assert.equal(clientB.ended, false);
  assert.equal(value.manager.getState('a'), undefined);
  await value.manager.shutdown();
});

test('MqttConnectionManager decrypts a stored password only when creating its client', async () => {
  let receivedPassword: string | null | undefined;
  let decryptCalls = 0;
  const manager = new MqttConnectionManager({
    decryptPassword(encryptedPassword) {
      decryptCalls += 1;
      assert.equal(encryptedPassword, 'enc:v1:test');
      return 'runtime-password';
    },
    createClient(connection, events) {
      receivedPassword = connection.password;
      return new FakeClient(events);
    },
    onMessage() {},
  });

  await manager.syncConnections([config('secured', { encryptedPassword: 'enc:v1:test' })]);

  assert.equal(decryptCalls, 1);
  assert.equal(receivedPassword, 'runtime-password');
  assert.equal(JSON.stringify(manager.getStates()).includes('runtime-password'), false);
  assert.equal(JSON.stringify(manager.getStates()).includes('enc:v1:test'), false);
  await manager.shutdown();
});
