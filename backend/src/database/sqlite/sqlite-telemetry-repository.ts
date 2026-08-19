import type { DatabaseSync } from 'node:sqlite';
import type { Telemetry } from '../../mqtt/telemetry-schema.js';
import type { TelemetryHistoryPoint } from '../database-types.js';
import type { TelemetryRepository } from '../repositories.js';
import { sampleTelemetry } from '../sampling/sample-telemetry.js';

export class SqliteTelemetryRepository implements TelemetryRepository {
  private readonly insertStatement;

  public constructor(private readonly database: DatabaseSync) {
    this.insertStatement = database.prepare(`
      INSERT INTO telemetry (
        device_id, temperature, humidity, coil_temperature, humidity_setpoint,
        temperature_setpoint, running_status, running_mode, water_tank_status,
        sensor_error, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  public async save(telemetry: Telemetry): Promise<void> {
    this.insertStatement.run(
      telemetry.deviceId,
      telemetry.temperature,
      telemetry.humidity,
      telemetry.coilTemperature,
      telemetry.humiditySetpoint,
      telemetry.temperatureSetpoint,
      telemetry.runningStatus,
      telemetry.runningMode,
      telemetry.waterTankStatus,
      telemetry.sensorError,
      telemetry.receivedAt,
    );
  }

  public async getRange(deviceId: string, hours: number, maxPoints = 240): Promise<TelemetryHistoryPoint[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const rows = this.database.prepare(`
      SELECT
        temperature,
        humidity,
        coil_temperature AS coilTemperature,
        humidity_setpoint AS humiditySetpoint,
        temperature_setpoint AS temperatureSetpoint,
        running_status AS runningStatus,
        running_mode AS runningMode,
        water_tank_status AS waterTankStatus,
        sensor_error AS sensorError,
        received_at AS receivedAt
      FROM telemetry
      WHERE device_id = ? AND received_at >= ?
      ORDER BY received_at ASC
    `).all(deviceId, since) as unknown as TelemetryHistoryPoint[];

    return sampleTelemetry(rows, maxPoints);
  }
}
