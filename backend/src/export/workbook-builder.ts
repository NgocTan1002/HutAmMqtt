import ExcelJS from 'exceljs';
import type { CommandRecord } from '../commands/command-service.js';
import type { DeviceConfig } from '../configuration/configuration-types.js';
import type { TelemetryHistoryPoint } from '../database/database-types.js';
import type { EventRecord } from '../events/event-service.js';

export type WorkbookInput = {
  device: DeviceConfig;
  from: string;
  to: string;
  telemetry: TelemetryHistoryPoint[];
  commands: CommandRecord[];
  events: EventRecord[];
  includeCommands: boolean;
  includeEvents: boolean;
  generatedAt?: Date;
};

const headerFill = '2F6E5E';

function formatVietnamTime(value: string | Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour12: false,
  }).format(typeof value === 'string' ? new Date(value) : value);
}

function binaryStatus(value: 0 | 1 | null): string {
  if (value === 1) return '1 - Đang chạy';
  if (value === 0) return '0 - Đang dừng';
  return 'Chưa có dữ liệu';
}

function modeLabel(value: string): string {
  if (value === 'SMART') return 'Thông minh';
  if (value === 'CONTINUOUS') return 'Liên tục';
  return value;
}

function runningStatusLabel(value: string): string {
  return {
    SYS_INIT: 'Đang khởi tạo',
    SYS_RUNNING: 'Đang vận hành',
    SYS_DEFROST: 'Đang xả đá',
    SYS_ERROR: 'Lỗi hệ thống',
  }[value] ?? value;
}

function commandStatusLabel(value: CommandRecord['status']): string {
  return { pending: 'Đang chờ', success: 'Thành công', timeout: 'Hết thời gian chờ', error: 'Thiết bị báo lỗi' }[value];
}

function eventSeverityLabel(value: EventRecord['severity']): string {
  return { info: 'Thông tin', warning: 'Cảnh báo', danger: 'Nguy hiểm' }[value];
}

