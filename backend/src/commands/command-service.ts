import { randomUUID } from 'node:crypto';
import type { Telemetry } from '../mqtt/telemetry-schema.js';

export type CommandStatus = 'pending' | 'success' | 'error' | 'timeout';

export type CommandRecord = {
  id: string;
  deviceId: string;
  mqttPayload: string;
  status: CommandStatus;
  response?: string;
  createdAt: string;
  completedAt?: string;
};

export type DeviceSettings = {
  humiditySetpoint: number;
  temperatureSetpoint: number;
  mode: 'SMART' | 'CONTINUOUS';
};

type CommandServiceOptions = {
  deviceId: string;
  publish: (payload: string) => Promise<void>;
  onUpdate: (command: CommandRecord) => void;
  timeoutMs?: number;
};

export function buildSettingsCommand(settings: DeviceSettings): string {
  const modeCode = settings.mode === 'SMART' ? 0 : 1;
  return `ALL=SH=${settings.humiditySetpoint.toFixed(1)},ST=${settings.temperatureSetpoint.toFixed(1)},MD=${modeCode}\r\n`;
}

export class CommandService {
  private pending: CommandRecord | null = null;
  private timeout: NodeJS.Timeout | null = null;
  private expectedSettings: DeviceSettings | null = null;

  public constructor(private readonly options: CommandServiceOptions) {}

  public getPending(): CommandRecord | null {
    return this.pending;
  }

  public async sendSettings(settings: DeviceSettings): Promise<CommandRecord> {
    if (this.pending) {
      throw new Error('Thiết bị đang có một lệnh chờ phản hồi.');
    }

    const command: CommandRecord = {
      id: randomUUID(),
      deviceId: this.options.deviceId,
      mqttPayload: buildSettingsCommand(settings),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await this.options.publish(command.mqttPayload);
    this.pending = command;
    this.expectedSettings = settings;
    this.options.onUpdate(command);

    this.timeout = setTimeout(() => {
      if (!this.pending || this.pending.id !== command.id) return;
      this.complete('timeout', 'Không nhận được phản hồi từ thiết bị.');
    }, this.options.timeoutMs ?? 10_000);

    return command;
  }

  public handleDeviceResponse(response: string): void {
    if (!this.pending) return;
    if (response.startsWith('Da Nhan')) {
      this.complete('success', response);
      return;
    }
    if (response.startsWith('Loi')) {
      this.complete('error', response);
    }
  }

  public handleTelemetry(telemetry: Telemetry): void {
    if (!this.pending || !this.expectedSettings) return;

    const telemetryTime = new Date(telemetry.receivedAt).getTime();
    const commandTime = new Date(this.pending.createdAt).getTime();

    // A value that was already present before the command is not an acknowledgement.
    if (telemetryTime <= commandTime) return;

    const humidityMatches = Math.abs(
      telemetry.humiditySetpoint - this.expectedSettings.humiditySetpoint,
    ) < 0.05;
    const temperatureMatches = Math.abs(
      telemetry.temperatureSetpoint - this.expectedSettings.temperatureSetpoint,
    ) < 0.05;
    const modeMatches = telemetry.runningMode === this.expectedSettings.mode;

    if (humidityMatches && temperatureMatches && modeMatches) {
      this.complete('success', 'Đã xác nhận thông số mới qua telemetry.');
    }
  }

  private complete(status: Exclude<CommandStatus, 'pending'>, response: string): void {
    if (!this.pending) return;
    if (this.timeout) clearTimeout(this.timeout);
    const completed: CommandRecord = {
      ...this.pending,
      status,
      response,
      completedAt: new Date().toISOString(),
    };
    this.pending = null;
    this.timeout = null;
    this.expectedSettings = null;
    this.options.onUpdate(completed);
  }
}
