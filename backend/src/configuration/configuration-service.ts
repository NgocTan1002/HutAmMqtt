import { randomUUID } from 'node:crypto';
import type { MqttConnectionConfig, DeviceConfig } from './configuration-types.js';
import type {
  DeviceRepository,
  MqttConnectionRepository,
} from '../database/repositories.js';
import type { DeviceRegistry } from '../devices/device-registry.js';
import type { RuntimeCoordinator } from '../devices/runtime-coordinator.js';
import type {
  BrokerConnectionState,
  MqttClientConnectionConfig,
  MqttConnectionManager,
} from '../mqtt/mqtt-connection-manager.js';
import { testMqttConnection, type MqttConnectionTester } from '../mqtt/test-mqtt-connection.js';
import type { CredentialCipher } from '../security/credential-cipher.js';
import type { DeviceState } from '../state/device-state.js';
import type {
  DeviceCreateInput,
  DeviceUpdateInput,
  MqttConnectionCreateInput,
  MqttConnectionTestInput,
  MqttConnectionUpdateInput,
} from './configuration-schemas.js';

export type ConfigurationErrorCode =
  | 'NOT_FOUND'
  | 'DUPLICATE_ID'
  | 'BROKER_IN_USE'
  | 'BROKER_DISABLED'
  | 'DEVICE_HAS_DATA'
  | 'TOPIC_CONFLICT'
  | 'INVALID_BROKER_URL'
  | 'ENCRYPTION_NOT_CONFIGURED'
  | 'RUNTIME_SYNC_FAILED'
  | 'MQTT_TEST_FAILED';