function styleTable(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${headerFill}` } };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 24;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 1) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9F8' } };
    }
    row.alignment = { vertical: 'top', wrapText: true };
  });
}

function metric(values: number[]): { min: number; max: number; average: number } | null {
  if (values.length === 0) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    average: values.reduce((total, value) => total + value, 0) / values.length,
  };
}

function percentRunning(values: Array<0 | 1 | null>): string {
  const known = values.filter((value): value is 0 | 1 => value !== null);
  if (known.length === 0) return 'Chưa có dữ liệu';
  return `${((known.filter((value) => value === 1).length / known.length) * 100).toFixed(1)}% mẫu ghi nhận chạy`;
}

function addSummarySheet(workbook: ExcelJS.Workbook, input: WorkbookInput): void {
  const sheet = workbook.addWorksheet('Tổng hợp', { views: [{ showGridLines: false }] });
  sheet.columns = [{ width: 30 }, { width: 34 }, { width: 24 }, { width: 24 }];
  sheet.mergeCells('A1:D1');
  const title = sheet.getCell('A1');
  title.value = 'BÁO CÁO DỮ LIỆU THIẾT BỊ';
  title.font = { bold: true, size: 16, color: { argb: `FF${headerFill}` } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 30;

  const rows: Array<Array<string | number>> = [
    ['Thiết bị', input.device.name, 'Device ID', input.device.id],
    ['Từ thời điểm', formatVietnamTime(input.from), 'Đến thời điểm', formatVietnamTime(input.to)],
    ['Thời gian tạo', formatVietnamTime(input.generatedAt ?? new Date()), 'Số bản ghi', input.telemetry.length],
  ];
  rows.forEach((values) => sheet.addRow(values));

  const sectionRow = sheet.addRow(['Thống kê môi trường']);
  sheet.mergeCells(sectionRow.number, 1, sectionRow.number, 2);
  sectionRow.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sectionRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${headerFill}` } };

  const metrics = [
    ['Nhiệt độ phòng (°C)', metric(input.telemetry.map((row) => row.temperature))],
    ['Độ ẩm phòng (%RH)', metric(input.telemetry.map((row) => row.humidity))],
    ['Nhiệt độ giàn (°C)', metric(input.telemetry.map((row) => row.coilTemperature))],
  ] as const;
  sheet.addRow(['Thông số', 'Nhỏ nhất', 'Lớn nhất', 'Trung bình']).font = { bold: true };
  metrics.forEach(([label, value]) => sheet.addRow([
    label,
    value?.min.toFixed(1) ?? 'Không có dữ liệu',
    value?.max.toFixed(1) ?? 'Không có dữ liệu',
    value?.average.toFixed(1) ?? 'Không có dữ liệu',
  ]));

  const componentSection = sheet.addRow(['Trạng thái các bộ phận']);
  sheet.mergeCells(componentSection.number, 1, componentSection.number, 2);
  componentSection.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  componentSection.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${headerFill}` } };
  sheet.addRow(['Bộ lọc', percentRunning(input.telemetry.map((row) => row.filterStatus))]);
  sheet.addRow(['Quạt', percentRunning(input.telemetry.map((row) => row.fanStatus))]);
  sheet.addRow(['Gia nhiệt', percentRunning(input.telemetry.map((row) => row.heaterStatus))]);
  const latest = input.telemetry.at(-1);
  sheet.addRow(['Chế độ gần nhất', latest ? modeLabel(latest.runningMode) : 'Chưa có dữ liệu']);
  sheet.addRow(['Ngưỡng gần nhất', latest ? `${latest.humiditySetpoint.toFixed(1)} %RH · ${latest.temperatureSetpoint.toFixed(1)} °C` : 'Chưa có dữ liệu']);
  sheet.addRow(['Số lệnh điều khiển', input.commands.length, 'Số sự kiện', input.events.length]);

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.alignment = { vertical: 'middle', wrapText: true };
    if (rowNumber > 1 && rowNumber < 5) {
      row.getCell(1).font = { bold: true };
      row.getCell(3).font = { bold: true };
    }
  }
}

function addTelemetrySheet(workbook: ExcelJS.Workbook, telemetry: TelemetryHistoryPoint[]): void {
  const sheet = workbook.addWorksheet('Dữ liệu đo');
  sheet.columns = [
    { header: 'Thời gian', key: 'time', width: 22 },
    { header: 'Nhiệt độ (°C)', key: 'temperature', width: 16 },
    { header: 'Độ ẩm (%RH)', key: 'humidity', width: 16 },
    { header: 'Nhiệt độ giàn (°C)', key: 'coilTemperature', width: 20 },
    { header: 'Ngưỡng độ ẩm (%RH)', key: 'humiditySetpoint', width: 22 },
    { header: 'Ngưỡng nhiệt độ (°C)', key: 'temperatureSetpoint', width: 23 },
    { header: 'Trạng thái hệ thống', key: 'runningStatus', width: 22 },
    { header: 'Chế độ', key: 'runningMode', width: 16 },
    { header: 'Khay nước', key: 'waterTankStatus', width: 16 },
    { header: 'Cảm biến', key: 'sensorError', width: 18 },
    { header: 'Bộ lọc', key: 'filterStatus', width: 18 },
    { header: 'Quạt', key: 'fanStatus', width: 18 },
    { header: 'Gia nhiệt', key: 'heaterStatus', width: 18 },
  ];
  telemetry.forEach((row) => sheet.addRow({
    time: formatVietnamTime(row.receivedAt),
    temperature: row.temperature,
    humidity: row.humidity,
    coilTemperature: row.coilTemperature,
    humiditySetpoint: row.humiditySetpoint,
    temperatureSetpoint: row.temperatureSetpoint,
    runningStatus: runningStatusLabel(row.runningStatus),
    runningMode: modeLabel(row.runningMode),
    waterTankStatus: row.waterTankStatus === 'FULL' ? 'Đã đầy' : row.waterTankStatus === 'OK' ? 'Bình thường' : row.waterTankStatus,
    sensorError: row.sensorError === 0 ? 'Bình thường' : `Lỗi ${row.sensorError}`,
    filterStatus: binaryStatus(row.filterStatus),
    fanStatus: binaryStatus(row.fanStatus),
    heaterStatus: binaryStatus(row.heaterStatus),
  }));
  styleTable(sheet);
}

function addCommandSheet(workbook: ExcelJS.Workbook, commands: CommandRecord[]): void {
  const sheet = workbook.addWorksheet('Lệnh điều khiển');
  sheet.columns = [
    { header: 'Thời gian gửi', key: 'createdAt', width: 22 },
    { header: 'Nội dung MQTT', key: 'payload', width: 38 },
    { header: 'Kết quả', key: 'status', width: 22 },
    { header: 'Phản hồi thiết bị', key: 'response', width: 38 },
    { header: 'Thời gian hoàn thành', key: 'completedAt', width: 22 },
  ];
  commands.forEach((row) => sheet.addRow({
    createdAt: formatVietnamTime(row.createdAt),
    payload: row.mqttPayload.trim(),
    status: commandStatusLabel(row.status),
    response: row.response ?? '',
    completedAt: row.completedAt ? formatVietnamTime(row.completedAt) : '',
  }));
  styleTable(sheet);
}

function addEventSheet(workbook: ExcelJS.Workbook, events: EventRecord[]): void {
  const sheet = workbook.addWorksheet('Sự kiện');
  sheet.columns = [
    { header: 'Thời gian', key: 'createdAt', width: 22 },
    { header: 'Loại sự kiện', key: 'type', width: 25 },
    { header: 'Mức độ', key: 'severity', width: 16 },
    { header: 'Nội dung', key: 'message', width: 60 },
  ];
  events.forEach((row) => sheet.addRow({
    createdAt: formatVietnamTime(row.createdAt),
    type: row.type,
    severity: eventSeverityLabel(row.severity),
    message: row.message,
  }));
  styleTable(sheet);
}

export function buildExcelWorkbook(input: WorkbookInput): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hệ thống giám sát máy hút ẩm';
  workbook.created = input.generatedAt ?? new Date();
  workbook.modified = input.generatedAt ?? new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  addTelemetrySheet(workbook, input.telemetry);
  if (input.includeCommands) addCommandSheet(workbook, input.commands);
  if (input.includeEvents) addEventSheet(workbook, input.events);
  addSummarySheet(workbook, input);
  return workbook;
}
