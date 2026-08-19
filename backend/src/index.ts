import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { CommandService } from './commands/command-service.js';
import { env } from './config/env.js';
import { createRepositories } from './database/database.js';
import { EventService } from './events/event-service.js';
import { startMqttBridge } from './mqtt/mqtt-client.js';
import { DeviceStateStore } from './state/device-state.js';

const app = express();
const httpServer = createServer(app);
const stateStore = new DeviceStateStore(env.DEVICE_ID, env.DEVICE_OFFLINE_AFTER_SECONDS);
const repositories = createRepositories();

function persist(operation: Promise<void>, context: string): void {
  void operation.catch((error) => {
    console.error(`Database operation failed (${context}):`, error);
  });
}

const io = new Server(httpServer, {
  cors: {
    origin: `http://localhost:${env.FRONTEND_PORT}`,
  },
});

app.use(cors({ origin: `http://localhost:${env.FRONTEND_PORT}` }));
app.use(express.json());

const settingsSchema = z.object({
  humiditySetpoint: z.number().min(0).max(100).multipleOf(0.1),
  temperatureSetpoint: z.number().min(0).max(50).multipleOf(0.1),
  mode: z.enum(['SMART', 'CONTINUOUS']),
});

app.get('/api/health', async (_request, response) => {
  const state = stateStore.getState();
  const databaseConnected = await repositories.checkHealth();
  response.json({
    application: 'nhiet-am-mqtt-api',
    mqtt: state.mqttStatus,
    database: databaseConnected ? 'connected' : 'disconnected',
    databaseDriver: env.DATABASE_DRIVER,
    status: state.mqttStatus === 'connected' && databaseConnected ? 'ok' : 'degraded',
  });
});

app.get('/api/devices/:deviceId/state', (request, response) => {
  if (request.params.deviceId !== env.DEVICE_ID) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }

  response.json(stateStore.getState());
});

app.get('/api/devices/:deviceId/telemetry', async (request, response) => {
  if (request.params.deviceId !== env.DEVICE_ID) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }
  const requestedHours = Number(request.query.hours ?? 1);
  const hours = [1, 6, 24].includes(requestedHours) ? requestedHours : 1;
  try {
    response.json(await repositories.telemetry.getRange(env.DEVICE_ID, hours));
  } catch (error) {
    console.error('Failed to load telemetry history:', error);
    response.status(503).json({ error: 'Không thể tải dữ liệu lịch sử.' });
  }
});

app.get('/api/devices/:deviceId/commands', async (request, response) => {
  if (request.params.deviceId !== env.DEVICE_ID) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }
  try {
    response.json(await repositories.commands.getHistory(env.DEVICE_ID, 20));
  } catch (error) {
    console.error('Failed to load command history:', error);
    response.status(503).json({ error: 'Không thể tải nhật ký điều khiển.' });
  }
});

app.get('/api/devices/:deviceId/events', async (request, response) => {
  if (request.params.deviceId !== env.DEVICE_ID) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }
  try {
    response.json(await repositories.events.getHistory(env.DEVICE_ID, 30));
  } catch (error) {
    console.error('Failed to load event history:', error);
    response.status(503).json({ error: 'Không thể tải nhật ký sự kiện.' });
  }
});

io.on('connection', (socket) => {
  socket.emit('system:ready', { connectedAt: new Date().toISOString(), state: stateStore.getState() });
});

let commandService: CommandService | undefined;

const eventService = new EventService(env.DEVICE_ID, (event) => {
  persist(repositories.events.save(event), `save event ${event.id}`);
  io.emit('event:new', event);
});

const mqttClient = startMqttBridge(env, {
  onConnectionStatus(status) {
    stateStore.setMqttStatus(status);
    io.emit('device:status-changed', stateStore.getState());
  },
  onDeviceResponse(deviceResponse) {
    commandService?.handleDeviceResponse(deviceResponse);
  },
  onTelemetry(telemetry) {
    persist(repositories.telemetry.save(telemetry), `save telemetry for ${telemetry.deviceId}`);
    const state = stateStore.updateTelemetry(telemetry);
    eventService.handleState(state);
    commandService?.handleTelemetry(telemetry);
    io.emit('telemetry:update', telemetry);
    io.emit('device:status-changed', state);
  },
});

commandService = new CommandService({
  deviceId: env.DEVICE_ID,
  async publish(payload) {
    if (!mqttClient.connected) throw new Error('MQTT broker chưa kết nối.');
    await new Promise<void>((resolve, reject) => {
      mqttClient.publish(env.MQTT_COMMAND_TOPIC, payload, { qos: 0 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  },
  onUpdate(command) {
    persist(repositories.commands.save(command), `save command ${command.id}`);
    io.emit('command:update', command);
  },
  timeoutMs: 15_000,
});

app.post('/api/devices/:deviceId/commands', async (request, response) => {
  if (request.params.deviceId !== env.DEVICE_ID) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }
  const parsed = settingsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Thông số cài đặt không hợp lệ.', details: parsed.error.flatten().fieldErrors });
    return;
  }
  if (stateStore.getState().connectionStatus !== 'ONLINE') {
    response.status(409).json({ error: 'Thiết bị đang ngoại tuyến, không thể gửi lệnh.' });
    return;
  }
  try {
    const command = await commandService.sendSettings(parsed.data);
    response.status(202).json(command);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể gửi lệnh.';
    response.status(message.includes('chờ phản hồi') ? 409 : 503).json({ error: message });
  }
});

const statusTimer = setInterval(() => {
  const state = stateStore.getState();
  eventService.handleState(state);
  io.emit('device:status-changed', state);
}, 5_000).unref();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down...`);
  clearInterval(statusTimer);

  const results = await Promise.allSettled([
    new Promise<void>((resolve, reject) => {
      mqttClient.end(true, {}, (error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
    new Promise<void>((resolve, reject) => {
      io.close((error) => {
        if (error) reject(error);
        else resolve();
      });
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

httpServer.listen(env.BACKEND_PORT, () => {
  console.log(`Backend is running at http://localhost:${env.BACKEND_PORT}`);
});
