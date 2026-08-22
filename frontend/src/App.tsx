import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api, apiUrl } from './api';
import { AppShell, type AppPage } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { DevicesPage } from './pages/DevicesPage';
import type { Device } from './types';

const selectedDeviceStorageKey = 'nhiet-am-mqtt:selected-device';

function App() {
  const [page, setPage] = useState<AppPage>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(
    () => window.localStorage.getItem(selectedDeviceStorageKey),
  );

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const allDevices = await api.getDevices();
      const enabledDevices = allDevices.filter((device) => device.enabled);
      setDevices(enabledDevices);
      setDevicesError(null);
      setSelectedDeviceId((current) => {
        const next = enabledDevices.some((device) => device.id === current)
          ? current
          : enabledDevices[0]?.id ?? null;
        if (next) window.localStorage.setItem(selectedDeviceStorageKey, next);
        else window.localStorage.removeItem(selectedDeviceStorageKey);
        return next;
      });
    } catch (error) {
      setDevicesError(error instanceof Error ? error.message : 'Không thể tải danh sách thiết bị.');
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDevices();
    const socket = io(apiUrl, { transports: ['websocket', 'polling'] });
    socket.on('runtime:configuration-changed', () => void loadDevices());
    return () => { socket.disconnect(); };
  }, [loadDevices]);

  const selectDevice = (id: string) => {
    setSelectedDeviceId(id);
    window.localStorage.setItem(selectedDeviceStorageKey, id);
  };

  return (
    <AppShell
      collapsed={sidebarCollapsed}
      onNavigate={(nextPage) => { setPage(nextPage); window.scrollTo({ top: 0 }); }}
      onToggle={() => setSidebarCollapsed((current) => !current)}
      page={page}
    >
      {page === 'dashboard' && <DashboardPage catalogError={devicesError} catalogLoading={devicesLoading} devices={devices} onSelectDevice={selectDevice} selectedDeviceId={selectedDeviceId} />}
      {page === 'devices' && <DevicesPage onChanged={() => void loadDevices()} />}
    </AppShell>
  );
}

export default App;
