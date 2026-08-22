import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { env } from './config/env.js';
import { configurationErrorHandler, registerConfigurationRoutes } from './configuration/configuration-routes.js';
import { ConfigurationService } from './configuration/configuration-service.js';
import { createRepositories } from './database/database.js';
import { DeviceRegistry } from './devices/device-registry.js';
import { DeviceRuntime } from './devices/device-runtime.js';
import { RuntimeCoordinator } from './devices/runtime-coordinator.js';
import { excelExportErrorHandler, registerExcelExportRoutes } from './export/excel-export-routes.js';
import { ExcelExportService } from './export/excel-export-service.js';
import { MqttConnectionManager, type BrokerConnectionState } from './mqtt/mqtt-connection-manager.js';
import { TopicRouter } from './mqtt/topic-router.js';
import { CredentialCipher } from './security/credential-cipher.js';
import type { MqttConnectionStatus } from './state/device-state.js';

const app = express();
const httpServer = createServer(app);
const repositories = createRepositories();
const credentialCipher = env.CONFIG_ENCRYPTION_KEY
  ? CredentialCipher.fromBase64(env.CONFIG_ENCRYPTION_KEY)
  : null;

function persist(operation: Promise<void>, context: string): void {
  void operation.catch((error) => console.error(`Database operation failed (${context}):`, error));
}

const io = new Server(httpServer, { cors: { origin: `http://localhost:${env.FRONTEND_PORT}` } });
app.use(cors({ origin: `http://localhost:${env.FRONTEND_PORT}` }));
app.use(express.json());

const settingsSchema = z.object({
  humiditySetpoint: z.number().min(0).max(100).multipleOf(0.1),
  temperatureSetpoint: z.number().min(0).max(50).multipleOf(0.1),
  mode: z.enum(['SMART', 'CONTINUOUS']),
});

function socketValue<T extends object>(connectionId: string, value: T): T & { connectionId: string } {
  return { ...value, connectionId };
}

let mqttManager: MqttConnectionManager;
let topicRouter: TopicRouter;

const deviceRegistry = new DeviceRegistry((config) => new DeviceRuntime({
  config,
  publish: (command) => mqttManager.publish(command.connectionId, command.topic, command.payload),
  onTelemetry(message) {
    persist(repositories.telemetry.save(message.value), `save telemetry for ${message.deviceId}`);
    io.emit('telemetry:update', socketValue(message.connectionId, message.value));
  },
  onStateChanged(message) {
    io.emit('device:status-changed', socketValue(message.connectionId, message.value));
  },
  onCommandUpdate(message) {
    persist(repositories.commands.save(message.value), `save command ${message.value.id}`);
    io.emit('command:update', socketValue(message.connectionId, message.value));
  },
  onEvent(message) {
    persist(repositories.events.save(message.value), `save event ${message.value.id}`);
    io.emit('event:new', socketValue(message.connectionId, message.value));
  },
  commandTimeoutMs: 15_000,
}));

topicRouter = new TopicRouter({
  onTelemetry(message) {
    const runtime = deviceRegistry.get(message.deviceId);
    if (!runtime) throw new Error(`No runtime found for device ${message.deviceId}.`);
    runtime.handleTelemetry(message.telemetry);
  },
  onDeviceResponse(message) {
    const runtime = deviceRegistry.get(message.deviceId);
    if (!runtime) throw new Error(`No runtime found for device ${message.deviceId}.`);
    runtime.handleDeviceResponse(message.response);
  },
  onIgnoredMessage(message) {
    const error = message.error instanceof Error ? `: ${message.error.message}` : '';
    console.warn(`Ignored MQTT message [connection=${message.connectionId}, topic=${message.topic}, reason=${message.reason}]${error}`);
  },
});

mqttManager = new MqttConnectionManager({
  decryptPassword(encryptedPassword) {
    if (!credentialCipher) {
      throw new Error('CONFIG_ENCRYPTION_KEY is required for an MQTT connection that has a password.');
    }
    return credentialCipher.decrypt(encryptedPassword);
  },
  onMessage(connectionId, topic, payload) {
    topicRouter.routeMessage(connectionId, topic, payload);
  },
  onStatusChanged(state) {
    deviceRegistry.setMqttStatus(state.connectionId, state.status);
    io.emit('mqtt:status-changed', state);
  },
});

const runtimeCoordinator = new RuntimeCoordinator({
  mqttConnections: repositories.mqttConnections,
  devices: repositories.devices,
  manager: mqttManager,
  registry: deviceRegistry,
  router: topicRouter,
  onSkippedDevice(device, reason) {
    console.warn(`Skipped device configuration [device=${device.id}]: ${reason}`);
  },
});

const configurationService = new ConfigurationService({
  mqttConnections: repositories.mqttConnections,
  devices: repositories.devices,
  coordinator: runtimeCoordinator,
  manager: mqttManager,
  registry: deviceRegistry,
  cipher: credentialCipher,
});
registerConfigurationRoutes(app, configurationService);
registerExcelExportRoutes(app, new ExcelExportService(repositories));

function aggregateMqttStatus(states: BrokerConnectionState[]): MqttConnectionStatus {
  if (states.length === 0) return 'disconnected';
  if (states.every((state) => state.status === 'connected')) return 'connected';
  if (states.some((state) => state.status === 'error')) return 'error';
  if (states.some((state) => state.status === 'connecting')) return 'connecting';
  return 'disconnected';
}

