import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api, apiUrl } from '../api';
import type {
  CommandRecord,
  DeviceState,
  EventRecord,
  HistoryPoint,
  ServerStatus,
  Telemetry,
} from '../types';

function emptyState(deviceId: string): DeviceState {
  return {
    deviceId,
    mqttStatus: 'connecting',
    connectionStatus: 'OFFLINE',
    lastSeenAt: null,
    telemetry: null,
  };
}

export function useDeviceDashboard(deviceId: string | null, historyRange: 1 | 6 | 24) {
  const [deviceState, setDeviceState] = useState<DeviceState>(() => emptyState(deviceId ?? ''));
  const [serverStatus, setServerStatus] = useState<ServerStatus>('connecting');
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCurrentDevice = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const [state, commandHistory, eventHistory] = await Promise.all([
        api.getDeviceState(deviceId),
        api.getCommands(deviceId),
        api.getEvents(deviceId),
      ]);
      setDeviceState(state);
      setCommands(commandHistory);
      setEvents(eventHistory);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Không thể tải dữ liệu thiết bị.');
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    setDeviceState(emptyState(deviceId ?? ''));
    setHistory([]);
    setCommands([]);
    setEvents([]);
    setErrorMessage(null);
    if (!deviceId) return;
    void loadCurrentDevice();

    const socket = io(apiUrl, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      setServerStatus('connected');
      setErrorMessage(null);
      void loadCurrentDevice();
    });
    socket.on('disconnect', () => setServerStatus('disconnected'));
    socket.on('connect_error', () => {
      setServerStatus('disconnected');
      setErrorMessage('Mất kết nối với máy chủ realtime.');
    });
    socket.on('device:status-changed', (state: DeviceState) => {
      if (state.deviceId === deviceId) setDeviceState(state);
    });
    socket.on('telemetry:update', (telemetry: Telemetry) => {
      if (telemetry.deviceId !== deviceId) return;
      setDeviceState((current) => ({
        ...current,
        connectionStatus: 'ONLINE',
        lastSeenAt: telemetry.receivedAt,
        telemetry,
      }));
      setHistory((current) => [...current.slice(-239), telemetry]);
    });
    socket.on('command:update', (command: CommandRecord) => {
      if (command.deviceId !== deviceId) return;
      setCommands((current) => [command, ...current.filter((item) => item.id !== command.id)].slice(0, 20));
    });
    socket.on('event:new', (event: EventRecord) => {
      if (event.deviceId !== deviceId) return;
      setEvents((current) => [event, ...current].slice(0, 30));
    });
    return () => { socket.disconnect(); };
  }, [deviceId, loadCurrentDevice]);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    void api.getTelemetry(deviceId, historyRange)
      .then((points) => { if (!cancelled) setHistory(points); })
      .catch((error) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : 'Không thể tải dữ liệu lịch sử.');
      });
    return () => { cancelled = true; };
  }, [deviceId, historyRange]);

  return {
    deviceState,
    serverStatus,
    history,
    commands,
    events,
    errorMessage,
    loading,
    setCommands,
    setErrorMessage,
  };
}
