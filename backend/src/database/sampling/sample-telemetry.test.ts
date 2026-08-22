import assert from 'node:assert/strict';
import test from 'node:test';
import type { TelemetryHistoryPoint } from '../database-types.js';
import { sampleTelemetry } from './sample-telemetry.js';

function point(index: number): TelemetryHistoryPoint {
  return {
    temperature: 20 + index,
    humidity: 50 + index,
    coilTemperature: 15 + index,
    humiditySetpoint: 60,
    temperatureSetpoint: 28,
    runningStatus: 'SYS_RUNNING',
    runningMode: 'SMART',
    waterTankStatus: 'OK',
    sensorError: 0,
    filterStatus: index % 2 === 0 ? 0 : 1,
    fanStatus: index % 2 === 0 ? 1 : 0,
    heaterStatus: index % 2 === 0 ? 0 : 1,
    receivedAt: new Date(Date.UTC(2026, 7, 19, 8, 0, index)).toISOString(),
  };
}

test('sampleTelemetry keeps rows when the limit is not exceeded', () => {
  const rows = [point(0), point(1), point(2)];
  assert.equal(sampleTelemetry(rows, 3), rows);
});

test('sampleTelemetry averages measurements and keeps the last bucket state', () => {
  const rows = [point(0), point(1), point(2), point(3)];
  const sampled = sampleTelemetry(rows, 2);

  assert.equal(sampled.length, 2);
  assert.equal(sampled[0].temperature, 20.5);
  assert.equal(sampled[0].humidity, 50.5);
  assert.equal(sampled[0].coilTemperature, 15.5);
  assert.equal(sampled[0].filterStatus, rows[1].filterStatus);
  assert.equal(sampled[0].fanStatus, rows[1].fanStatus);
  assert.equal(sampled[0].heaterStatus, rows[1].heaterStatus);
  assert.equal(sampled[0].receivedAt, rows[1].receivedAt);
  assert.equal(sampled[1].temperature, 22.5);
  assert.equal(sampled[1].receivedAt, rows[3].receivedAt);
});

test('sampleTelemetry never exceeds the requested maximum', () => {
  const rows = Array.from({ length: 500 }, (_, index) => point(index));
  assert.ok(sampleTelemetry(rows, 240).length <= 240);
});

test('sampleTelemetry rejects an invalid maximum', () => {
  assert.throws(() => sampleTelemetry([point(0)], 0), /positive integer/);
});
