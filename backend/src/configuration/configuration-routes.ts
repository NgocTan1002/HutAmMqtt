import type { Application, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  deviceCreateSchema,
  deviceUpdateSchema,
  mqttConnectionCreateSchema,
  mqttConnectionTestSchema,
  mqttConnectionUpdateSchema,
} from './configuration-schemas.js';
import { ConfigurationError, type ConfigurationService } from './configuration-service.js';

type AsyncRoute = (request: Request, response: Response) => Promise<void>;

function asyncRoute(handler: AsyncRoute) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

function param(request: Request, name: string): string {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] : value;
}

export function registerConfigurationRoutes(app: Application, service: ConfigurationService): void {
  app.get('/api/mqtt-connections', asyncRoute(async (_request, response) => {
    response.json(await service.listMqttConnections());
  }));

  app.post('/api/mqtt-connections/test', asyncRoute(async (request, response) => {
    response.json(await service.testNewMqttConnection(mqttConnectionTestSchema.parse(request.body)));
  }));

  app.post('/api/mqtt-connections', asyncRoute(async (request, response) => {
    response.status(201).json(await service.createMqttConnection(mqttConnectionCreateSchema.parse(request.body)));
  }));

  app.get('/api/mqtt-connections/:connectionId', asyncRoute(async (request, response) => {
    response.json(await service.getMqttConnection(param(request, 'connectionId')));
  }));

  const updateConnection: AsyncRoute = async (request, response) => {
    response.json(await service.updateMqttConnection(
      param(request, 'connectionId'),
      mqttConnectionUpdateSchema.parse(request.body),
    ));
  };
  app.patch('/api/mqtt-connections/:connectionId', asyncRoute(updateConnection));
  app.put('/api/mqtt-connections/:connectionId', asyncRoute(updateConnection));

  app.post('/api/mqtt-connections/:connectionId/test', asyncRoute(async (request, response) => {
    response.json(await service.testStoredMqttConnection(param(request, 'connectionId')));
  }));

  app.post('/api/mqtt-connections/:connectionId/reconnect', asyncRoute(async (request, response) => {
    response.status(202).json(await service.reconnectMqttConnection(param(request, 'connectionId')));
  }));

  app.delete('/api/mqtt-connections/:connectionId', asyncRoute(async (request, response) => {
    await service.deleteMqttConnection(param(request, 'connectionId'));
    response.status(204).end();
  }));

  app.get('/api/devices', asyncRoute(async (_request, response) => {
    response.json(await service.listDevices());
  }));

  app.post('/api/devices', asyncRoute(async (request, response) => {
    response.status(201).json(await service.createDevice(deviceCreateSchema.parse(request.body)));
  }));

  app.get('/api/devices/:deviceId/config', asyncRoute(async (request, response) => {
    response.json(await service.getDevice(param(request, 'deviceId')));
  }));

  const updateDevice: AsyncRoute = async (request, response) => {
    response.json(await service.updateDevice(
      param(request, 'deviceId'),
      deviceUpdateSchema.parse(request.body),
    ));
  };
  app.patch('/api/devices/:deviceId', asyncRoute(updateDevice));
  app.put('/api/devices/:deviceId', asyncRoute(updateDevice));

  app.delete('/api/devices/:deviceId', asyncRoute(async (request, response) => {
    await service.deleteDevice(param(request, 'deviceId'));
    response.status(204).end();
  }));
}

export function configurationErrorHandler(
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
        code: 'VALIDATION_ERROR',
        message: 'Dữ liệu cấu hình không hợp lệ.',
        details: error.flatten().fieldErrors,
      },
    });
    return;
  }
  if (error instanceof ConfigurationError) {
    response.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }
  const databaseCode = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : null;
  if (databaseCode === '23505' || databaseCode === '23503') {
    response.status(409).json({
      error: {
        code: 'DATABASE_CONFLICT',
        message: 'Cấu hình xung đột với dữ liệu hiện có.',
      },
    });
    return;
  }
  console.error('Configuration API failed:', error);
  response.status(503).json({
    error: { code: 'CONFIGURATION_UNAVAILABLE', message: 'Không thể xử lý cấu hình lúc này.' },
  });
}
