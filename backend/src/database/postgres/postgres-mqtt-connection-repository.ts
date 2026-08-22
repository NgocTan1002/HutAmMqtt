import type { Pool } from 'pg';
import type { MqttConnectionConfig } from '../../configuration/configuration-types.js';
import type { MqttConnectionRepository } from '../repositories.js';

type MqttConnectionRow = {
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

const selectColumns = `
  id,
  name,
  broker_url AS "brokerUrl",
  port,
  use_tls AS "useTls",
  username,
  encrypted_password AS "encryptedPassword",
  client_id_prefix AS "clientIdPrefix",
  enabled
`;

export class PostgresMqttConnectionRepository implements MqttConnectionRepository {
  public constructor(private readonly pool: Pool) {}

  public async getAll(): Promise<MqttConnectionConfig[]> {
    const result = await this.pool.query<MqttConnectionRow>(`
      SELECT ${selectColumns}
      FROM mqtt_connections
      ORDER BY name ASC, id ASC
    `);
    return result.rows;
  }

  public async getEnabled(): Promise<MqttConnectionConfig[]> {
    const result = await this.pool.query<MqttConnectionRow>(`
      SELECT ${selectColumns}
      FROM mqtt_connections
      WHERE enabled = TRUE
      ORDER BY name ASC, id ASC
    `);
    return result.rows;
  }

  public async getById(id: string): Promise<MqttConnectionConfig | null> {
    const result = await this.pool.query<MqttConnectionRow>(
      `SELECT ${selectColumns}
       FROM mqtt_connections
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  public async create(config: MqttConnectionConfig): Promise<MqttConnectionConfig> {
    const result = await this.pool.query<MqttConnectionRow>(
      `INSERT INTO mqtt_connections (
        id, name, broker_url, port, use_tls, username, encrypted_password,
        client_id_prefix, enabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING ${selectColumns}`,
      [
        config.id, config.name, config.brokerUrl, config.port, config.useTls,
        config.username, config.encryptedPassword, config.clientIdPrefix, config.enabled,
      ],
    );
    return result.rows[0];
  }

  public async update(config: MqttConnectionConfig): Promise<MqttConnectionConfig | null> {
    const result = await this.pool.query<MqttConnectionRow>(
      `UPDATE mqtt_connections SET
        name = $2,
        broker_url = $3,
        port = $4,
        use_tls = $5,
        username = $6,
        encrypted_password = $7,
        client_id_prefix = $8,
        enabled = $9,
        updated_at = NOW()
      WHERE id = $1
      RETURNING ${selectColumns}`,
      [
        config.id, config.name, config.brokerUrl, config.port, config.useTls,
        config.username, config.encryptedPassword, config.clientIdPrefix, config.enabled,
      ],
    );
    return result.rows[0] ?? null;
  }

  public async delete(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM mqtt_connections WHERE id = $1', [id]);
    return result.rowCount === 1;
  }

  public async countDevices(id: string): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      'SELECT COUNT(*)::integer AS count FROM devices WHERE mqtt_connection_id = $1',
      [id],
    );
    return result.rows[0]?.count ?? 0;
  }
}
