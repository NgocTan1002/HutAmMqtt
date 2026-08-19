import { z } from 'zod';

const finiteNumber = z.number().finite();

const rawTelemetrySchema = z.object({
  Tdo: finiteNumber,
  Hdo: finiteNumber,
  Tgian: finiteNumber,
  NguongAmSmt: finiteNumber,
  NguongNhietCON: finiteNumber,
  'Running Status': z.string().trim().min(1),
  'Running Mode': z.string().trim().min(1),
  'Water Tank Status': z.string().trim().min(1),
  'Sensor Error': z.number().int(),
});

export type Telemetry = {
  deviceId: string;
  humidity: number;
  humiditySetpoint: number;
  coilTemperature: number;
  receivedAt: string;
  runningMode: string;
  runningStatus: string;
  sensorError: number;
  temperature: number;
  temperatureSetpoint: number;
  waterTankStatus: string;
};

function normalizeLegacyTelemetry(rawText: string): string {
  return rawText
    .replace(
      /("Running Status"\s*:\s*)(SYS_INIT|SYS_RUNNING|SYS_DEFROST|SYS_ERROR)(?=\s*[,}])/g,
      '$1"$2"',
    )
    .replace(
      /("Running Mode"\s*:\s*)(SMART|CONTINUE|CONTINUOUS)(?=\s*[,}])/g,
      '$1"$2"',
    )
    .replace(
      /("Water Tank Status"\s*:\s*)(OK|FULL)(?=\s*[,}])/g,
      '$1"$2"',
    );
}

let hasWarnedLegacyFormat = false;

export function parseTelemetry(payload: Buffer, deviceId: string, receivedAt = new Date()): Telemetry {
  const rawText = payload.toString('utf8').trim();

  const normalizedText = normalizeLegacyTelemetry(rawText);

  if (normalizedText !== rawText) {
    if (!hasWarnedLegacyFormat) {
      console.warn('Received legacy telemetry format; string values were normalized.');
      hasWarnedLegacyFormat = true;
    }
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(normalizedText);
  } catch {
    throw new Error('Telemetry payload is not valid JSON.');
  }

  const rawTelemetry = rawTelemetrySchema.parse(decoded);
  const runningMode = rawTelemetry['Running Mode'].toUpperCase();

  return {
    deviceId,
    temperature: rawTelemetry.Tdo,
    humidity: rawTelemetry.Hdo,
    coilTemperature: rawTelemetry.Tgian,
    humiditySetpoint: rawTelemetry.NguongAmSmt,
    temperatureSetpoint: rawTelemetry.NguongNhietCON,
    runningStatus: rawTelemetry['Running Status'].toUpperCase(),
    runningMode: runningMode === 'CONTINUE' ? 'CONTINUOUS' : runningMode,
    waterTankStatus: rawTelemetry['Water Tank Status'].toUpperCase(),
    sensorError: rawTelemetry['Sensor Error'],
    receivedAt: receivedAt.toISOString(),
  };
}
