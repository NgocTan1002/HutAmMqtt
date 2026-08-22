import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceConfig } from '../configuration/configuration-types.js';
import {
  TopicRouteConflictError,
  TopicRouter,
  type IgnoredMqttMessage,
  type RoutedDeviceResponse,
  type RoutedTelemetryMessage,
} from './topic-router.js';

function device(overrides: Partial<DeviceConfig> = {}): DeviceConfig {
  return {
    id: 'device-1',
    name: 'Device 1',
    mqttConnectionId: 'connection-1',
    telemetryTopic: 'device-1/nhan',
    commandTopic: 'device-1/caidat',
    responseTopic: 'device-1/response',
    offlineAfterSeconds: 20,
    enabled: true,
    ...overrides,
  };
}

function telemetryPayload(temperature = 27.7): Buffer {
  return Buffer.from(JSON.stringify({
    Tdo: temperature,
    Hdo: 60.5,
    Tgian: 19.4,
    NguongAmSmt: 60,
    NguongNhietCON: 30,
    'Running Status': 'SYS_RUNNING',
    'Running Mode': 'SMART',
    'Water Tank Status': 'OK',
    'Sensor Error': 0,
    'Loc Status': 0,
    'Fan Status': 1,
    'Heater Status': 0,
  }));
}

function createRecorder() {
  const telemetry: RoutedTelemetryMessage[] = [];
  const responses: RoutedDeviceResponse[] = [];
  const ignored: IgnoredMqttMessage[] = [];
  const router = new TopicRouter({
    onTelemetry: (message) => telemetry.push(message),
    onDeviceResponse: (message) => responses.push(message),
    onIgnoredMessage: (message) => ignored.push(message),
  });
  return { router, telemetry, responses, ignored };
}

test('TopicRouter distinguishes identical topics on different MQTT connections', () => {
  const recorder = createRecorder();
  recorder.router.registerDevice(device({
    id: 'device-a',
    mqttConnectionId: 'connection-a',
    telemetryTopic: 'shared/nhan',
    responseTopic: 'shared/response',
  }));
  recorder.router.registerDevice(device({
    id: 'device-b',
    mqttConnectionId: 'connection-b',
    telemetryTopic: 'shared/nhan',
    responseTopic: 'shared/response',
  }));

  assert.equal(recorder.router.routeMessage('connection-a', 'shared/nhan', telemetryPayload(21)), true);
  assert.equal(recorder.router.routeMessage('connection-b', 'shared/nhan', telemetryPayload(29)), true);
  assert.deepEqual(recorder.telemetry.map((message) => [message.connectionId, message.deviceId, message.telemetry.temperature]), [
    ['connection-a', 'device-a', 21],
    ['connection-b', 'device-b', 29],
  ]);
});

test('TopicRouter handles telemetry and device responses on one shared topic', () => {
  const recorder = createRecorder();
  const receivedAt = new Date('2026-08-20T08:00:00.000Z');
  recorder.router.registerDevice(device({ telemetryTopic: 'device-1/nhan', responseTopic: 'device-1/nhan' }));

  assert.deepEqual(recorder.router.getSubscriptions('connection-1'), ['device-1/nhan']);
  assert.equal(recorder.router.routeMessage('connection-1', 'device-1/nhan', telemetryPayload(), receivedAt), true);
  assert.equal(recorder.router.routeMessage('connection-1', 'device-1/nhan', Buffer.from('Da Nhan cai dat')), true);
  assert.equal(recorder.telemetry[0].telemetry.receivedAt, receivedAt.toISOString());
  assert.equal(recorder.telemetry[0].telemetry.filterStatus, 0);
  assert.equal(recorder.telemetry[0].telemetry.fanStatus, 1);
  assert.equal(recorder.telemetry[0].telemetry.heaterStatus, 0);
  assert.equal(recorder.responses[0].deviceId, 'device-1');
  assert.equal(recorder.responses[0].response, 'Da Nhan cai dat');
});

test('TopicRouter normalizes the device legacy payload and reads component statuses', () => {
  const recorder = createRecorder();
  recorder.router.registerDevice(device());
  const payload = Buffer.from('{"Tdo":28.3,"Hdo":86.2,"Tgian":26.3,"NguongAmSmt":88.0,"NguongNhietCON":13.4,"Running Status":SYS_RUNNING,"Running Mode":SMART,"Water Tank Status":OK,"Sensor Error":0,"Loc Status":0,"Fan Status":1,"Heater Status":0}');

  assert.equal(recorder.router.routeMessage('connection-1', 'device-1/nhan', payload), true);
  assert.equal(recorder.telemetry[0].telemetry.filterStatus, 0);
  assert.equal(recorder.telemetry[0].telemetry.fanStatus, 1);
  assert.equal(recorder.telemetry[0].telemetry.heaterStatus, 0);
});

test('TopicRouter rejects a component status outside 0 and 1', () => {
  const recorder = createRecorder();
  recorder.router.registerDevice(device());
  const invalidPayload = JSON.parse(telemetryPayload().toString('utf8')) as Record<string, unknown>;
  invalidPayload['Fan Status'] = 2;

  assert.equal(recorder.router.routeMessage('connection-1', 'device-1/nhan', Buffer.from(JSON.stringify(invalidPayload))), false);
  assert.equal(recorder.ignored[0].reason, 'invalid-telemetry');
});

