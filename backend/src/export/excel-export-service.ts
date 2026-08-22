import type { Repositories } from '../database/repositories.js';
import type { ExcelExportQuery } from './excel-export-schema.js';
import { buildExcelWorkbook } from './workbook-builder.js';

const maximumTelemetryRows = 200_000;
const maximumLogRows = 20_000;

export class ExcelExportError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export class ExcelExportService {
  public constructor(private readonly repositories: Repositories) {}

  public async create(deviceId: string, query: ExcelExportQuery): Promise<{ buffer: Buffer; filename: string }> {
    const device = await this.repositories.devices.getById(deviceId);
    if (!device) throw new ExcelExportError('DEVICE_NOT_FOUND', 'Không tìm thấy thiết bị cần xuất dữ liệu.', 404);

    const [telemetry, commands, events] = await Promise.all([
      this.repositories.telemetry.getExportRange(device.id, query.from, query.to, maximumTelemetryRows + 1),
      query.includeCommands
        ? this.repositories.commands.getRange(device.id, query.from, query.to, maximumLogRows + 1)
        : Promise.resolve([]),
      query.includeEvents
        ? this.repositories.events.getRange(device.id, query.from, query.to, maximumLogRows + 1)
        : Promise.resolve([]),
    ]);

    if (telemetry.length > maximumTelemetryRows) {
      throw new ExcelExportError('EXPORT_TOO_LARGE', 'Khoảng thời gian có hơn 200.000 bản ghi. Hãy chọn khoảng thời gian ngắn hơn.', 413);
    }
    if (commands.length > maximumLogRows || events.length > maximumLogRows) {
      throw new ExcelExportError('EXPORT_TOO_LARGE', 'Khoảng thời gian có quá nhiều nhật ký. Hãy chọn khoảng thời gian ngắn hơn.', 413);
    }

    const workbook = buildExcelWorkbook({
      device,
      from: query.from,
      to: query.to,
      telemetry,
      commands,
      events,
      includeCommands: query.includeCommands,
      includeEvents: query.includeEvents,
    });
    const output = await workbook.xlsx.writeBuffer();
    const safeDeviceId = device.id.replace(/[^A-Za-z0-9_-]/g, '_');
    const fromDate = query.from.slice(0, 10);
    const toDate = query.to.slice(0, 10);
    return {
      buffer: Buffer.from(output),
      filename: `${safeDeviceId}_du-lieu_${fromDate}_${toDate}.xlsx`,
    };
  }
}
