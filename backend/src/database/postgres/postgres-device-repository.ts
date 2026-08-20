import type { Pool } from 'pg';
import type { DeviceConfig } from '../../configuration/configuration-types.js';
import type { DeviceRepository } from '../repositories.js';

type DeviceRow = {
  id: string;
  name: string;
  mqttConnectionId: string;
  telemetryTopic: string;
  commandTopic: string;
  responseTopic: string;
  offlineAfterSeconds: number;
  enabled: boolean;
};

const selectColumns = `
  id,
  name,
  mqtt_connection_id AS "mqttConnectionId",
  telemetry_topic AS "telemetryTopic",
  command_topic AS "commandTopic",
  response_topic AS "responseTopic",
  offline_after_seconds AS "offlineAfterSeconds",
  enabled
`;

export class PostgresDeviceRepository implements DeviceRepository {
  public constructor(private readonly pool: Pool) {}

  public async getEnabled(): Promise<DeviceConfig[]> {
    const result = await this.pool.query<DeviceRow>(`
      SELECT ${selectColumns}
      FROM devices
      WHERE enabled = TRUE
      ORDER BY name ASC, id ASC
    `);
    return result.rows;
  }

  public async getById(id: string): Promise<DeviceConfig | null> {
    const result = await this.pool.query<DeviceRow>(
      `SELECT ${selectColumns}
       FROM devices
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }
}
