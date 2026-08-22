import type { BinaryStatus } from '../mqtt/telemetry-schema.js';

export type TelemetryHistoryPoint = {
  temperature: number;
  humidity: number;
  coilTemperature: number;
  humiditySetpoint: number;
  temperatureSetpoint: number;
  runningStatus: string;
  runningMode: string;
  waterTankStatus: string;
  sensorError: number;
  filterStatus: BinaryStatus;
  fanStatus: BinaryStatus;
  heaterStatus: BinaryStatus;
  receivedAt: string;
};
