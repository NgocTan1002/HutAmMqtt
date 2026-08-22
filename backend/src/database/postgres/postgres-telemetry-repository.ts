import type { Pool } from 'pg';
import type { Telemetry } from '../../mqtt/telemetry-schema.js';
import type { TelemetryHistoryPoint } from '../database-types.js';
import type { TelemetryRepository } from '../repositories.js';
import { sampleTelemetry } from '../sampling/sample-telemetry.js';
import { toIsoString } from './postgres-types.js';

type TelemetryRow = Omit<TelemetryHistoryPoint, 'receivedAt'> & {
  receivedAt: Date | string;
};

export class PostgresTelemetryRepository implements TelemetryRepository {
  public constructor(private readonly pool: Pool) {}

  public async save(telemetry: Telemetry): Promise<void> {
    await this.pool.query(
      `INSERT INTO telemetry (
        device_id, temperature, humidity, coil_temperature, humidity_setpoint,
        temperature_setpoint, running_status, running_mode, water_tank_status,
        sensor_error, filter_status, fan_status, heater_status, received_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
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
        telemetry.filterStatus,
        telemetry.fanStatus,
        telemetry.heaterStatus,
        telemetry.receivedAt,
      ],
    );
  }

  public async getRange(deviceId: string, hours: number, maxPoints = 240): Promise<TelemetryHistoryPoint[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const result = await this.pool.query<TelemetryRow>(
      `SELECT
        temperature,
        humidity,
        coil_temperature AS "coilTemperature",
        humidity_setpoint AS "humiditySetpoint",
        temperature_setpoint AS "temperatureSetpoint",
        running_status AS "runningStatus",
        running_mode AS "runningMode",
        water_tank_status AS "waterTankStatus",
        sensor_error AS "sensorError",
        filter_status AS "filterStatus",
        fan_status AS "fanStatus",
        heater_status AS "heaterStatus",
        received_at AS "receivedAt"
      FROM telemetry
      WHERE device_id = $1 AND received_at >= $2::timestamptz
      ORDER BY received_at ASC`,
      [deviceId, since],
    );

    return sampleTelemetry(
      result.rows.map((row) => ({ ...row, receivedAt: toIsoString(row.receivedAt) })),
      maxPoints,
    );
  }

  public async getExportRange(deviceId: string, from: string, to: string, limit: number): Promise<TelemetryHistoryPoint[]> {
    const result = await this.pool.query<TelemetryRow>(
      `SELECT
        temperature,
        humidity,
        coil_temperature AS "coilTemperature",
        humidity_setpoint AS "humiditySetpoint",
        temperature_setpoint AS "temperatureSetpoint",
        running_status AS "runningStatus",
        running_mode AS "runningMode",
        water_tank_status AS "waterTankStatus",
        sensor_error AS "sensorError",
        filter_status AS "filterStatus",
        fan_status AS "fanStatus",
        heater_status AS "heaterStatus",
        received_at AS "receivedAt"
      FROM telemetry
      WHERE device_id = $1
        AND received_at >= $2::timestamptz
        AND received_at <= $3::timestamptz
      ORDER BY received_at ASC
      LIMIT $4`,
      [deviceId, from, to, limit],
    );

    return result.rows.map((row) => ({ ...row, receivedAt: toIsoString(row.receivedAt) }));
  }
}
