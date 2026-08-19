import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import { ZodError } from 'zod';
import type { env } from '../config/env.js';
import { parseTelemetry, type Telemetry } from './telemetry-schema.js';
import type { MqttConnectionStatus } from '../state/device-state.js';

type MqttBridgeConfig = Pick<
  typeof env,
  'DEVICE_ID' | 'MQTT_BROKER_URL' | 'MQTT_TELEMETRY_TOPIC' | 'MQTT_RESPONSE_TOPIC' | 'MQTT_USERNAME' | 'MQTT_PASSWORD'
>;

type MqttBridgeHandlers = {
  onConnectionStatus: (status: MqttConnectionStatus) => void;
  onDeviceResponse: (response: string) => void;
  onTelemetry: (telemetry: Telemetry) => void;
};

function logTelemetryError(error: unknown): void {
  if (error instanceof ZodError) {
    console.warn('Ignored invalid telemetry:', error.issues.map((issue) => issue.message).join(', '));
    return;
  }

  console.warn('Ignored invalid telemetry:', error instanceof Error ? error.message : error);
}

export function startMqttBridge(config: MqttBridgeConfig, handlers: MqttBridgeHandlers): MqttClient {
  const options: IClientOptions = {
    clean: true,
    clientId: `nhiet-am-dashboard-api-${config.DEVICE_ID}-${process.pid}`,
    connectTimeout: 30_000,
    reconnectPeriod: 5_000,
  };

  if (config.MQTT_USERNAME) {
    options.username = config.MQTT_USERNAME;
  }

  if (config.MQTT_PASSWORD) {
    options.password = config.MQTT_PASSWORD;
  }

  handlers.onConnectionStatus('connecting');
  const client = mqtt.connect(config.MQTT_BROKER_URL, options);

  client.on('connect', () => {
    handlers.onConnectionStatus('connected');
    const receiveTopics = [...new Set([config.MQTT_TELEMETRY_TOPIC, config.MQTT_RESPONSE_TOPIC])];
    console.log(`MQTT connected. Subscribing to ${receiveTopics.join(', ')}`);

    client.subscribe(receiveTopics, { qos: 0 }, (error) => {
      if (error) {
        handlers.onConnectionStatus('error');
        console.error(`MQTT subscribe failed for ${receiveTopics.join(', ')}:`, error.message);
      }
    });
  });

  client.on('message', (topic, payload) => {
    const rawText = payload.toString('utf8').trim();

    if (rawText.startsWith('{') && topic === config.MQTT_TELEMETRY_TOPIC) {
      try {
        handlers.onTelemetry(parseTelemetry(payload, config.DEVICE_ID));
      } catch (error) {
        logTelemetryError(error);
      }
      return;
    }

    if (topic === config.MQTT_RESPONSE_TOPIC && (rawText.startsWith('Da Nhan') || rawText.startsWith('Loi'))) {
      handlers.onDeviceResponse(rawText);
      return;
    }

    console.warn(`Ignored unknown MQTT message on ${topic}.`);
  });

  client.on('reconnect', () => {
    handlers.onConnectionStatus('connecting');
    console.warn('MQTT reconnecting...');
  });

  client.on('offline', () => {
    handlers.onConnectionStatus('disconnected');
    console.warn('MQTT client is offline.');
  });

  client.on('close', () => {
    handlers.onConnectionStatus('disconnected');
    console.warn('MQTT connection closed.');
  });

  client.on('error', (error) => {
    handlers.onConnectionStatus('error');
    console.error('MQTT connection error:', error.message);
  });

  return client;
}
