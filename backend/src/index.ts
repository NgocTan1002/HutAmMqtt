import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { CommandService } from './commands/command-service.js';
import { env } from './config/env.js';
import { getCommandHistory, getEventHistory, getTelemetryRange, saveCommand, saveEvent, saveTelemetry } from './database/database.js';
import { EventService } from './events/event-service.js';
import { startMqttBridge } from './mqtt/mqtt-client.js';
import { DeviceStateStore } from './state/device-state.js';

const app = express();
const httpServer = createServer(app);
const stateStore = new DeviceStateStore(env.DEVICE_ID, env.DEVICE_OFFLINE_AFTER_SECONDS);

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

app.get('/api/health', (_request, response) => {
  const state = stateStore.getState();
  response.json({
    application: 'nhiet-am-mqtt-api',
    mqtt: state.mqttStatus,
    database: 'connected',
    status: state.mqttStatus === 'connected' ? 'ok' : 'degraded',
  });
});

app.get('/api/devices/:deviceId/state', (request, response) => {
  if (request.params.deviceId !== env.DEVICE_ID) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }

  response.json(stateStore.getState());
});

app.get('/api/devices/:deviceId/telemetry', (request, response) => {
  if (request.params.deviceId !== env.DEVICE_ID) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }
  const requestedHours = Number(request.query.hours ?? 1);
  const hours = [1, 6, 24].includes(requestedHours) ? requestedHours : 1;
  response.json(getTelemetryRange(env.DEVICE_ID, hours));
});

app.get('/api/devices/:deviceId/commands', (request, response) => {
  if (request.params.deviceId !== env.DEVICE_ID) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }
  response.json(getCommandHistory(env.DEVICE_ID, 20));
});

app.get('/api/devices/:deviceId/events', (request, response) => {
  if (request.params.deviceId !== env.DEVICE_ID) {
    response.status(404).json({ error: 'Device not found.' });
    return;
  }
  response.json(getEventHistory(env.DEVICE_ID, 30));
});

io.on('connection', (socket) => {
  socket.emit('system:ready', { connectedAt: new Date().toISOString(), state: stateStore.getState() });
});

let commandService: CommandService | undefined;

const eventService = new EventService(env.DEVICE_ID, (event) => {
  saveEvent(event);
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
    saveTelemetry(telemetry);
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
    saveCommand(command);
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

setInterval(() => {
  const state = stateStore.getState();
  eventService.handleState(state);
  io.emit('device:status-changed', state);
}, 5_000).unref();

httpServer.listen(env.BACKEND_PORT, () => {
  console.log(`Backend is running at http://localhost:${env.BACKEND_PORT}`);
});
