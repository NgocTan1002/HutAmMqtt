import type { DeviceConfig } from '../configuration/configuration-types.js';
import type { MqttConnectionStatus, DeviceState } from '../state/device-state.js';
import { DeviceRuntime } from './device-runtime.js';

export type DeviceRuntimeFactory = (config: DeviceConfig) => DeviceRuntime;

export class DuplicateDeviceRuntimeError extends Error {
  public constructor(public readonly deviceId: string) {
    super(`Device runtime already exists: ${deviceId}`);
    this.name = 'DuplicateDeviceRuntimeError';
  }
}

export class DeviceRegistry {
  private readonly runtimes = new Map<string, DeviceRuntime>();

  public constructor(private readonly createRuntime: DeviceRuntimeFactory) {}

  public get size(): number {
    return this.runtimes.size;
  }

  public register(config: DeviceConfig): DeviceRuntime {
    if (!config.enabled) throw new Error(`Cannot register disabled device ${config.id}.`);
    if (this.runtimes.has(config.id)) throw new DuplicateDeviceRuntimeError(config.id);
    const runtime = this.createRuntime({ ...config });
    this.runtimes.set(config.id, runtime);
    return runtime;
  }

  public apply(config: DeviceConfig): DeviceRuntime | null {
    const existing = this.runtimes.get(config.id);
    if (!config.enabled) {
      this.remove(config.id, 'Thiết bị đã bị vô hiệu hóa.');
      return null;
    }
    if (existing) {
      existing.updateConfig(config);
      return existing;
    }
    return this.register(config);
  }

  public get(deviceId: string): DeviceRuntime | undefined {
    return this.runtimes.get(deviceId);
  }

  public getAll(): DeviceRuntime[] {
    return [...this.runtimes.values()].sort((left, right) =>
      left.getConfig().id.localeCompare(right.getConfig().id));
  }

  public getByConnectionId(connectionId: string): DeviceRuntime[] {
    return this.getAll().filter((runtime) => runtime.getConfig().mqttConnectionId === connectionId);
  }

  public getAllStates(now = new Date()): DeviceState[] {
    return this.getAll().map((runtime) => runtime.getState(now));
  }

  public setMqttStatus(connectionId: string, status: MqttConnectionStatus): void {
    for (const runtime of this.getByConnectionId(connectionId)) runtime.setMqttStatus(status);
  }

  public tickAll(now = new Date()): void {
    for (const runtime of this.runtimes.values()) runtime.tick(now);
  }

  public remove(deviceId: string, reason = 'Thiết bị đã bị xóa khỏi runtime.'): boolean {
    const runtime = this.runtimes.get(deviceId);
    if (!runtime) return false;
    runtime.shutdown(reason);
    this.runtimes.delete(deviceId);
    return true;
  }

  public shutdownAll(reason = 'Backend đang dừng.'): void {
    for (const runtime of this.runtimes.values()) runtime.shutdown(reason);
    this.runtimes.clear();
  }
}
