import type { CommandRecord } from '../commands/command-service.js';
import type { EventRecord } from '../events/event-service.js';
import type { Telemetry } from '../mqtt/telemetry-schema.js';
import type { TelemetryHistoryPoint } from './database-types.js';

export interface TelemetryRepository {
  save(telemetry: Telemetry): Promise<void>;
  getRange(deviceId: string, hours: number, maxPoints?: number): Promise<TelemetryHistoryPoint[]>;
}

export interface CommandRepository {
  save(command: CommandRecord): Promise<void>;
  getHistory(deviceId: string, limit: number): Promise<CommandRecord[]>;
}

export interface EventRepository {
  save(event: EventRecord): Promise<void>;
  getHistory(deviceId: string, limit: number): Promise<EventRecord[]>;
}

export type Repositories = {
  telemetry: TelemetryRepository;
  commands: CommandRepository;
  events: EventRepository;
  checkHealth(): Promise<boolean>;
  close(): Promise<void>;
};
