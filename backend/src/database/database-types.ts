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
  receivedAt: string;
};
