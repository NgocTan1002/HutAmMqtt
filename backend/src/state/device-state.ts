import type { Telemetry } from '../mqtt/telemetry-schema.js';

export type MqttConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';
export type DeviceConnectionStatus = 'ONLINE' | 'OFFLINE';

export type DeviceState = {
  connectionStatus: DeviceConnectionStatus;
  deviceId: string;
  lastSeenAt: string | null;
  mqttStatus: MqttConnectionStatus;
  telemetry: Telemetry | null;
};

export class DeviceStateStore {
  private lastSeenAt: Date | null = null;
  private mqttStatus: MqttConnectionStatus = 'connecting';
  private telemetry: Telemetry | null = null;

  public constructor(
    private readonly deviceId: string,
    private offlineAfterSeconds: number,
  ) {}

  public getState(now = new Date()): DeviceState {
    return {
      deviceId: this.deviceId,
      mqttStatus: this.mqttStatus,
      connectionStatus: this.isOnline(now) ? 'ONLINE' : 'OFFLINE',
      lastSeenAt: this.lastSeenAt?.toISOString() ?? null,
      telemetry: this.telemetry,
    };
  }

  public setMqttStatus(status: MqttConnectionStatus): void {
    this.mqttStatus = status;
  }

  public setOfflineAfterSeconds(seconds: number): void {
    if (!Number.isInteger(seconds) || seconds <= 0) {
      throw new Error('offlineAfterSeconds must be a positive integer.');
    }
    this.offlineAfterSeconds = seconds;
  }

  public updateTelemetry(telemetry: Telemetry): DeviceState {
    this.telemetry = telemetry;
    this.lastSeenAt = new Date(telemetry.receivedAt);
    return this.getState(this.lastSeenAt);
  }

  private isOnline(now: Date): boolean {
    if (!this.lastSeenAt) {
      return false;
    }

    return now.getTime() - this.lastSeenAt.getTime() <= this.offlineAfterSeconds * 1000;
  }
}
