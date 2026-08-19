import type { Pool } from 'pg';
import type { EventRecord, EventSeverity } from '../../events/event-service.js';
import type { EventRepository } from '../repositories.js';
import { toIsoString } from './postgres-types.js';

type EventHistoryRow = {
  id: string;
  deviceId: string;
  type: string;
  severity: EventSeverity;
  message: string;
  createdAt: Date | string;
};

export class PostgresEventRepository implements EventRepository {
  public constructor(private readonly pool: Pool) {}

  public async save(event: EventRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO event_logs (id, device_id, type, severity, message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [event.id, event.deviceId, event.type, event.severity, event.message, event.createdAt],
    );
  }

  public async getHistory(deviceId: string, limit: number): Promise<EventRecord[]> {
    const result = await this.pool.query<EventHistoryRow>(
      `SELECT
        id,
        device_id AS "deviceId",
        type,
        severity,
        message,
        created_at AS "createdAt"
      FROM event_logs
      WHERE device_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
      [deviceId, limit],
    );

    return result.rows.map((row) => ({ ...row, createdAt: toIsoString(row.createdAt) }));
  }
}
