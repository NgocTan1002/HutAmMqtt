import { SqliteCommandRepository } from './sqlite-command-repository.js';
import { createSqliteDatabase } from './sqlite-database.js';
import { SqliteEventRepository } from './sqlite-event-repository.js';
import { SqliteTelemetryRepository } from './sqlite-telemetry-repository.js';
import type { Repositories } from '../repositories.js';
import { emptyDeviceRepository, emptyMqttConnectionRepository } from '../empty-configuration-repositories.js';

export function createSqliteRepositories(databasePath: string): Repositories {
  const context = createSqliteDatabase(databasePath);

  return {
    telemetry: new SqliteTelemetryRepository(context.database),
    commands: new SqliteCommandRepository(context.database),
    events: new SqliteEventRepository(context.database),
    mqttConnections: emptyMqttConnectionRepository,
    devices: emptyDeviceRepository,
    async checkHealth() {
      try {
        context.database.prepare('SELECT 1').get();
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      context.close();
    },
  };
}
