import type { CommandRecord } from '../commands/command-service.js';
import type { DeviceConfig, MqttConnectionConfig } from '../configuration/configuration-types.js';
import type { EventRecord } from '../events/event-service.js';
import type { Telemetry } from '../mqtt/telemetry-schema.js';
import type { TelemetryHistoryPoint } from './database-types.js';

export interface TelemetryRepository {
  save(telemetry: Telemetry): Promise<void>;
  getRange(deviceId: string, hours: number, maxPoints?: number): Promise<TelemetryHistoryPoint[]>;
  getExportRange(deviceId: string, from: string, to: string, limit: number): Promise<TelemetryHistoryPoint[]>;
}

export interface CommandRepository {
  save(command: CommandRecord): Promise<void>;
  getHistory(deviceId: string, limit: number): Promise<CommandRecord[]>;
  getRange(deviceId: string, from: string, to: string, limit: number): Promise<CommandRecord[]>;
}

export interface EventRepository {
  save(event: EventRecord): Promise<void>;
  getHistory(deviceId: string, limit: number): Promise<EventRecord[]>;
  getRange(deviceId: string, from: string, to: string, limit: number): Promise<EventRecord[]>;
}

export interface MqttConnectionRepository {
  getAll(): Promise<MqttConnectionConfig[]>;
  getEnabled(): Promise<MqttConnectionConfig[]>;
  getById(id: string): Promise<MqttConnectionConfig | null>;
  create(config: MqttConnectionConfig): Promise<MqttConnectionConfig>;
  update(config: MqttConnectionConfig): Promise<MqttConnectionConfig | null>;
  delete(id: string): Promise<boolean>;
  countDevices(id: string): Promise<number>;
}

export type DeviceDataUsage = {
  telemetry: number;
  commands: number;
  events: number;
  total: number;
};

export interface DeviceRepository {
  getAll(): Promise<DeviceConfig[]>;
  getEnabled(): Promise<DeviceConfig[]>;
  getById(id: string): Promise<DeviceConfig | null>;
  create(config: DeviceConfig): Promise<DeviceConfig>;
  update(config: DeviceConfig): Promise<DeviceConfig | null>;
  delete(id: string): Promise<boolean>;
  getDataUsage(id: string): Promise<DeviceDataUsage>;
}

export type Repositories = {
  telemetry: TelemetryRepository;
  commands: CommandRepository;
  events: EventRepository;
  mqttConnections: MqttConnectionRepository;
  devices: DeviceRepository;
  checkHealth(): Promise<boolean>;
  close(): Promise<void>;
};
