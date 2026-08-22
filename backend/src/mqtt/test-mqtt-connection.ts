import { randomUUID } from 'node:crypto';
import mqtt, { type IClientOptions } from 'mqtt';
import {
  buildMqttBrokerAddress,
  type MqttClientConnectionConfig,
} from './mqtt-connection-manager.js';

export type MqttConnectionTestResult = {
  success: true;
  durationMs: number;
};

export type MqttConnectionTester = (
  config: MqttClientConnectionConfig,
  timeoutMs?: number,
) => Promise<MqttConnectionTestResult>;

export const testMqttConnection: MqttConnectionTester = (config, timeoutMs = 8_000) => {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const options: IClientOptions = {
      clean: true,
      clientId: `${config.clientIdPrefix || 'nhiet-am-test'}-${randomUUID()}`,
      connectTimeout: timeoutMs,
      reconnectPeriod: 0,
    };
    if (config.username) options.username = config.username;
    if (config.password) options.password = config.password;

    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const client = mqtt.connect(buildMqttBrokerAddress(config), options);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      client.removeAllListeners();
      client.end(true, {}, () => {
        if (error) reject(error);
        else resolve({ success: true, durationMs: Date.now() - startedAt });
      });
    };

    timer = setTimeout(
      () => finish(new Error('Hết thời gian chờ kết nối MQTT.')),
      timeoutMs,
    );
    client.once('connect', () => finish());
    client.once('error', () => finish(new Error('Không thể kết nối MQTT. Kiểm tra địa chỉ, TLS và thông tin đăng nhập.')));
  });
};
