import type { DatabaseSync } from 'node:sqlite';
import type { EventRecord, EventSeverity } from '../../events/event-service.js';
import type { EventRepository } from '../repositories.js';

type EventHistoryRow = {
  id: string;
  deviceId: string;
  type: string;
  severity: EventSeverity;
  message: string;
  createdAt: string;
};

export class SqliteEventRepository implements EventRepository {
  private readonly insertStatement;

  public constructor(private readonly database: DatabaseSync) {
    this.insertStatement = database.prepare(`
      INSERT INTO event_log (id, device_id, type, severity, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
  }

  public async save(event: EventRecord): Promise<void> {
    this.insertStatement.run(
      event.id,
      event.deviceId,
      event.type,
      event.severity,
      event.message,
      event.createdAt,
    );
  }

  public async getHistory(deviceId: string, limit: number): Promise<EventRecord[]> {
    return this.database.prepare(`
      SELECT
        id,
        device_id AS deviceId,
        type,
        severity,
        message,
        created_at AS createdAt
      FROM event_log
      WHERE device_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(deviceId, limit) as unknown as EventHistoryRow[];
  }
}
