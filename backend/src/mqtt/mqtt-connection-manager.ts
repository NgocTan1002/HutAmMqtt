import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import type { MqttConnectionConfig } from '../configuration/configuration-types.js';
import type { MqttConnectionStatus } from '../state/device-state.js';

export type BrokerConnectionState = {
  connectionId: string;
  name: string;
  status: MqttConnectionStatus;
  connected: boolean;
  subscriptions: string[];
  lastChangedAt: string;
  error?: string;
};

export type MqttConnectionEvents = {
  onConnect(): void;
  onReconnect(): void;
  onOffline(): void;
  onClose(): void;
  onError(error: Error): void;
  onMessage(topic: string, payload: Buffer): void;
};

export interface ManagedMqttClient {
  readonly connected: boolean;
  subscribe(topics: string[]): Promise<void>;
  unsubscribe(topics: string[]): Promise<void>;
  publish(topic: string, payload: string): Promise<void>;
  end(force: boolean): Promise<void>;
}

export type MqttClientConnectionConfig = Omit<MqttConnectionConfig, 'encryptedPassword'> & {
  password: string | null;
};

export type MqttClientFactory = (
  config: MqttClientConnectionConfig,
  events: MqttConnectionEvents,
) => ManagedMqttClient;

export type MqttConnectionManagerOptions = {
  createClient?: MqttClientFactory;
  decryptPassword?(encryptedPassword: string): string;
  onMessage(connectionId: string, topic: string, payload: Buffer): void;
  onStatusChanged?(state: BrokerConnectionState): void;
};

type ConnectionEntry = {
  config: MqttConnectionConfig;
  client: ManagedMqttClient;
  desiredSubscriptions: Set<string>;
  activeSubscriptions: Set<string>;
  generation: number;
};

function sameConfig(left: MqttConnectionConfig, right: MqttConnectionConfig): boolean {
  return left.id === right.id
    && left.name === right.name
    && left.brokerUrl === right.brokerUrl
    && left.port === right.port
    && left.useTls === right.useTls
    && left.username === right.username
    && left.encryptedPassword === right.encryptedPassword
    && left.clientIdPrefix === right.clientIdPrefix
    && left.enabled === right.enabled;
}

export function buildMqttBrokerAddress(config: MqttClientConnectionConfig): string {
  const address = new URL(config.brokerUrl);
  if (!['mqtt:', 'mqtts:'].includes(address.protocol)) {
    throw new Error(`Broker ${config.id} must use mqtt:// or mqtts://.`);
  }
  address.protocol = config.useTls ? 'mqtts:' : 'mqtt:';
  address.port = String(config.port);
  return address.toString();
}

