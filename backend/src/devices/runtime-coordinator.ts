import type { DeviceConfig, MqttConnectionConfig } from '../configuration/configuration-types.js';
import type { DeviceRepository, MqttConnectionRepository } from '../database/repositories.js';
import { MqttConnectionManager } from '../mqtt/mqtt-connection-manager.js';
import { TopicRouter } from '../mqtt/topic-router.js';
import { DeviceRegistry } from './device-registry.js';

export type RuntimeConfigurationSnapshot = {
  connections: MqttConnectionConfig[];
  devices: DeviceConfig[];
  skippedDevices: DeviceConfig[];
  synchronizedAt: string;
};

export type RuntimeCoordinatorOptions = {
  mqttConnections: Pick<MqttConnectionRepository, 'getEnabled'>;
  devices: Pick<DeviceRepository, 'getEnabled'>;
  manager: MqttConnectionManager;
  registry: DeviceRegistry;
  router: TopicRouter;
  onSkippedDevice?(device: DeviceConfig, reason: string): void;
};

export class RuntimeCoordinator {
  private refreshInProgress: Promise<RuntimeConfigurationSnapshot> | null = null;
  private lastSnapshot: RuntimeConfigurationSnapshot | null = null;

  public constructor(private readonly options: RuntimeCoordinatorOptions) {}

  public getSnapshot(): RuntimeConfigurationSnapshot | null {
    if (!this.lastSnapshot) return null;
    return {
      connections: this.lastSnapshot.connections.map((value) => ({ ...value })),
      devices: this.lastSnapshot.devices.map((value) => ({ ...value })),
      skippedDevices: this.lastSnapshot.skippedDevices.map((value) => ({ ...value })),
      synchronizedAt: this.lastSnapshot.synchronizedAt,
    };
  }

  public refresh(): Promise<RuntimeConfigurationSnapshot> {
    if (this.refreshInProgress) return this.refreshInProgress;
    this.refreshInProgress = this.performRefresh().finally(() => {
      this.refreshInProgress = null;
    });
    return this.refreshInProgress;
  }

  private async performRefresh(): Promise<RuntimeConfigurationSnapshot> {
    const [connections, devices] = await Promise.all([
      this.options.mqttConnections.getEnabled(),
      this.options.devices.getEnabled(),
    ]);
    const connectionIds = new Set(connections.map((connection) => connection.id));
    const activeDevices: DeviceConfig[] = [];
    const skippedDevices: DeviceConfig[] = [];

    for (const device of devices) {
      if (!connectionIds.has(device.mqttConnectionId)) {
        skippedDevices.push(device);
        this.options.onSkippedDevice?.(
          device,
          `MQTT connection is disabled or missing: ${device.mqttConnectionId}`,
        );
      } else {
        activeDevices.push(device);
      }
    }

    // Validate the complete target routing table before mutating live routes.
    const validator = new TopicRouter({
      onTelemetry() {},
      onDeviceResponse() {},
    });
    for (const device of activeDevices) validator.registerDevice(device);

    await this.options.manager.syncConnections(connections);

    const desiredDeviceIds = new Set(activeDevices.map((device) => device.id));
    for (const runtime of this.options.registry.getAll()) {
      const deviceId = runtime.getConfig().id;
      if (desiredDeviceIds.has(deviceId)) continue;
      this.options.router.unregisterDevice(deviceId);
      this.options.registry.remove(deviceId, 'Thiết bị không còn được bật trong cấu hình.');
    }

    for (const device of activeDevices) {
      const existing = this.options.registry.get(device.id);
      if (existing?.getPendingCommand()) {
        const previous = existing.getConfig();
        const routingChanged = previous.mqttConnectionId !== device.mqttConnectionId
          || previous.telemetryTopic !== device.telemetryTopic
          || previous.commandTopic !== device.commandTopic
          || previous.responseTopic !== device.responseTopic;
        if (routingChanged) {
          this.options.router.unregisterDevice(device.id);
          this.options.registry.remove(
            device.id,
            'Cấu hình định tuyến thiết bị đã thay đổi khi lệnh đang chờ.',
          );
        }
      }
      this.options.registry.apply(device);
      this.options.router.registerDevice(device);
    }

    for (const connection of connections) {
      await this.options.manager.setSubscriptions(
        connection.id,
        this.options.router.getSubscriptions(connection.id),
      );
      const brokerState = this.options.manager.getState(connection.id);
      if (brokerState) this.options.registry.setMqttStatus(connection.id, brokerState.status);
    }

    const snapshot: RuntimeConfigurationSnapshot = {
      connections: connections.map((value) => ({ ...value })),
      devices: activeDevices.map((value) => ({ ...value })),
      skippedDevices: skippedDevices.map((value) => ({ ...value })),
      synchronizedAt: new Date().toISOString(),
    };
    this.lastSnapshot = snapshot;
    return this.getSnapshot()!;
  }
}