export class ConfigurationError extends Error {
  public constructor(
    public readonly code: ConfigurationErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export type PublicMqttConnection = Omit<MqttConnectionConfig, 'encryptedPassword'> & {
  hasPassword: boolean;
  runtime: BrokerConnectionState | null;
};

export type PublicDevice = DeviceConfig & {
  state: DeviceState | null;
};

export type ConfigurationServiceOptions = {
  mqttConnections: MqttConnectionRepository;
  devices: DeviceRepository;
  coordinator: RuntimeCoordinator;
  manager: MqttConnectionManager;
  registry: DeviceRegistry;
  cipher: CredentialCipher | null;
  connectionTester?: MqttConnectionTester;
};

function nullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeBrokerUrl(rawValue: string, useTls: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new ConfigurationError('INVALID_BROKER_URL', 400, 'Địa chỉ MQTT broker không hợp lệ.');
  }
  const expectedProtocol = useTls ? 'mqtts:' : 'mqtt:';
  if (parsed.protocol !== expectedProtocol) {
    throw new ConfigurationError(
      'INVALID_BROKER_URL',
      400,
      useTls ? 'Broker bật TLS phải sử dụng mqtts://.' : 'Broker không dùng TLS phải sử dụng mqtt://.',
    );
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.port
    || (parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new ConfigurationError(
      'INVALID_BROKER_URL',
      400,
      'Broker URL chỉ được chứa protocol và hostname; port và thông tin đăng nhập nhập ở trường riêng.',
    );
  }
  return `${parsed.protocol}//${parsed.hostname}`;
}

export class ConfigurationService {
  private readonly connectionTester: MqttConnectionTester;

  public constructor(private readonly options: ConfigurationServiceOptions) {
    this.connectionTester = options.connectionTester ?? testMqttConnection;
  }

  public async listMqttConnections(): Promise<PublicMqttConnection[]> {
    return Promise.all((await this.options.mqttConnections.getAll()).map((config) => this.toPublicConnection(config)));
  }

  public async getMqttConnection(id: string): Promise<PublicMqttConnection> {
    return this.toPublicConnection(await this.requireConnection(id));
  }

  public async createMqttConnection(input: MqttConnectionCreateInput): Promise<PublicMqttConnection> {
    const config: MqttConnectionConfig = {
      id: randomUUID(),
      name: input.name.trim(),
      brokerUrl: normalizeBrokerUrl(input.brokerUrl, input.useTls),
      port: input.port,
      useTls: input.useTls,
      username: nullableText(input.username),
      encryptedPassword: this.encryptPassword(input.password),
      clientIdPrefix: nullableText(input.clientIdPrefix),
      enabled: input.enabled,
    };
    const created = await this.options.mqttConnections.create(config);
    await this.synchronizeRuntime();
    return this.toPublicConnection(created);
  }

  public async updateMqttConnection(id: string, input: MqttConnectionUpdateInput): Promise<PublicMqttConnection> {
    const existing = await this.requireConnection(id);
    const useTls = input.useTls ?? existing.useTls;
    const updated: MqttConnectionConfig = {
      ...existing,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.port !== undefined ? { port: input.port } : {}),
      ...(input.useTls !== undefined ? { useTls: input.useTls } : {}),
      ...(input.username !== undefined ? { username: nullableText(input.username) } : {}),
      ...(input.clientIdPrefix !== undefined ? { clientIdPrefix: nullableText(input.clientIdPrefix) } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      brokerUrl: normalizeBrokerUrl(input.brokerUrl ?? existing.brokerUrl, useTls),
      encryptedPassword: input.password === undefined
        ? existing.encryptedPassword
        : this.encryptPassword(input.password),
    };
    const result = await this.options.mqttConnections.update(updated);
    if (!result) throw new ConfigurationError('NOT_FOUND', 404, 'Không tìm thấy MQTT broker.');
    await this.synchronizeRuntime();
    return this.toPublicConnection(result);
  }

  public async deleteMqttConnection(id: string): Promise<void> {
    await this.requireConnection(id);
    const deviceCount = await this.options.mqttConnections.countDevices(id);
    if (deviceCount > 0) {
      throw new ConfigurationError(
        'BROKER_IN_USE',
        409,
        'Không thể xóa broker đang có thiết bị phụ thuộc.',
        { deviceCount },
      );
    }
    await this.options.mqttConnections.delete(id);
    await this.synchronizeRuntime();
  }

  public async testNewMqttConnection(input: MqttConnectionTestInput): Promise<{ success: true; durationMs: number }> {
    return this.runConnectionTest({
      id: 'temporary-test',
      name: input.name,
      brokerUrl: normalizeBrokerUrl(input.brokerUrl, input.useTls),
      port: input.port,
      useTls: input.useTls,
      username: nullableText(input.username),
      password: nullableText(input.password),
      clientIdPrefix: nullableText(input.clientIdPrefix),
      enabled: true,
    });
  }

  public async testStoredMqttConnection(id: string): Promise<{ success: true; durationMs: number }> {
    const config = await this.requireConnection(id);
    return this.runConnectionTest(this.toClientConfig(config));
  }

  public async reconnectMqttConnection(id: string): Promise<PublicMqttConnection> {
    const config = await this.requireConnection(id);
    if (!config.enabled) {
      throw new ConfigurationError('BROKER_DISABLED', 409, 'Broker đang bị tắt, không thể reconnect.');
    }
    await this.options.manager.reconnect(id);
    return this.toPublicConnection(config);
  }

  public async listDevices(): Promise<PublicDevice[]> {
    return (await this.options.devices.getAll()).map((config) => this.toPublicDevice(config));
  }

  public async getDevice(id: string): Promise<PublicDevice> {
    return this.toPublicDevice(await this.requireDevice(id));
  }

  public async createDevice(input: DeviceCreateInput): Promise<PublicDevice> {
    if (await this.options.devices.getById(input.id)) {
      throw new ConfigurationError('DUPLICATE_ID', 409, 'ID thiết bị đã tồn tại.');
    }
    const config: DeviceConfig = { ...input };
    await this.validateDevice(config);
    const created = await this.options.devices.create(config);
    await this.synchronizeRuntime();
    return this.toPublicDevice(created);
  }

  public async updateDevice(id: string, input: DeviceUpdateInput): Promise<PublicDevice> {
    const existing = await this.requireDevice(id);
    const updated: DeviceConfig = { ...existing, ...input, id };
    await this.validateDevice(updated, id);
    const result = await this.options.devices.update(updated);
    if (!result) throw new ConfigurationError('NOT_FOUND', 404, 'Không tìm thấy thiết bị.');
    await this.synchronizeRuntime();
    return this.toPublicDevice(result);
  }

  public async deleteDevice(id: string): Promise<void> {
    await this.requireDevice(id);
    const usage = await this.options.devices.getDataUsage(id);
    if (usage.total > 0) {
      throw new ConfigurationError(
        'DEVICE_HAS_DATA',
        409,
        'Thiết bị đã có dữ liệu lịch sử; hãy tắt thiết bị thay vì xóa.',
        usage,
      );
    }
    await this.options.devices.delete(id);
    await this.synchronizeRuntime();
  }

  private async validateDevice(candidate: DeviceConfig, excludedDeviceId?: string): Promise<void> {
    const broker = await this.options.mqttConnections.getById(candidate.mqttConnectionId);
    if (!broker) throw new ConfigurationError('NOT_FOUND', 404, 'Không tìm thấy MQTT broker của thiết bị.');
    if (candidate.enabled && !broker.enabled) {
      throw new ConfigurationError('BROKER_DISABLED', 409, 'Không thể bật thiết bị khi MQTT broker đang bị tắt.');
    }
    if (!candidate.enabled) return;

    const candidateTopics = new Set([
      candidate.telemetryTopic,
      candidate.commandTopic,
      candidate.responseTopic,
    ]);
    for (const existing of await this.options.devices.getAll()) {
      if (existing.id === excludedDeviceId || !existing.enabled
        || existing.mqttConnectionId !== candidate.mqttConnectionId) continue;
      const conflictingTopic = [
        existing.telemetryTopic,
        existing.commandTopic,
        existing.responseTopic,
      ].find((topic) => candidateTopics.has(topic));
      if (conflictingTopic) {
        throw new ConfigurationError(
          'TOPIC_CONFLICT',
          409,
          `Topic ${conflictingTopic} đang được thiết bị ${existing.id} sử dụng trên cùng broker.`,
          { topic: conflictingTopic, deviceId: existing.id },
        );
      }
    }
  }

  private encryptPassword(password: string | null | undefined): string | null {
    const normalized = nullableText(password);
    if (!normalized) return null;
    if (!this.options.cipher) {
      throw new ConfigurationError(
        'ENCRYPTION_NOT_CONFIGURED',
        503,
        'Backend chưa được cấu hình khóa mã hóa credential.',
      );
    }
    return this.options.cipher.encrypt(normalized);
  }

  private decryptPassword(encryptedPassword: string | null): string | null {
    if (!encryptedPassword) return null;
    if (!this.options.cipher) {
      throw new ConfigurationError(
        'ENCRYPTION_NOT_CONFIGURED',
        503,
        'Backend chưa được cấu hình khóa mã hóa credential.',
      );
    }
    return this.options.cipher.decrypt(encryptedPassword);
  }

  private toClientConfig(config: MqttConnectionConfig): MqttClientConnectionConfig {
    const { encryptedPassword, ...rest } = config;
    return { ...rest, password: this.decryptPassword(encryptedPassword) };
  }

  private toPublicConnection(config: MqttConnectionConfig): PublicMqttConnection {
    const { encryptedPassword, ...safe } = config;
    return {
      ...safe,
      hasPassword: Boolean(encryptedPassword),
      runtime: this.options.manager.getState(config.id) ?? null,
    };
  }

  private toPublicDevice(config: DeviceConfig): PublicDevice {
    return { ...config, state: this.options.registry.get(config.id)?.getState() ?? null };
  }

  private async requireConnection(id: string): Promise<MqttConnectionConfig> {
    const config = await this.options.mqttConnections.getById(id);
    if (!config) throw new ConfigurationError('NOT_FOUND', 404, 'Không tìm thấy MQTT broker.');
    return config;
  }

  private async requireDevice(id: string): Promise<DeviceConfig> {
    const config = await this.options.devices.getById(id);
    if (!config) throw new ConfigurationError('NOT_FOUND', 404, 'Không tìm thấy thiết bị.');
    return config;
  }

  private async synchronizeRuntime(): Promise<void> {
    try {
      await this.options.coordinator.refresh();
    } catch (error) {
      throw new ConfigurationError(
        'RUNTIME_SYNC_FAILED',
        503,
        'Cấu hình đã lưu nhưng runtime chưa đồng bộ; backend sẽ tự thử lại.',
        { persisted: true, cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private async runConnectionTest(config: MqttClientConnectionConfig): Promise<{ success: true; durationMs: number }> {
    try {
      return await this.connectionTester(config);
    } catch {
      throw new ConfigurationError(
        'MQTT_TEST_FAILED',
        422,
        'Không thể kết nối MQTT. Kiểm tra địa chỉ, port, TLS và thông tin đăng nhập.',
      );
    }
  }
}