app.get('/api/health', async (_request, response) => {
  const brokers = mqttManager.getStates();
  const databaseConnected = await repositories.checkHealth();
  const mqttStatus = aggregateMqttStatus(brokers);
  response.json({
    application: 'nhiet-am-mqtt-api',
    mqtt: mqttStatus,
    mqttConnections: brokers,
    devices: {
      configured: deviceRegistry.size,
      online: deviceRegistry.getAllStates().filter((state) => state.connectionStatus === 'ONLINE').length,
    },
    database: databaseConnected ? 'connected' : 'disconnected',
    databaseDriver: env.DATABASE_DRIVER,
    configurationSynchronizedAt: runtimeCoordinator.getSnapshot()?.synchronizedAt ?? null,
    status: mqttStatus === 'connected' && databaseConnected ? 'ok' : 'degraded',
  });
});

app.get('/api/devices/:deviceId/state', (request, response) => {
  const runtime = deviceRegistry.get(request.params.deviceId);
  if (!runtime) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }
  response.json(runtime.getState());
});

app.get('/api/devices/:deviceId/telemetry', async (request, response) => {
  const runtime = deviceRegistry.get(request.params.deviceId);
  if (!runtime) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }
  const requestedHours = Number(request.query.hours ?? 1);
  const hours = [1, 6, 24].includes(requestedHours) ? requestedHours : 1;
  try {
    response.json(await repositories.telemetry.getRange(runtime.getConfig().id, hours));
  } catch (error) {
    console.error('Failed to load telemetry history:', error);
    response.status(503).json({ error: 'Không thể tải dữ liệu lịch sử.' });
  }
});

app.get('/api/devices/:deviceId/commands', async (request, response) => {
  const runtime = deviceRegistry.get(request.params.deviceId);
  if (!runtime) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }
  try {
    response.json(await repositories.commands.getHistory(runtime.getConfig().id, 20));
  } catch (error) {
    console.error('Failed to load command history:', error);
    response.status(503).json({ error: 'Không thể tải nhật ký điều khiển.' });
  }
});

app.get('/api/devices/:deviceId/events', async (request, response) => {
  const runtime = deviceRegistry.get(request.params.deviceId);
  if (!runtime) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }
  try {
    response.json(await repositories.events.getHistory(runtime.getConfig().id, 30));
  } catch (error) {
    console.error('Failed to load event history:', error);
    response.status(503).json({ error: 'Không thể tải nhật ký sự kiện.' });
  }
});

app.post('/api/devices/:deviceId/commands', async (request, response) => {
  const runtime = deviceRegistry.get(request.params.deviceId);
  if (!runtime) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }
  const parsed = settingsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Thông số cài đặt không hợp lệ.', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    response.status(202).json(await runtime.sendSettings(parsed.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể gửi lệnh.';
    const isConflict = message.includes('chờ phản hồi') || message.includes('ngoại tuyến');
    response.status(isConflict ? 409 : 503).json({ error: message });
  }
});

app.post('/api/runtime/refresh', async (_request, response) => {
  try {
    const snapshot = await runtimeCoordinator.refresh();
    response.json({
      connections: snapshot.connections.length,
      devices: snapshot.devices.length,
      skippedDevices: snapshot.skippedDevices.map((device) => device.id),
      synchronizedAt: snapshot.synchronizedAt,
    });
  } catch (error) {
    console.error('Failed to refresh runtime configuration:', error);
    response.status(503).json({ error: 'Không thể đồng bộ cấu hình runtime.' });
  }
});

app.use(excelExportErrorHandler);
app.use(configurationErrorHandler);

io.on('connection', (socket) => {
  const preferred = deviceRegistry.get(env.DEVICE_ID) ?? deviceRegistry.getAll()[0];
  socket.emit('system:ready', {
    connectedAt: new Date().toISOString(),
    state: preferred?.getState() ?? null,
    devices: deviceRegistry.getAll().map((runtime) => ({ ...runtime.getConfig(), state: runtime.getState() })),
    mqttConnections: mqttManager.getStates(),
  });
});

const statusTimer = setInterval(() => deviceRegistry.tickAll(), 5_000).unref();
const configurationTimer = setInterval(() => {
  void runtimeCoordinator.refresh()
    .then((snapshot) => io.emit('runtime:configuration-changed', {
      connections: snapshot.connections.length,
      devices: snapshot.devices.length,
      skippedDevices: snapshot.skippedDevices.map((device) => device.id),
      synchronizedAt: snapshot.synchronizedAt,
    }))
    .catch((error) => console.error('Runtime configuration refresh failed:', error));
}, env.CONFIG_REFRESH_INTERVAL_MS).unref();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down...`);
  clearInterval(statusTimer);
  clearInterval(configurationTimer);
  deviceRegistry.shutdownAll('Backend đang dừng.');

  const results = await Promise.allSettled([
    mqttManager.shutdown(),
    new Promise<void>((resolve, reject) => {
      io.close((error) => error ? reject(error) : resolve());
    }),
    repositories.close(),
  ]);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    console.error('Backend shutdown completed with errors:', failures);
    process.exitCode = 1;
  } else {
    console.log('Backend stopped.');
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

async function start(): Promise<void> {
  try {
    const snapshot = await runtimeCoordinator.refresh();
    console.log(`Runtime initialized with ${snapshot.connections.length} MQTT connection(s) and ${snapshot.devices.length} device(s).`);
    httpServer.listen(env.BACKEND_PORT, () => console.log(`Backend is running at http://localhost:${env.BACKEND_PORT}`));
  } catch (error) {
    console.error('Backend startup failed:', error);
    clearInterval(statusTimer);
    clearInterval(configurationTimer);
    deviceRegistry.shutdownAll('Backend không thể khởi động.');
    await Promise.allSettled([mqttManager.shutdown(), repositories.close()]);
    process.exitCode = 1;
  }
}

void start();
