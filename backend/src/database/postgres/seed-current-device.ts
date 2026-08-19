import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { env } from '../../config/env.js';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required to seed PostgreSQL.');

const mqttUrl = new URL(env.MQTT_BROKER_URL);
if (!['mqtt:', 'mqtts:'].includes(mqttUrl.protocol)) {
  throw new Error('MQTT_BROKER_URL must use mqtt:// or mqtts://.');
}

const defaultPort = mqttUrl.protocol === 'mqtts:' ? 8883 : 1883;
const brokerPort = mqttUrl.port ? Number(mqttUrl.port) : defaultPort;
const brokerUrl = `${mqttUrl.protocol}//${mqttUrl.hostname}`;
const useTls = env.MQTT_USE_TLS || mqttUrl.protocol === 'mqtts:';
const username = env.MQTT_USERNAME?.trim() || null;
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
  max: 1,
  ssl: env.DATABASE_SSL,
});
const client = await pool.connect();

try {
  await client.query('BEGIN');
  const existingDevice = await client.query<{ mqtt_connection_id: string }>(
    'SELECT mqtt_connection_id FROM devices WHERE id = $1',
    [env.DEVICE_ID],
  );
  const connectionId = existingDevice.rows[0]?.mqtt_connection_id ?? randomUUID();

  if (existingDevice.rowCount === 0) {
    await client.query(
      `INSERT INTO mqtt_connections (
        id, name, broker_url, port, use_tls, username, client_id_prefix, enabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
      [connectionId, 'Broker mặc định', brokerUrl, brokerPort, useTls, username, 'nhiet-am-mqtt'],
    );
  } else {
    await client.query(
      `UPDATE mqtt_connections SET
        name = $2,
        broker_url = $3,
        port = $4,
        use_tls = $5,
        username = $6,
        client_id_prefix = $7,
        enabled = TRUE,
        updated_at = NOW()
      WHERE id = $1`,
      [connectionId, 'Broker mặc định', brokerUrl, brokerPort, useTls, username, 'nhiet-am-mqtt'],
    );
  }

  await client.query(
    `INSERT INTO devices (
      id, name, mqtt_connection_id, telemetry_topic, command_topic,
      response_topic, offline_after_seconds, enabled
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      mqtt_connection_id = EXCLUDED.mqtt_connection_id,
      telemetry_topic = EXCLUDED.telemetry_topic,
      command_topic = EXCLUDED.command_topic,
      response_topic = EXCLUDED.response_topic,
      offline_after_seconds = EXCLUDED.offline_after_seconds,
      enabled = TRUE,
      updated_at = NOW()`,
    [
      env.DEVICE_ID,
      `Máy hút ẩm ${env.DEVICE_ID}`,
      connectionId,
      env.MQTT_TELEMETRY_TOPIC,
      env.MQTT_COMMAND_TOPIC,
      env.MQTT_RESPONSE_TOPIC,
      env.DEVICE_OFFLINE_AFTER_SECONDS,
    ],
  );

  await client.query('COMMIT');
  console.log(`Seeded MQTT connection and device: ${env.DEVICE_ID}`);
  if (env.MQTT_PASSWORD) {
    console.log('MQTT password remains in .env; encrypted database storage will be added with MQTT settings management.');
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
