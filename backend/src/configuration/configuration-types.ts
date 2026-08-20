export type MqttConnectionConfig = {
  id: string;
  name: string;
  brokerUrl: string;
  port: number;
  useTls: boolean;
  username: string | null;
  encryptedPassword: string | null;
  clientIdPrefix: string | null;
  enabled: boolean;
};

export type DeviceConfig = {
  id: string;
  name: string;
  mqttConnectionId: string;
  telemetryTopic: string;
  commandTopic: string;
  responseTopic: string;
  offlineAfterSeconds: number;
  enabled: boolean;
};