test('TopicRouter rejects receive-topic conflicts between devices on one connection', () => {
  const recorder = createRecorder();
  recorder.router.registerDevice(device({
    id: 'device-a',
    telemetryTopic: 'device-a/nhan',
    responseTopic: 'shared/topic',
  }));

  assert.throws(
    () => recorder.router.registerDevice(device({
      id: 'device-b',
      telemetryTopic: 'shared/topic',
      responseTopic: 'device-b/response',
    })),
    (error) => error instanceof TopicRouteConflictError
      && error.connectionId === 'connection-1'
      && error.topic === 'shared/topic'
      && error.existingDeviceId === 'device-a'
      && error.requestedDeviceId === 'device-b',
  );

  assert.equal(recorder.router.routeMessage('connection-1', 'shared/topic', Buffer.from('Da Nhan')), true);
  assert.equal(recorder.responses[0].deviceId, 'device-a');
});

test('TopicRouter updates and removes device routes without leaving stale subscriptions', () => {
  const recorder = createRecorder();
  recorder.router.registerDevice(device());
  recorder.router.registerDevice(device({
    telemetryTopic: 'device-1/new-telemetry',
    responseTopic: 'device-1/new-response',
  }));

  assert.deepEqual(recorder.router.getSubscriptions('connection-1'), [
    'device-1/new-response',
    'device-1/new-telemetry',
  ]);
  assert.equal(recorder.router.routeMessage('connection-1', 'device-1/nhan', telemetryPayload()), false);
  assert.equal(recorder.router.routeMessage('connection-1', 'device-1/new-telemetry', telemetryPayload()), true);

  recorder.router.registerDevice(device({ enabled: false }));
  assert.deepEqual(recorder.router.getSubscriptions('connection-1'), []);
  assert.equal(recorder.router.routeMessage('connection-1', 'device-1/new-telemetry', telemetryPayload()), false);
});

test('TopicRouter reports invalid, unsupported and unknown messages without throwing', () => {
  const recorder = createRecorder();
  recorder.router.registerDevice(device());

  assert.equal(recorder.router.routeMessage('connection-1', 'device-1/nhan', Buffer.from('{invalid')), false);
  assert.equal(recorder.router.routeMessage('connection-1', 'device-1/response', Buffer.from('other response')), false);
  assert.equal(recorder.router.routeMessage('connection-1', 'unknown/topic', telemetryPayload()), false);
  assert.deepEqual(recorder.ignored.map((message) => message.reason), [
    'invalid-telemetry',
    'unsupported-payload',
    'unknown-topic',
  ]);
});

test('TopicRouter contains handler failures so one message cannot crash MQTT dispatch', () => {
  const ignored: IgnoredMqttMessage[] = [];
  const router = new TopicRouter({
    onTelemetry() {
      throw new Error('device handler failed');
    },
    onDeviceResponse() {},
    onIgnoredMessage: (message) => ignored.push(message),
  });
  router.registerDevice(device());

  assert.equal(router.routeMessage('connection-1', 'device-1/nhan', telemetryPayload()), false);
  assert.equal(ignored[0].reason, 'handler-error');
  assert.match((ignored[0].error as Error).message, /device handler failed/);
});

test('TopicRouter validates an update before removing the previous valid routes', () => {
  const recorder = createRecorder();
  recorder.router.registerDevice(device({ id: 'device-a', telemetryTopic: 'device-a/old', responseTopic: 'device-a/response' }));
  recorder.router.registerDevice(device({ id: 'device-b', telemetryTopic: 'device-b/topic', responseTopic: 'device-b/response' }));

  assert.throws(() => recorder.router.registerDevice(device({
    id: 'device-a',
    telemetryTopic: 'device-b/topic',
    responseTopic: 'device-a/new-response',
  })), TopicRouteConflictError);

  assert.equal(recorder.router.routeMessage('connection-1', 'device-a/old', telemetryPayload()), true);
  assert.equal(recorder.telemetry[0].deviceId, 'device-a');
});

test('TopicRouter removes one connection without affecting routes on another connection', () => {
  const recorder = createRecorder();
  recorder.router.registerDevice(device({ id: 'device-a', mqttConnectionId: 'connection-a' }));
  recorder.router.registerDevice(device({
    id: 'device-b',
    mqttConnectionId: 'connection-b',
    telemetryTopic: 'device-b/nhan',
    responseTopic: 'device-b/response',
  }));

  recorder.router.unregisterConnection('connection-a');

  assert.deepEqual(recorder.router.getSubscriptions('connection-a'), []);
  assert.equal(recorder.router.routeMessage('connection-a', 'device-1/nhan', telemetryPayload()), false);
  assert.equal(recorder.router.routeMessage('connection-b', 'device-b/nhan', telemetryPayload()), true);
  assert.equal(recorder.telemetry[0].deviceId, 'device-b');
});
