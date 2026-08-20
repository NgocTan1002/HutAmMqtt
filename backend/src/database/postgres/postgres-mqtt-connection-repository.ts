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
}
