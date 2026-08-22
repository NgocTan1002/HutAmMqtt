import type { CommandRecord, DeviceSettings } from '../commands/command-service.js';
import { CommandService } from '../commands/command-service.js';
import type { DeviceConfig } from '../configuration/configuration-types.js';
import { EventService, type EventRecord } from '../events/event-service.js';
import type { Telemetry } from '../mqtt/telemetry-schema.js';
import { DeviceStateStore, type DeviceState, type MqttConnectionStatus } from '../state/device-state.js';

export type DeviceRuntimeMessage<T> = {
  connectionId: string;
  deviceId: string;
  value: T;
};

export type PublishDeviceCommand = {
  connectionId: string;
  deviceId: string;
  topic: string;
  payload: string;
};

export type DeviceRuntimeOptions = {
  config: DeviceConfig;
  publish(command: PublishDeviceCommand): Promise<void>;
  onTelemetry?(message: DeviceRuntimeMessage<Telemetry>): void;
  onStateChanged?(message: DeviceRuntimeMessage<DeviceState>): void;
  onCommandUpdate?(message: DeviceRuntimeMessage<CommandRecord>): void;
  onEvent?(message: DeviceRuntimeMessage<EventRecord>): void;
  commandTimeoutMs?: number;
};

export class DeviceRuntime {
  private config: DeviceConfig;
  private readonly stateStore: DeviceStateStore;
  private readonly commandService: CommandService;
  private readonly eventService: EventService;
  private stopped = false;

  public constructor(private readonly options: DeviceRuntimeOptions) {
    if (!options.config.enabled) throw new Error(`Cannot create runtime for disabled device ${options.config.id}.`);
    this.config = { ...options.config };
    this.stateStore = new DeviceStateStore(this.config.id, this.config.offlineAfterSeconds);
    this.commandService = new CommandService({
      deviceId: this.config.id,
      publish: (payload) => this.options.publish({
        connectionId: this.config.mqttConnectionId,
        deviceId: this.config.id,
        topic: this.config.commandTopic,
        payload,
      }),
      onUpdate: (command) => this.options.onCommandUpdate?.(this.message(command)),
      timeoutMs: options.commandTimeoutMs,
    });
    this.eventService = new EventService(
      this.config.id,
      (event) => this.options.onEvent?.(this.message(event)),
    );
  }

  public getConfig(): DeviceConfig {
    return { ...this.config };
  }

  public getState(now = new Date()): DeviceState {
    return this.stateStore.getState(now);
  }

  public getPendingCommand(): CommandRecord | null {
    return this.commandService.getPending();
  }

  public isStopped(): boolean {
    return this.stopped;
  }

  public handleTelemetry(telemetry: Telemetry): DeviceState {
    this.assertActive();
    if (telemetry.deviceId !== this.config.id) {
      throw new Error(`Telemetry for ${telemetry.deviceId} cannot be handled by runtime ${this.config.id}.`);
    }

    this.options.onTelemetry?.(this.message(telemetry));
    const state = this.stateStore.updateTelemetry(telemetry);
    this.eventService.handleState(state);
    this.commandService.handleTelemetry(telemetry);
    this.options.onStateChanged?.(this.message(state));
    return state;
  }

  public handleDeviceResponse(response: string): void {
    this.assertActive();
    this.commandService.handleDeviceResponse(response);
  }

  public async sendSettings(settings: DeviceSettings): Promise<CommandRecord> {
    this.assertActive();
    if (this.stateStore.getState().connectionStatus !== 'ONLINE') {
      throw new Error('Thiết bị đang ngoại tuyến, không thể gửi lệnh.');
    }
    return this.commandService.sendSettings(settings);
  }

  public setMqttStatus(status: MqttConnectionStatus): DeviceState {
    this.assertActive();
    this.stateStore.setMqttStatus(status);
    const state = this.stateStore.getState();
    this.options.onStateChanged?.(this.message(state));
    return state;
  }

  public tick(now = new Date()): DeviceState {
    this.assertActive();
    const state = this.stateStore.getState(now);
    this.eventService.handleState(state);
    this.options.onStateChanged?.(this.message(state));
    return state;
  }

  public updateConfig(config: DeviceConfig): void {
    this.assertActive();
    if (config.id !== this.config.id) throw new Error('A device runtime cannot change its device ID.');
    if (!config.enabled) throw new Error(`Disabled device ${config.id} must be removed from the registry.`);

    const routingChanged = config.mqttConnectionId !== this.config.mqttConnectionId
      || config.commandTopic !== this.config.commandTopic
      || config.telemetryTopic !== this.config.telemetryTopic
      || config.responseTopic !== this.config.responseTopic;
    if (routingChanged && this.commandService.getPending()) {
      throw new Error(`Cannot change MQTT routing while device ${config.id} has a pending command.`);
    }

    this.config = { ...config };
    this.stateStore.setOfflineAfterSeconds(config.offlineAfterSeconds);
  }

  public shutdown(reason = 'Runtime của thiết bị đã dừng.'): void {
    if (this.stopped) return;
    this.stopped = true;
    this.commandService.shutdown(reason);
  }

  private message<T>(value: T): DeviceRuntimeMessage<T> {
    return {
      connectionId: this.config.mqttConnectionId,
      deviceId: this.config.id,
      value,
    };
  }

  private assertActive(): void {
    if (this.stopped) throw new Error(`Device runtime ${this.config.id} has stopped.`);
  }
}