function callbackPromise(
  operation: (callback: (error?: Error | null) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    operation((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function defaultClientFactory(config: MqttClientConnectionConfig, events: MqttConnectionEvents): ManagedMqttClient {
  const options: IClientOptions = {
    clean: true,
    clientId: `${config.clientIdPrefix || 'nhiet-am-dashboard'}-${config.id}-${process.pid}`,
    connectTimeout: 30_000,
    reconnectPeriod: 5_000,
  };
  if (config.username) options.username = config.username;
  if (config.password) options.password = config.password;

  const client: MqttClient = mqtt.connect(buildMqttBrokerAddress(config), options);
  client.on('connect', events.onConnect);
  client.on('reconnect', events.onReconnect);
  client.on('offline', events.onOffline);
  client.on('close', events.onClose);
  client.on('error', events.onError);
  client.on('message', events.onMessage);

  return {
    get connected() {
      return client.connected;
    },
    subscribe(topics) {
      if (topics.length === 0) return Promise.resolve();
      return callbackPromise((callback) => client.subscribe(topics, { qos: 0 }, callback));
    },
    unsubscribe(topics) {
      if (topics.length === 0) return Promise.resolve();
      return callbackPromise((callback) => client.unsubscribe(topics, callback));
    },
    publish(topic, payload) {
      return callbackPromise((callback) => client.publish(topic, payload, { qos: 0 }, callback));
    },
    end(force) {
      return callbackPromise((callback) => client.end(force, {}, callback));
    },
  };
}

export class MqttConnectionManager {
  private readonly connections = new Map<string, ConnectionEntry>();
  private readonly states = new Map<string, BrokerConnectionState>();
  private readonly generations = new Map<string, number>();
  private readonly createClient: MqttClientFactory;
  private stopped = false;

  public constructor(private readonly options: MqttConnectionManagerOptions) {
    this.createClient = options.createClient ?? defaultClientFactory;
  }

  public getStates(): BrokerConnectionState[] {
    return [...this.states.values()]
      .map((state) => ({ ...state, subscriptions: [...state.subscriptions] }))
      .sort((left, right) => left.connectionId.localeCompare(right.connectionId));
  }

  public getState(connectionId: string): BrokerConnectionState | undefined {
    const state = this.states.get(connectionId);
    return state ? { ...state, subscriptions: [...state.subscriptions] } : undefined;
  }

  public async syncConnections(configs: MqttConnectionConfig[]): Promise<void> {
    this.assertActive();
    const enabled = configs.filter((config) => config.enabled);
    const desired = new Map<string, MqttConnectionConfig>();
    for (const config of enabled) {
      if (desired.has(config.id)) throw new Error(`Duplicate MQTT connection configuration: ${config.id}`);
      desired.set(config.id, { ...config });
    }

    for (const connectionId of [...this.connections.keys()]) {
      if (!desired.has(connectionId)) await this.removeConnection(connectionId);
    }

    for (const config of desired.values()) {
      const existing = this.connections.get(config.id);
      if (!existing) this.startConnection(config);
      else if (!sameConfig(existing.config, config)) {
        const subscriptions = [...existing.desiredSubscriptions];
        await this.removeConnection(config.id);
        this.startConnection(config, subscriptions);
      }
    }
  }

  public async setSubscriptions(connectionId: string, topics: string[]): Promise<void> {
    this.assertActive();
    const entry = this.connections.get(connectionId);
    if (!entry) throw new Error(`MQTT connection is not active: ${connectionId}`);
    const desired = new Set(topics.map((topic) => topic.trim()).filter(Boolean));
    const changed = desired.size !== entry.desiredSubscriptions.size
      || [...desired].some((topic) => !entry.desiredSubscriptions.has(topic));
    entry.desiredSubscriptions = desired;

    if (!entry.client.connected) {
      if (changed) this.updateSubscriptionsInState(connectionId, desired);
      return;
    }

    const removed = [...entry.activeSubscriptions].filter((topic) => !desired.has(topic));
    const added = [...desired].filter((topic) => !entry.activeSubscriptions.has(topic));
    if (removed.length === 0 && added.length === 0) return;
    if (removed.length > 0) await entry.client.unsubscribe(removed);
    if (added.length > 0) await entry.client.subscribe(added);
    entry.activeSubscriptions = new Set(desired);
    this.updateState(connectionId, entry.generation, 'connected');
  }

  public async publish(connectionId: string, topic: string, payload: string): Promise<void> {
    this.assertActive();
    const entry = this.connections.get(connectionId);
    if (!entry?.client.connected) throw new Error(`MQTT broker chưa kết nối: ${connectionId}`);
    await entry.client.publish(topic, payload);
  }

  public async reconnect(connectionId: string): Promise<void> {
    this.assertActive();
    const entry = this.connections.get(connectionId);
    if (!entry) throw new Error(`MQTT connection is not active: ${connectionId}`);
    const config = { ...entry.config };
    const subscriptions = [...entry.desiredSubscriptions];
    await this.removeConnection(connectionId);
    this.startConnection(config, subscriptions);
  }

  public async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const connectionIds = [...this.connections.keys()];
    await Promise.allSettled(connectionIds.map((connectionId) => this.removeConnection(connectionId)));
    this.states.clear();
  }

  private startConnection(config: MqttConnectionConfig, subscriptions: string[] = []): void {
    const generation = (this.generations.get(config.id) ?? 0) + 1;
    this.generations.set(config.id, generation);
    this.setState(config, 'connecting', subscriptions);

    const events: MqttConnectionEvents = {
      onConnect: () => void this.handleConnect(config.id, generation),
      onReconnect: () => this.updateState(config.id, generation, 'connecting'),
      onOffline: () => this.updateState(config.id, generation, 'disconnected'),
      onClose: () => this.updateState(config.id, generation, 'disconnected'),
      onError: (error) => this.updateState(config.id, generation, 'error', error.message),
      onMessage: (topic, payload) => {
        if (this.isCurrent(config.id, generation)) this.options.onMessage(config.id, topic, payload);
      },
    };

    try {
      const password = config.encryptedPassword
        ? this.decryptPassword(config.encryptedPassword)
        : null;
      const { encryptedPassword: _encryptedPassword, ...publicConfig } = config;
      const client = this.createClient({ ...publicConfig, password }, events);
      this.connections.set(config.id, {
        config: { ...config },
        client,
        desiredSubscriptions: new Set(subscriptions),
        activeSubscriptions: new Set(),
        generation,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateState(config.id, generation, 'error', message);
      throw error;
    }
  }

  private async handleConnect(connectionId: string, generation: number): Promise<void> {
    const entry = this.connections.get(connectionId);
    if (!entry || entry.generation !== generation) return;
    entry.activeSubscriptions.clear();
    try {
      const subscriptions = [...entry.desiredSubscriptions];
      await entry.client.subscribe(subscriptions);
      entry.activeSubscriptions = new Set(subscriptions);
      this.updateState(connectionId, generation, 'connected');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateState(connectionId, generation, 'error', message);
    }
  }

  private async removeConnection(connectionId: string): Promise<void> {
    const entry = this.connections.get(connectionId);
    if (!entry) {
      this.states.delete(connectionId);
      return;
    }
    this.generations.set(connectionId, entry.generation + 1);
    this.connections.delete(connectionId);
    this.states.delete(connectionId);
    try {
      await entry.client.end(true);
    } catch (error) {
      console.error(`Failed to close MQTT connection ${connectionId}:`, error);
    }
  }

  private setState(
    config: MqttConnectionConfig,
    status: MqttConnectionStatus,
    subscriptions: string[],
    error?: string,
  ): void {
    const state: BrokerConnectionState = {
      connectionId: config.id,
      name: config.name,
      status,
      connected: status === 'connected',
      subscriptions: [...subscriptions].sort(),
      lastChangedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    };
    this.states.set(config.id, state);
    this.options.onStatusChanged?.({ ...state, subscriptions: [...state.subscriptions] });
  }

  private updateSubscriptionsInState(connectionId: string, subscriptions: Set<string>): void {
    const previous = this.states.get(connectionId);
    if (!previous) return;
    const state = {
      ...previous,
      subscriptions: [...subscriptions].sort(),
      lastChangedAt: new Date().toISOString(),
    };
    this.states.set(connectionId, state);
    this.options.onStatusChanged?.({ ...state, subscriptions: [...state.subscriptions] });
  }

  private updateState(
    connectionId: string,
    generation: number,
    status: MqttConnectionStatus,
    error?: string,
  ): void {
    if (!this.isCurrent(connectionId, generation)) return;
    const entry = this.connections.get(connectionId);
    const previous = this.states.get(connectionId);
    if (!entry && !previous) return;
    const config = entry?.config;
    const state: BrokerConnectionState = {
      connectionId,
      name: config?.name ?? previous?.name ?? connectionId,
      status,
      connected: status === 'connected',
      subscriptions: [...(entry?.desiredSubscriptions ?? previous?.subscriptions ?? [])].sort(),
      lastChangedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    };
    this.states.set(connectionId, state);
    this.options.onStatusChanged?.({ ...state, subscriptions: [...state.subscriptions] });
  }

  private isCurrent(connectionId: string, generation: number): boolean {
    return this.generations.get(connectionId) === generation;
  }

  private assertActive(): void {
    if (this.stopped) throw new Error('MQTT connection manager has stopped.');
  }

  private decryptPassword(encryptedPassword: string): string {
    if (!this.options.decryptPassword) {
      throw new Error('MQTT password is encrypted but CONFIG_ENCRYPTION_KEY is not configured.');
    }
    return this.options.decryptPassword(encryptedPassword);
  }
}
