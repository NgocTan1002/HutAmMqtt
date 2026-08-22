import type { DatabaseSync } from 'node:sqlite';
import type { CommandRecord, CommandStatus } from '../../commands/command-service.js';
import type { CommandRepository } from '../repositories.js';

type CommandHistoryRow = {
  id: string;
  deviceId: string;
  mqttPayload: string;
  status: CommandStatus;
  response: string | null;
  createdAt: string;
  completedAt: string | null;
};

export class SqliteCommandRepository implements CommandRepository {
  private readonly upsertStatement;

  public constructor(private readonly database: DatabaseSync) {
    this.upsertStatement = database.prepare(`
      INSERT INTO command_log (id, device_id, mqtt_payload, status, response, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        response = excluded.response,
        completed_at = excluded.completed_at
    `);
  }

  public async save(command: CommandRecord): Promise<void> {
    this.upsertStatement.run(
      command.id,
      command.deviceId,
      command.mqttPayload,
      command.status,
      command.response ?? null,
      command.createdAt,
      command.completedAt ?? null,
    );
  }

  public async getHistory(deviceId: string, limit: number): Promise<CommandRecord[]> {
    const rows = this.database.prepare(`
      SELECT
        id,
        device_id AS deviceId,
        mqtt_payload AS mqttPayload,
        status,
        response,
        created_at AS createdAt,
        completed_at AS completedAt
      FROM command_log
      WHERE device_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(deviceId, limit) as unknown as CommandHistoryRow[];

    return rows.map((row) => ({
      id: row.id,
      deviceId: row.deviceId,
      mqttPayload: row.mqttPayload,
      status: row.status,
      ...(row.response === null ? {} : { response: row.response }),
      createdAt: row.createdAt,
      ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
    }));
  }

  public async getRange(deviceId: string, from: string, to: string, limit: number): Promise<CommandRecord[]> {
    const rows = this.database.prepare(`
      SELECT
        id,
        device_id AS deviceId,
        mqtt_payload AS mqttPayload,
        status,
        response,
        created_at AS createdAt,
        completed_at AS completedAt
      FROM command_log
      WHERE device_id = ? AND created_at >= ? AND created_at <= ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(deviceId, from, to, limit) as unknown as CommandHistoryRow[];

    return rows.map((row) => ({
      id: row.id,
      deviceId: row.deviceId,
      mqttPayload: row.mqttPayload,
      status: row.status,
      ...(row.response === null ? {} : { response: row.response }),
      createdAt: row.createdAt,
      ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
    }));
  }
}
