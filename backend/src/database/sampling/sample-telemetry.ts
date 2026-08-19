import type { TelemetryHistoryPoint } from '../database-types.js';

export function sampleTelemetry(
  rows: TelemetryHistoryPoint[],
  maxPoints = 240,
): TelemetryHistoryPoint[] {
  if (!Number.isInteger(maxPoints) || maxPoints <= 0) {
    throw new Error('maxPoints must be a positive integer.');
  }

  if (rows.length <= maxPoints) return rows;

  const bucketSize = Math.ceil(rows.length / maxPoints);
  const sampled: TelemetryHistoryPoint[] = [];

  for (let index = 0; index < rows.length; index += bucketSize) {
    const bucket = rows.slice(index, index + bucketSize);
    const last = bucket[bucket.length - 1];
    const average = (field: 'temperature' | 'humidity' | 'coilTemperature') =>
      bucket.reduce((total, row) => total + row[field], 0) / bucket.length;

    sampled.push({
      ...last,
      temperature: average('temperature'),
      humidity: average('humidity'),
      coilTemperature: average('coilTemperature'),
    });
  }

  return sampled;
}
