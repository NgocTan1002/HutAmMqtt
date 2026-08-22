import type {
  CommandRecord,
  Device,
  DevicePayload,
  DeviceState,
  EventRecord,
  HistoryPoint,
  MqttConnection,
  MqttConnectionPayload,
} from './types';

export const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

type ApiErrorBody = { error?: string | { message?: string } };

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as ApiErrorBody;
    if (typeof body.error === 'string') return body.error;
    if (body.error?.message) return body.error.message;
  } catch {
    // The response may be a non-JSON proxy or server error.
  }
  return 'Không thể xử lý yêu cầu.';
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: options?.body
      ? { 'Content-Type': 'application/json', ...options.headers }
      : options?.headers,
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  getDevices: () => request<Device[]>('/api/devices'),
  getDeviceState: (id: string) => request<DeviceState>(`/api/devices/${encodeURIComponent(id)}/state`),
  getTelemetry: (id: string, hours: number) => request<HistoryPoint[]>(`/api/devices/${encodeURIComponent(id)}/telemetry?hours=${hours}`),
  getCommands: (id: string) => request<CommandRecord[]>(`/api/devices/${encodeURIComponent(id)}/commands`),
  getEvents: (id: string) => request<EventRecord[]>(`/api/devices/${encodeURIComponent(id)}/events`),
  sendSettings: (id: string, body: { humiditySetpoint: number; temperatureSetpoint: number; mode: 'SMART' | 'CONTINUOUS' }) =>
    request<CommandRecord>(`/api/devices/${encodeURIComponent(id)}/commands`, { method: 'POST', body: JSON.stringify(body) }),

  getMqttConnections: () => request<MqttConnection[]>('/api/mqtt-connections'),
  createMqttConnection: (body: MqttConnectionPayload) => request<MqttConnection>('/api/mqtt-connections', { method: 'POST', body: JSON.stringify(body) }),
  updateMqttConnection: (id: string, body: Partial<MqttConnectionPayload>) => request<MqttConnection>(`/api/mqtt-connections/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteMqttConnection: (id: string) => request<void>(`/api/mqtt-connections/${id}`, { method: 'DELETE' }),
  testMqttConnection: (body: Omit<MqttConnectionPayload, 'enabled'>) => request<{ success: true; durationMs: number }>('/api/mqtt-connections/test', { method: 'POST', body: JSON.stringify(body) }),
  testStoredMqttConnection: (id: string) => request<{ success: true; durationMs: number }>(`/api/mqtt-connections/${id}/test`, { method: 'POST' }),
  reconnectMqttConnection: (id: string) => request<MqttConnection>(`/api/mqtt-connections/${id}/reconnect`, { method: 'POST' }),

  createDevice: (body: DevicePayload) => request<Device>('/api/devices', { method: 'POST', body: JSON.stringify(body) }),
  updateDevice: (id: string, body: Partial<Omit<DevicePayload, 'id'>>) => request<Device>(`/api/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteDevice: (id: string) => request<void>(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  exportDeviceExcel: async (id: string, options: { from: string; to: string; includeCommands: boolean; includeEvents: boolean }) => {
    const query = new URLSearchParams({
      from: options.from,
      to: options.to,
      includeCommands: String(options.includeCommands),
      includeEvents: String(options.includeEvents),
    });
    const response = await fetch(`${apiUrl}/api/devices/${encodeURIComponent(id)}/export/excel?${query}`);
    if (!response.ok) throw new Error(await errorMessage(response));
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `${id}_du-lieu.xlsx`;
    return { blob: await response.blob(), filename };
  },
};
