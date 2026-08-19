import { randomUUID } from 'node:crypto';
import type { DeviceState } from '../state/device-state.js';

export type EventSeverity = 'info' | 'warning' | 'danger';

export type EventRecord = {
  id: string;
  deviceId: string;
  type: string;
  severity: EventSeverity;
  message: string;
  createdAt: string;
};

type Snapshot = {
  online: boolean;
  waterFull: boolean;
  sensorError: boolean;
  systemError: boolean;
  defrosting: boolean;
};

export class EventService {
  private previous: Snapshot | null = null;

  public constructor(
    private readonly deviceId: string,
    private readonly onEvent: (event: EventRecord) => void,
  ) {}

  public handleState(state: DeviceState): void {
    if (!state.lastSeenAt || !state.telemetry) return;

    const current: Snapshot = {
      online: state.connectionStatus === 'ONLINE',
      waterFull: state.telemetry.waterTankStatus === 'FULL',
      sensorError: state.telemetry.sensorError !== 0,
      systemError: state.telemetry.runningStatus === 'SYS_ERROR',
      defrosting: state.telemetry.runningStatus === 'SYS_DEFROST',
    };

    if (!this.previous) {
      this.previous = current;
      if (current.waterFull) this.emit('WATER_TANK_FULL', 'warning', 'Khay nước đã đầy.');
      if (current.sensorError) this.emit('SENSOR_ERROR', 'danger', 'Cảm biến nhiệt ẩm đang báo lỗi.');
      if (current.systemError) this.emit('SYSTEM_ERROR', 'danger', 'Thiết bị đang báo lỗi hệ thống.');
      return;
    }

    this.emitTransition(this.previous.online, current.online, 'DEVICE_ONLINE', 'DEVICE_OFFLINE', 'Thiết bị đã kết nối trở lại.', 'Thiết bị đã mất kết nối.', 'info', 'danger');
    this.emitTransition(this.previous.waterFull, current.waterFull, 'WATER_TANK_FULL', 'WATER_TANK_NORMAL', 'Khay nước đã đầy.', 'Khay nước đã trở lại bình thường.', 'warning', 'info');
    this.emitTransition(this.previous.sensorError, current.sensorError, 'SENSOR_ERROR', 'SENSOR_RECOVERED', 'Cảm biến nhiệt ẩm đang báo lỗi.', 'Cảm biến nhiệt ẩm đã hoạt động bình thường.', 'danger', 'info');
    this.emitTransition(this.previous.systemError, current.systemError, 'SYSTEM_ERROR', 'SYSTEM_RECOVERED', 'Thiết bị đang báo lỗi hệ thống.', 'Thiết bị đã thoát trạng thái lỗi.', 'danger', 'info');
    this.emitTransition(this.previous.defrosting, current.defrosting, 'DEFROST_STARTED', 'DEFROST_COMPLETED', 'Thiết bị bắt đầu xả đá.', 'Thiết bị đã hoàn tất xả đá.', 'info', 'info');
    this.previous = current;
  }

  private emitTransition(
    previous: boolean,
    current: boolean,
    activeType: string,
    recoveredType: string,
    activeMessage: string,
    recoveredMessage: string,
    activeSeverity: EventSeverity,
    recoveredSeverity: EventSeverity,
  ): void {
    if (previous === current) return;
    if (current) this.emit(activeType, activeSeverity, activeMessage);
    else this.emit(recoveredType, recoveredSeverity, recoveredMessage);
  }

  private emit(type: string, severity: EventSeverity, message: string): void {
    this.onEvent({
      id: randomUUID(),
      deviceId: this.deviceId,
      type,
      severity,
      message,
      createdAt: new Date().toISOString(),
    });
  }
}
