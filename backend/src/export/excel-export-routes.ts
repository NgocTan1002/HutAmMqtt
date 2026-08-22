import type { Application, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ExcelExportError, type ExcelExportService } from './excel-export-service.js';
import { excelExportQuerySchema } from './excel-export-schema.js';

function deviceId(request: Request): string {
  const value = request.params.deviceId;
  return Array.isArray(value) ? value[0] : value;
}

export function registerExcelExportRoutes(app: Application, service: ExcelExportService): void {
  app.get('/api/devices/:deviceId/export/excel', (request, response, next) => {
    void service.create(deviceId(request), excelExportQuerySchema.parse(request.query))
      .then((result) => {
        response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        response.setHeader('Cache-Control', 'no-store');
        response.send(result.buffer);
      })
      .catch(next);
  });
}

export function excelExportErrorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: 'INVALID_EXPORT_RANGE',
        message: 'Khoảng thời gian xuất Excel không hợp lệ.',
        details: error.flatten().fieldErrors,
      },
    });
    return;
  }
  if (error instanceof ExcelExportError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  next(error);
}
