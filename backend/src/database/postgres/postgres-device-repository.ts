import type { Pool } from 'pg';
import type { DeviceConfig } from '../../configuration/configuration-types.js';
import type { DeviceDataUsage, DeviceRepository } from '../repositories.js';

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

  public async getAll(): Promise<DeviceConfig[]> {
    const result = await this.pool.query<DeviceRow>(`
      SELECT ${selectColumns}
      FROM devices
      ORDER BY name ASC, id ASC
    `);
    return result.rows;
  }

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

  public async create(config: DeviceConfig): Promise<DeviceConfig> {
    const result = await this.pool.query<DeviceRow>(
      `INSERT INTO devices (
        id, name, mqtt_connection_id, telemetry_topic, command_topic,
        response_topic, offline_after_seconds, enabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING ${selectColumns}`,
      [
        config.id, config.name, config.mqttConnectionId, config.telemetryTopic,
        config.commandTopic, config.responseTopic, config.offlineAfterSeconds, config.enabled,
      ],
    );
    return result.rows[0];
  }

  public async update(config: DeviceConfig): Promise<DeviceConfig | null> {
    const result = await this.pool.query<DeviceRow>(
      `UPDATE devices SET
        name = $2,
        mqtt_connection_id = $3,
        telemetry_topic = $4,
        command_topic = $5,
        response_topic = $6,
        offline_after_seconds = $7,
        enabled = $8,
        updated_at = NOW()
      WHERE id = $1
      RETURNING ${selectColumns}`,
      [
        config.id, config.name, config.mqttConnectionId, config.telemetryTopic,
        config.commandTopic, config.responseTopic, config.offlineAfterSeconds, config.enabled,
      ],
    );
    return result.rows[0] ?? null;
  }

  public async delete(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM devices WHERE id = $1', [id]);
    return result.rowCount === 1;
  }

  public async getDataUsage(id: string): Promise<DeviceDataUsage> {
    const result = await this.pool.query<Omit<DeviceDataUsage, 'total'>>(
      `SELECT
        (SELECT COUNT(*)::integer FROM telemetry WHERE device_id = $1) AS telemetry,
        (SELECT COUNT(*)::integer FROM command_logs WHERE device_id = $1) AS commands,
        (SELECT COUNT(*)::integer FROM event_logs WHERE device_id = $1) AS events`,
      [id],
    );
    const usage = result.rows[0] ?? { telemetry: 0, commands: 0, events: 0 };
    return { ...usage, total: usage.telemetry + usage.commands + usage.events };
  }
}
