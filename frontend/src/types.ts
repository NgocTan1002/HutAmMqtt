export type Telemetry = {
  deviceId: string;
  connectionId?: string;
  temperature: number;
  humidity: number;
  coilTemperature: number;
  humiditySetpoint: number;
  temperatureSetpoint: number;
  runningStatus: string;
  runningMode: string;
  waterTankStatus: string;
  sensorError: number;
  filterStatus: 0 | 1 | null;
  fanStatus: 0 | 1 | null;
  heaterStatus: 0 | 1 | null;
  receivedAt: string;
};

export type DeviceState = {
  deviceId: string;
  connectionId?: string;
  mqttStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  connectionStatus: 'ONLINE' | 'OFFLINE';
  lastSeenAt: string | null;
  telemetry: Telemetry | null;
};

export type HistoryPoint = Omit<Telemetry, 'deviceId'>;

export type CommandRecord = {
  id: string;
  deviceId: string;
  mqttPayload: string;
  status: 'pending' | 'success' | 'error' | 'timeout';
  response?: string;
  createdAt: string;
  completedAt?: string;
};

export type EventRecord = {
  id: string;
  deviceId: string;
  type: string;
  severity: 'info' | 'warning' | 'danger';
  message: string;
  createdAt: string;
};

export type BrokerRuntime = {
  connectionId: string;
  name: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  connected: boolean;
  subscriptions: string[];
  lastChangedAt: string;
  error?: string;
};

export type MqttConnection = {
  id: string;
  name: string;
  brokerUrl: string;
  port: number;
  useTls: boolean;
  username: string | null;
  clientIdPrefix: string | null;
  enabled: boolean;
  hasPassword: boolean;
  runtime: BrokerRuntime | null;
};

export type Device = {
  id: string;
  name: string;
  mqttConnectionId: string;
  telemetryTopic: string;
  commandTopic: string;
  responseTopic: string;
  offlineAfterSeconds: number;
  enabled: boolean;
  state: DeviceState | null;
};

export type MqttConnectionPayload = {
  name: string;
  brokerUrl: string;
  port: number;
  useTls: boolean;
  username: string | null;
  password?: string | null;
  clientIdPrefix: string | null;
  enabled: boolean;
};

export type DevicePayload = Omit<Device, 'state'>;
export type ServerStatus = 'connecting' | 'connected' | 'disconnected';
