import type { Repositories } from '../repositories.js';
import { PostgresCommandRepository } from './postgres-command-repository.js';
import { PostgresDeviceRepository } from './postgres-device-repository.js';
import { PostgresEventRepository } from './postgres-event-repository.js';
import { PostgresMqttConnectionRepository } from './postgres-mqtt-connection-repository.js';
import { createPostgresPool, type PostgresPoolOptions } from './postgres-pool.js';
import { PostgresTelemetryRepository } from './postgres-telemetry-repository.js';

export function createPostgresRepositories(options: PostgresPoolOptions): Repositories {
  const pool = createPostgresPool(options);
  let closed = false;

  return {
    telemetry: new PostgresTelemetryRepository(pool),
    commands: new PostgresCommandRepository(pool),
    events: new PostgresEventRepository(pool),
    mqttConnections: new PostgresMqttConnectionRepository(pool),
    devices: new PostgresDeviceRepository(pool),
    async checkHealth() {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
