import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import type { CommandRecord } from '../commands/command-service.js';
import type { DeviceConfig } from '../configuration/configuration-types.js';
import type { TelemetryHistoryPoint } from '../database/database-types.js';
import type { EventRecord } from '../events/event-service.js';
import { excelExportQuerySchema } from './excel-export-schema.js';
import { buildExcelWorkbook } from './workbook-builder.js';

const device: DeviceConfig = {
  id: 'mayhutam1',
  name: 'Máy hút ẩm 1',
  mqttConnectionId: 'connection-1',
  telemetryTopic: 'mayhutam1/nhan',
  commandTopic: 'mayhutam1/caidat',
  responseTopic: 'mayhutam1/nhan',
  offlineAfterSeconds: 20,
  enabled: true,
};

const telemetry: TelemetryHistoryPoint = {
  temperature: 28.3,
  humidity: 86.2,
  coilTemperature: 26.3,
  humiditySetpoint: 88,
  temperatureSetpoint: 13.4,
  runningStatus: 'SYS_RUNNING',
  runningMode: 'SMART',
  waterTankStatus: 'OK',
  sensorError: 0,
  filterStatus: 0,
  fanStatus: 1,
  heaterStatus: 0,
  receivedAt: '2026-08-22T08:00:00.000Z',
};

const command: CommandRecord = {
  id: 'command-1',
  deviceId: device.id,
  mqttPayload: 'ALL=SH=88.0,ST=13.4,MD=0\r\n',
  status: 'success',
  response: 'Đã xác nhận qua telemetry.',
  createdAt: '2026-08-22T08:01:00.000Z',
  completedAt: '2026-08-22T08:01:02.000Z',
};

const event: EventRecord = {
  id: 'event-1',
  deviceId: device.id,
  type: 'DEVICE_ONLINE',
  severity: 'info',
  message: 'Thiết bị đã trực tuyến.',
  createdAt: '2026-08-22T08:00:00.000Z',
};

test('Excel export schema accepts one day and rejects more than 31 days', () => {
  assert.equal(excelExportQuerySchema.safeParse({
    from: '2026-08-21T08:00:00.000Z',
    to: '2026-08-22T08:00:00.000Z',
  }).success, true);
  assert.equal(excelExportQuerySchema.safeParse({
    from: '2026-07-01T08:00:00.000Z',
    to: '2026-08-22T08:00:00.000Z',
  }).success, false);
});

test('workbook contains summary, raw telemetry, commands and events', async () => {
  const source = buildExcelWorkbook({
    device,
    from: '2026-08-21T08:00:00.000Z',
    to: '2026-08-22T08:00:00.000Z',
    telemetry: [telemetry],
    commands: [command],
    events: [event],
    includeCommands: true,
    includeEvents: true,
    generatedAt: new Date('2026-08-22T09:00:00.000Z'),
  });
  const output = await source.xlsx.writeBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    'Dữ liệu đo', 'Lệnh điều khiển', 'Sự kiện', 'Tổng hợp',
  ]);
  assert.equal(workbook.getWorksheet('Tổng hợp')?.getCell('A1').value, 'BÁO CÁO DỮ LIỆU THIẾT BỊ');
  assert.deepEqual(workbook.getWorksheet('Tổng hợp')?.model.merges, ['A1:D1', 'A5:B5', 'A10:B10']);
  const dataSheet = workbook.getWorksheet('Dữ liệu đo');
  assert.equal(dataSheet?.getCell('B2').value, 28.3);
  assert.equal(dataSheet?.getCell('K2').value, '0 - Đang dừng');
  assert.equal(dataSheet?.getCell('L2').value, '1 - Đang chạy');
  assert.equal(dataSheet?.getCell('M2').value, '0 - Đang dừng');
  assert.equal(workbook.getWorksheet('Lệnh điều khiển')?.getCell('C2').value, 'Thành công');
  assert.equal(workbook.getWorksheet('Sự kiện')?.getCell('D2').value, 'Thiết bị đã trực tuyến.');
});
