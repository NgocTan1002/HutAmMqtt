import type { Pool } from 'pg';
import type { CommandRecord, CommandStatus } from '../../commands/command-service.js';
import type { CommandRepository } from '../repositories.js';
import { toIsoString } from './postgres-types.js';

type CommandHistoryRow = {
  id: string;
  deviceId: string;
  mqttPayload: string;
  status: CommandStatus;
  response: string | null;
  createdAt: Date | string;
  completedAt: Date | string | null;
};

export class PostgresCommandRepository implements CommandRepository {
  public constructor(private readonly pool: Pool) {}

  public async save(command: CommandRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO command_logs (id, device_id, mqtt_payload, status, response, created_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         response = EXCLUDED.response,
         completed_at = EXCLUDED.completed_at`,
      [
        command.id,
        command.deviceId,
        command.mqttPayload,
        command.status,
        command.response ?? null,
        command.createdAt,
        command.completedAt ?? null,
      ],
    );
  }

  public async getHistory(deviceId: string, limit: number): Promise<CommandRecord[]> {
    const result = await this.pool.query<CommandHistoryRow>(
      `SELECT
        id,
        device_id AS "deviceId",
        mqtt_payload AS "mqttPayload",
        status,
        response,
        created_at AS "createdAt",
        completed_at AS "completedAt"
      FROM command_logs
      WHERE device_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
      [deviceId, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      deviceId: row.deviceId,
      mqttPayload: row.mqttPayload,
      status: row.status,
      ...(row.response === null ? {} : { response: row.response }),
      createdAt: toIsoString(row.createdAt),
      ...(row.completedAt === null ? {} : { completedAt: toIsoString(row.completedAt) }),
    }));
  }

  public async getRange(deviceId: string, from: string, to: string, limit: number): Promise<CommandRecord[]> {
    const result = await this.pool.query<CommandHistoryRow>(
      `SELECT
        id,
        device_id AS "deviceId",
        mqtt_payload AS "mqttPayload",
        status,
        response,
        created_at AS "createdAt",
        completed_at AS "completedAt"
      FROM command_logs
      WHERE device_id = $1
        AND created_at >= $2::timestamptz
        AND created_at <= $3::timestamptz
      ORDER BY created_at ASC
      LIMIT $4`,
      [deviceId, from, to, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      deviceId: row.deviceId,
      mqttPayload: row.mqttPayload,
      status: row.status,
      ...(row.response === null ? {} : { response: row.response }),
      createdAt: toIsoString(row.createdAt),
      ...(row.completedAt === null ? {} : { completedAt: toIsoString(row.completedAt) }),
    }));
  }
}
