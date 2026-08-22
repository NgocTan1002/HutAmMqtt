import type { DeviceConfig } from '../configuration/configuration-types.js';
import { parseTelemetry, type Telemetry } from './telemetry-schema.js';

export type RoutedTelemetryMessage = {
  connectionId: string;
  deviceId: string;
  topic: string;
  telemetry: Telemetry;
};

export type RoutedDeviceResponse = {
  connectionId: string;
  deviceId: string;
  topic: string;
  response: string;
};

export type IgnoredMessageReason =
  | 'unknown-topic'
  | 'invalid-telemetry'
  | 'unsupported-payload'
  | 'handler-error';

export type IgnoredMqttMessage = {
  connectionId: string;
  topic: string;
  deviceId?: string;
  reason: IgnoredMessageReason;
  error?: unknown;
};

export type TopicRouterHandlers = {
  onTelemetry(message: RoutedTelemetryMessage): void;
  onDeviceResponse(message: RoutedDeviceResponse): void;
  onIgnoredMessage?(message: IgnoredMqttMessage): void;
};

type RegisteredRoute = {
  connectionId: string;
  deviceId: string;
  topic: string;
  acceptsTelemetry: boolean;
  acceptsResponse: boolean;
};

type DeviceRouteReference = {
  connectionId: string;
  topic: string;
};

export class TopicRouteConflictError extends Error {
  public constructor(
    public readonly connectionId: string,
    public readonly topic: string,
    public readonly existingDeviceId: string,
    public readonly requestedDeviceId: string,
  ) {
    super(
      `MQTT topic conflict on connection ${connectionId}: ${topic} is already assigned to device ${existingDeviceId}.`,
    );
    this.name = 'TopicRouteConflictError';
  }
}

export class TopicRouter {
  private readonly routesByConnection = new Map<string, Map<string, RegisteredRoute>>();
  private readonly routeReferencesByDevice = new Map<string, DeviceRouteReference[]>();

  public constructor(private readonly handlers: TopicRouterHandlers) {}

  public registerDevice(device: DeviceConfig): void {
    if (!device.enabled) {
      this.unregisterDevice(device.id);
      return;
    }

    const desiredRoutes = this.createDesiredRoutes(device);
    const connectionRoutes = this.routesByConnection.get(device.mqttConnectionId);

    for (const route of desiredRoutes.values()) {
      const existing = connectionRoutes?.get(route.topic);
      if (existing && existing.deviceId !== device.id) {
        throw new TopicRouteConflictError(
          route.connectionId,
          route.topic,
          existing.deviceId,
          device.id,
        );
      }
    }

    // Validation happens before mutation, so a rejected update keeps the old routes intact.
    this.unregisterDevice(device.id);
    const targetRoutes = this.getOrCreateConnectionRoutes(device.mqttConnectionId);
    const references: DeviceRouteReference[] = [];

    for (const route of desiredRoutes.values()) {
      targetRoutes.set(route.topic, route);
      references.push({ connectionId: route.connectionId, topic: route.topic });
    }
    this.routeReferencesByDevice.set(device.id, references);
  }

  public unregisterDevice(deviceId: string): void {
    const references = this.routeReferencesByDevice.get(deviceId);
    if (!references) return;

    for (const reference of references) {
      const connectionRoutes = this.routesByConnection.get(reference.connectionId);
      const route = connectionRoutes?.get(reference.topic);
      if (route?.deviceId === deviceId) connectionRoutes?.delete(reference.topic);
      if (connectionRoutes?.size === 0) this.routesByConnection.delete(reference.connectionId);
    }
    this.routeReferencesByDevice.delete(deviceId);
  }

  public unregisterConnection(connectionId: string): void {
    const connectionRoutes = this.routesByConnection.get(connectionId);
    if (!connectionRoutes) return;

    const affectedDevices = new Set([...connectionRoutes.values()].map((route) => route.deviceId));
    this.routesByConnection.delete(connectionId);

    for (const deviceId of affectedDevices) {
      const remaining = (this.routeReferencesByDevice.get(deviceId) ?? []).filter(
        (reference) => reference.connectionId !== connectionId,
      );
      if (remaining.length === 0) this.routeReferencesByDevice.delete(deviceId);
      else this.routeReferencesByDevice.set(deviceId, remaining);
    }
  }

  public getSubscriptions(connectionId: string): string[] {
    return [...(this.routesByConnection.get(connectionId)?.keys() ?? [])].sort();
  }

  public routeMessage(connectionId: string, topic: string, payload: Buffer, receivedAt = new Date()): boolean {
    const route = this.routesByConnection.get(connectionId)?.get(topic);
    if (!route) {
      this.ignore({ connectionId, topic, reason: 'unknown-topic' });
      return false;
    }

    const rawText = payload.toString('utf8').trim();
    if (route.acceptsTelemetry && rawText.startsWith('{')) {
      let telemetry: Telemetry;
      try {
        telemetry = parseTelemetry(payload, route.deviceId, receivedAt);
      } catch (error) {
        this.ignore({ connectionId, topic, deviceId: route.deviceId, reason: 'invalid-telemetry', error });
        return false;
      }

      try {
        this.handlers.onTelemetry({ connectionId, deviceId: route.deviceId, topic, telemetry });
        return true;
      } catch (error) {
        this.ignore({ connectionId, topic, deviceId: route.deviceId, reason: 'handler-error', error });
        return false;
      }
    }

    if (route.acceptsResponse && (rawText.startsWith('Da Nhan') || rawText.startsWith('Loi'))) {
      try {
        this.handlers.onDeviceResponse({
          connectionId,
          deviceId: route.deviceId,
          topic,
          response: rawText,
        });
        return true;
      } catch (error) {
        this.ignore({ connectionId, topic, deviceId: route.deviceId, reason: 'handler-error', error });
        return false;
      }
    }

    this.ignore({ connectionId, topic, deviceId: route.deviceId, reason: 'unsupported-payload' });
    return false;
  }

  private createDesiredRoutes(device: DeviceConfig): Map<string, RegisteredRoute> {
    const routes = new Map<string, RegisteredRoute>();
    const addRoute = (topic: string, messageType: 'telemetry' | 'response') => {
      const normalizedTopic = topic.trim();
      if (!normalizedTopic) throw new Error(`Device ${device.id} has an empty ${messageType} topic.`);

      const route = routes.get(normalizedTopic) ?? {
        connectionId: device.mqttConnectionId,
        deviceId: device.id,
        topic: normalizedTopic,
        acceptsTelemetry: false,
        acceptsResponse: false,
      };
      if (messageType === 'telemetry') route.acceptsTelemetry = true;
      else route.acceptsResponse = true;
      routes.set(normalizedTopic, route);
    };

    addRoute(device.telemetryTopic, 'telemetry');
    addRoute(device.responseTopic, 'response');
    return routes;
  }

  private getOrCreateConnectionRoutes(connectionId: string): Map<string, RegisteredRoute> {
    const existing = this.routesByConnection.get(connectionId);
    if (existing) return existing;
    const created = new Map<string, RegisteredRoute>();
    this.routesByConnection.set(connectionId, created);
    return created;
  }

  private ignore(message: IgnoredMqttMessage): void {
    this.handlers.onIgnoredMessage?.(message);
  }
}
