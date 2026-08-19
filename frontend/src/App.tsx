import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import logoUrl from '../../favicon.svg';

type Telemetry = {
  deviceId: string;
  temperature: number;
  humidity: number;
  coilTemperature: number;
  humiditySetpoint: number;
  temperatureSetpoint: number;
  runningStatus: string;
  runningMode: string;
  waterTankStatus: string;
  sensorError: number;
  receivedAt: string;
};

type DeviceState = {
  deviceId: string;
  mqttStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  connectionStatus: 'ONLINE' | 'OFFLINE';
  lastSeenAt: string | null;
  telemetry: Telemetry | null;
};

type HistoryPoint = Omit<Telemetry, 'deviceId'>;

type CommandRecord = {
  id: string;
  deviceId: string;
  mqttPayload: string;
  status: 'pending' | 'success' | 'error' | 'timeout';
  response?: string;
  createdAt: string;
  completedAt?: string;
};

type EventRecord = {
  id: string;
  deviceId: string;
  type: string;
  severity: 'info' | 'warning' | 'danger';
  message: string;
  createdAt: string;
};

type ServerStatus = 'connecting' | 'connected' | 'disconnected';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const emptyState: DeviceState = {
  deviceId: 'mayhutam1',
  mqttStatus: 'connecting',
  connectionStatus: 'OFFLINE',
  lastSeenAt: null,
  telemetry: null,
};

function formatNumber(value: number | undefined) {
  return value === undefined ? '--' : value.toFixed(1);
}

function formatTime(value: string | null) {
  if (!value) return 'Chưa có dữ liệu';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(value));
}

function formatRelativeTime(value: string | null, now = Date.now()) {
  if (!value) return 'chưa nhận dữ liệu';
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds} giây trước`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  return `${Math.floor(minutes / 60)} giờ trước`;
}

function RelativeTime({ value }: { value: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [value]);

  return <>{formatRelativeTime(value, now)}</>;
}

function modeLabel(value?: string) {
  if (value === 'SMART') return 'Thông minh';
  if (value === 'CONTINUOUS') return 'Liên tục';
  return value ?? '--';
}

function statusLabel(value?: string) {
  const labels: Record<string, string> = {
    SYS_INIT: 'Đang khởi tạo', SYS_RUNNING: 'Đang vận hành', SYS_DEFROST: 'Đang xả đá', SYS_ERROR: 'Lỗi hệ thống',
  };
  return value ? (labels[value] ?? value) : '--';
}

function commandStatusLabel(status: CommandRecord['status']) {
  return { pending: 'Đang chờ', success: 'Thành công', error: 'Thiết bị báo lỗi', timeout: 'Hết thời gian chờ' }[status];
}

function parseCommandPayload(payload: string) {
  const humidity = payload.match(/SH=([-\d.]+)/)?.[1];
  const temperature = payload.match(/ST=([-\d.]+)/)?.[1];
  const mode = payload.match(/MD=(\d+)/)?.[1];
  if (!humidity || !temperature || mode === undefined) return null;
  return { humidity, temperature, mode: mode === '0' ? 'Thông minh' : 'Liên tục' };
}

function TrendLine({
  label, unit, color, values, setpoint, timestamps,
}: {
  label: string;
  unit: string;
  color: string;
  values: number[];
  setpoint?: number;
  timestamps: string[];
}) {
  const width = 760;
  const height = 112;
  const plotLeft = 54;
  const plotRight = 742;
  const plotTop = 13;
  const plotBottom = 82;
  const rangeValues = setpoint === undefined ? values : [...values, setpoint];
  const rawMin = Math.min(...rangeValues);
  const rawMax = Math.max(...rangeValues);
  const padding = Math.max((rawMax - rawMin) * 0.18, unit === '%RH' ? 1 : 0.5);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const x = (index: number) => plotLeft + (index / Math.max(values.length - 1, 1)) * (plotRight - plotLeft);
  const y = (value: number) => plotBottom - ((value - min) / Math.max(max - min, 1)) * (plotBottom - plotTop);
  const path = values.map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
  const startTime = timestamps[0] ? new Date(timestamps[0]).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
  const endTime = timestamps.at(-1) ? new Date(timestamps.at(-1) as string).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="trend-line">
      <div className="trend-title"><span className="trend-color" style={{ background: color }} />{label}<strong>{values.at(-1)?.toFixed(1)} {unit}</strong></div>
      <svg aria-label={`Biểu đồ ${label.toLowerCase()}`} role="img" viewBox={`0 0 ${width} ${height}`}>
        {[plotTop, (plotTop + plotBottom) / 2, plotBottom].map((gridY) => <line className="trend-grid" key={gridY} x1={plotLeft} x2={plotRight} y1={gridY} y2={gridY} />)}
        {setpoint !== undefined && <line className="setpoint-line" x1={plotLeft} x2={plotRight} y1={y(setpoint)} y2={y(setpoint)} />}
        <path className="trend-path" d={path} style={{ stroke: color }} />
        <text className="axis-label" x="0" y={plotTop + 4}>{max.toFixed(1)}</text>
        <text className="axis-label" x="0" y={plotBottom + 4}>{min.toFixed(1)}</text>
        <text className="time-label" x={plotLeft} y="105">{startTime}</text>
        <text className="time-label" textAnchor="end" x={plotRight} y="105">{endTime}</text>
        {setpoint !== undefined && <text className="setpoint-label" textAnchor="end" x={plotRight} y={Math.max(y(setpoint) - 5, 10)}>Ngưỡng {setpoint.toFixed(1)}</text>}
      </svg>
    </div>
  );
}

function HistoryChart({ history }: { history: HistoryPoint[] }) {
  const points = history;
  if (points.length < 2) return <div className="empty-chart">Đang thu thập dữ liệu lịch sử...</div>;
  return (
    <div className="history-chart" aria-label="Biến động nhiệt độ và độ ẩm gần đây">
      <TrendLine color="#bd6b31" label="Nhiệt độ phòng" setpoint={points.at(-1)?.temperatureSetpoint} timestamps={points.map((point) => point.receivedAt)} unit="°C" values={points.map((point) => point.temperature)} />
      <TrendLine color="#247864" label="Độ ẩm phòng" setpoint={points.at(-1)?.humiditySetpoint} timestamps={points.map((point) => point.receivedAt)} unit="%RH" values={points.map((point) => point.humidity)} />
    </div>
  );
}

function MetricCard({ label, value, unit, detail }: { label: string; value: string; unit: string; detail: string }) {
  return (
    <article className="metric-card">
      <p className="metric-label">{label}</p>
      <div className="metric-value">{value} <span>{unit}</span></div>
      <p className="metric-detail">{detail}</p>
    </article>
  );
}

function App() {
  const [deviceState, setDeviceState] = useState<DeviceState>(emptyState);
  const [serverStatus, setServerStatus] = useState<ServerStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [historyRange, setHistoryRange] = useState<1 | 6 | 24>(1);
  const [humiditySetpoint, setHumiditySetpoint] = useState('60.0');
  const [temperatureSetpoint, setTemperatureSetpoint] = useState('28.0');
  const [mode, setMode] = useState<'SMART' | 'CONTINUOUS'>('SMART');
  const [formTouched, setFormTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [commandMessage, setCommandMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'overview' | 'history' | 'settings' | 'activity'>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const telemetry = deviceState.telemetry;

  useEffect(() => {
    let cancelled = false;
    const loadState = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/devices/mayhutam1/state`);
        if (!response.ok) throw new Error('Không thể tải trạng thái thiết bị.');
        const nextState = (await response.json()) as DeviceState;
        if (!cancelled) {
          setDeviceState(nextState);
          setErrorMessage(null);
        }
      } catch (error) {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : 'Không thể kết nối backend.');
      }
    };

    const loadSupplementalData = async () => {
      try {
        const [commandsResponse, eventsResponse] = await Promise.all([
          fetch(`${apiUrl}/api/devices/mayhutam1/commands`),
          fetch(`${apiUrl}/api/devices/mayhutam1/events`),
        ]);
        if (commandsResponse.ok && !cancelled) setCommands((await commandsResponse.json()) as CommandRecord[]);
        if (eventsResponse.ok && !cancelled) setEvents((await eventsResponse.json()) as EventRecord[]);
      } catch {
        // Realtime monitoring remains available even if history is temporarily unavailable.
      }
    };

    void loadState();
    void loadSupplementalData();
    const socket = io(apiUrl, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      setServerStatus('connected');
      setErrorMessage(null);
      void loadState();
      void loadSupplementalData();
    });
    socket.on('disconnect', () => setServerStatus('disconnected'));
    socket.on('connect_error', () => {
      setServerStatus('disconnected');
      setErrorMessage('Mất kết nối với máy chủ realtime.');
    });
    socket.on('device:status-changed', (state: DeviceState) => setDeviceState(state));
    socket.on('telemetry:update', (telemetry: Telemetry) => {
      setDeviceState((current) => ({ ...current, connectionStatus: 'ONLINE', lastSeenAt: telemetry.receivedAt, telemetry }));
      setHistory((current) => [...current.slice(-239), telemetry]);
    });
    socket.on('command:update', (command: CommandRecord) => {
      setCommands((current) => [command, ...current.filter((item) => item.id !== command.id)].slice(0, 20));
      setSubmitting(command.status === 'pending');
      setCommandMessage(command.status === 'pending' ? 'Đã gửi lệnh, đang chờ thiết bị xác nhận.' : commandStatusLabel(command.status));
    });
    socket.on('event:new', (event: EventRecord) => {
      setEvents((current) => [event, ...current].slice(0, 30));
    });

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadRange = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/devices/mayhutam1/telemetry?hours=${historyRange}`);
        if (!response.ok) throw new Error('Không thể tải dữ liệu lịch sử.');
        if (!cancelled) setHistory((await response.json()) as HistoryPoint[]);
      } catch (error) {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : 'Không thể tải dữ liệu lịch sử.');
      }
    };
    void loadRange();
    return () => { cancelled = true; };
  }, [historyRange]);

  useEffect(() => {
    if (!telemetry || formTouched) return;
    setHumiditySetpoint(telemetry.humiditySetpoint.toFixed(1));
    setTemperatureSetpoint(telemetry.temperatureSetpoint.toFixed(1));
    setMode(telemetry.runningMode === 'SMART' ? 'SMART' : 'CONTINUOUS');
  }, [formTouched, telemetry]);

  const submitSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setCommandMessage(null);
    try {
      const response = await fetch(`${apiUrl}/api/devices/mayhutam1/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          humiditySetpoint: Number(humiditySetpoint),
          temperatureSetpoint: Number(temperatureSetpoint),
          mode,
        }),
      });
      const result = await response.json() as CommandRecord | { error: string };
      if (!response.ok) throw new Error('error' in result ? result.error : 'Không thể gửi lệnh.');
      setCommands((current) => [result as CommandRecord, ...current.filter((item) => item.id !== (result as CommandRecord).id)].slice(0, 20));
      setCommandMessage('Đã gửi lệnh, đang chờ thiết bị xác nhận.');
      setFormTouched(false);
    } catch (error) {
      setSubmitting(false);
      setCommandMessage(error instanceof Error ? error.message : 'Không thể gửi lệnh.');
    }
  };

  const alerts = useMemo(() => {
    const items: Array<{ level: 'danger' | 'warning'; text: string }> = [];
    if (deviceState.connectionStatus === 'OFFLINE') items.push({ level: 'danger', text: 'Không nhận được dữ liệu từ thiết bị.' });
    if (telemetry?.runningStatus === 'SYS_ERROR') items.push({ level: 'danger', text: 'Thiết bị đang báo lỗi hệ thống.' });
    if ((telemetry?.sensorError ?? 0) !== 0) items.push({ level: 'danger', text: 'Cảm biến SHT đang báo lỗi.' });
    if (telemetry?.waterTankStatus === 'FULL') items.push({ level: 'warning', text: 'Khay nước đã đầy, cần kiểm tra.' });
    if (serverStatus === 'disconnected') items.push({ level: 'danger', text: 'Dashboard mất kết nối với backend.' });
    return items;
  }, [deviceState.connectionStatus, serverStatus, telemetry]);

  const historySummary = useMemo(() => {
    if (history.length === 0) return null;
    const temperatures = history.map((point) => point.temperature);
    const humidities = history.map((point) => point.humidity);
    const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
    return {
      temperatureMin: Math.min(...temperatures),
      temperatureMax: Math.max(...temperatures),
      temperatureAverage: average(temperatures),
      humidityMin: Math.min(...humidities),
      humidityMax: Math.max(...humidities),
      humidityAverage: average(humidities),
    };
  }, [history]);

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="brand">
            <img className="brand-logo" src={logoUrl} alt="Logo hệ thống" />
            <strong>Máy hút ẩm</strong>
          </div>
          <button
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((current) => !current)}
            title={sidebarCollapsed ? 'Mở rộng' : 'Thu gọn'}
            type="button"
          >
            <span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span>
          </button>
        </div>
        <nav aria-label="Điều hướng chính">
          <button className={`nav-item ${activeSection === 'overview' ? 'active' : ''}`} type="button" onClick={() => { setActiveSection('overview'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Tổng quan</button>
          <button className={`nav-item ${activeSection === 'history' ? 'active' : ''}`} type="button" onClick={() => { setActiveSection('history'); document.getElementById('history')?.scrollIntoView({ behavior: 'smooth' }); }}>Dữ liệu lịch sử</button>
          <button className={`nav-item ${activeSection === 'settings' ? 'active' : ''}`} type="button" onClick={() => { setActiveSection('settings'); document.getElementById('settings')?.scrollIntoView({ behavior: 'smooth' }); }}>Cài đặt thiết bị</button>
          <button className={`nav-item ${activeSection === 'activity' ? 'active' : ''}`} type="button" onClick={() => { setActiveSection('activity'); document.getElementById('activity')?.scrollIntoView({ behavior: 'smooth' }); }}>Nhật ký hệ thống</button>
        </nav>
      </aside>

      <main className="dashboard">
        <header className="page-header">
          <div>
            <p className="eyebrow">Thiết bị {deviceState.deviceId.toUpperCase()}</p>
            <h1>Máy hút ẩm 1</h1>
            <p className="last-update">Dữ liệu nhận <RelativeTime value={deviceState.lastSeenAt} /> · {formatTime(deviceState.lastSeenAt)}</p>
          </div>
          <div className="header-status">
            <span className="header-status-label">Trạng thái thiết bị</span>
            <div className={`device-badge ${deviceState.connectionStatus.toLowerCase()}`}><span />{deviceState.connectionStatus === 'ONLINE' ? 'Đang trực tuyến' : 'Ngoại tuyến'}</div>
          </div>
        </header>

        {errorMessage && <div className="inline-error" role="alert">{errorMessage}</div>}

        <section className="metrics" aria-label="Thông số môi trường">
          <MetricCard label="Nhiệt độ phòng" value={formatNumber(telemetry?.temperature)} unit="°C" detail={`Ngưỡng đặt ${formatNumber(telemetry?.temperatureSetpoint)} °C`} />
          <MetricCard label="Độ ẩm phòng" value={formatNumber(telemetry?.humidity)} unit="%RH" detail={`Ngưỡng đặt ${formatNumber(telemetry?.humiditySetpoint)} %RH`} />
          <MetricCard label="Nhiệt độ giàn" value={formatNumber(telemetry?.coilTemperature)} unit="°C" detail="Cảm biến NTC giàn lạnh" />
        </section>

        <section className="panel operation-panel">
          <div className="operation-main">
            <div className="panel-heading">
              <div><p className="section-kicker">Trạng thái vận hành</p><h2>{statusLabel(telemetry?.runningStatus)}</h2></div>
              <span className={`status-chip ${telemetry?.runningStatus === 'SYS_ERROR' ? 'danger' : 'normal'}`}>{telemetry?.runningStatus ?? 'Chưa có dữ liệu'}</span>
            </div>
            <dl className="status-list">
              <div><dt>Chế độ hoạt động</dt><dd>{modeLabel(telemetry?.runningMode)}</dd></div>
              <div><dt>Khay chứa nước</dt><dd className={telemetry?.waterTankStatus === 'FULL' ? 'text-danger' : ''}>{telemetry?.waterTankStatus === 'FULL' ? 'Đã đầy' : telemetry ? 'Bình thường' : '--'}</dd></div>
              <div><dt>Cảm biến nhiệt ẩm</dt><dd className={(telemetry?.sensorError ?? 0) !== 0 ? 'text-danger' : ''}>{telemetry ? (telemetry.sensorError === 0 ? 'Bình thường' : `Lỗi ${telemetry.sensorError}`) : '--'}</dd></div>
              <div><dt>Kết nối MQTT</dt><dd>{deviceState.mqttStatus === 'connected' ? 'Đã kết nối' : 'Đang gián đoạn'}</dd></div>
            </dl>
          </div>
          <aside className={`health-summary ${alerts.length > 0 ? 'has-alerts' : ''}`}>
            <p className="section-kicker">Tình trạng hệ thống</p>
            {alerts.length === 0 ? (
              <div className="healthy-state"><span className="healthy-mark">✓</span><div><strong>Hệ thống bình thường</strong><p>Không có cảnh báo cần xử lý.</p></div></div>
            ) : (
              <><strong>{alerts.length} cảnh báo cần kiểm tra</strong><ul className="alert-list">{alerts.map((alert) => <li className={alert.level} key={alert.text}>{alert.text}</li>)}</ul></>
            )}
          </aside>
        </section>

        <section className="lower-grid">
          <article className="panel history-panel" id="history">
            <div className="panel-heading compact">
              <div><p className="section-kicker">Dữ liệu gần đây</p><h2>Biến động nhiệt độ và độ ẩm</h2></div>
              <div className="history-controls">
                <div className="range-buttons" aria-label="Khoảng thời gian">
                  {([1, 6, 24] as const).map((hours) => (
                    <button className={historyRange === hours ? 'active' : ''} key={hours} onClick={() => setHistoryRange(hours)} type="button">{hours} giờ</button>
                  ))}
                </div>
              </div>
            </div>
            <HistoryChart history={history} />
            {historySummary && (
              <div className="history-summary">
                <div><span>Nhiệt độ</span><strong>TB {formatNumber(historySummary.temperatureAverage)} °C</strong><small>{formatNumber(historySummary.temperatureMin)} – {formatNumber(historySummary.temperatureMax)} °C</small></div>
                <div><span>Độ ẩm</span><strong>TB {formatNumber(historySummary.humidityAverage)} %RH</strong><small>{formatNumber(historySummary.humidityMin)} – {formatNumber(historySummary.humidityMax)} %RH</small></div>
              </div>
            )}
          </article>

          <form className="panel settings-panel" id="settings" onSubmit={submitSettings}>
            <div className="panel-heading compact"><div><p className="section-kicker">Cài đặt thiết bị</p><h2>Thông số vận hành</h2></div></div>
            <div className="applied-settings">
              <span>Thiết bị đang áp dụng</span>
              <strong>{formatNumber(telemetry?.humiditySetpoint)} %RH · {formatNumber(telemetry?.temperatureSetpoint)} °C</strong>
              <small>{modeLabel(telemetry?.runningMode)}</small>
            </div>
            <div className="settings-fields">
              <label><span className="field-label">Ngưỡng độ ẩm<small>0–100 %RH</small></span><span><input aria-label="Ngưỡng độ ẩm" min="0" max="100" step="0.1" type="number" value={humiditySetpoint} onChange={(event) => { setHumiditySetpoint(event.target.value); setFormTouched(true); }} /> %RH</span></label>
              <label><span className="field-label">Ngưỡng nhiệt độ<small>0–50 °C</small></span><span><input aria-label="Ngưỡng nhiệt độ" min="0" max="50" step="0.1" type="number" value={temperatureSetpoint} onChange={(event) => { setTemperatureSetpoint(event.target.value); setFormTouched(true); }} /> °C</span></label>
              <label><span className="field-label">Chế độ chạy<small>Chọn cách thiết bị vận hành</small></span><select aria-label="Chế độ chạy" value={mode} onChange={(event) => { setMode(event.target.value as 'SMART' | 'CONTINUOUS'); setFormTouched(true); }}><option value="SMART">Thông minh</option><option value="CONTINUOUS">Liên tục</option></select></label>
            </div>
            {commandMessage && <p className={`command-message ${commands[0]?.status ?? ''}`} role="status">{commandMessage}</p>}
            <button className="primary-button" disabled={submitting || deviceState.connectionStatus === 'OFFLINE' || serverStatus !== 'connected'} type="submit">
              {submitting ? 'Đang chờ phản hồi...' : 'Áp dụng cài đặt'}
            </button>
          </form>
        </section>

        <section className="activity-grid" id="activity">
        <section className="panel command-log">
          <div className="panel-heading compact"><div><p className="section-kicker">Nhật ký điều khiển</p><h2>Các lệnh gần nhất</h2></div></div>
          {commands.length === 0 ? <p className="empty-log">Chưa có lệnh nào được gửi từ dashboard.</p> : (
            <div className="command-table" role="table" aria-label="Nhật ký điều khiển">
              <div className="command-header" role="row"><span>Cài đặt đã gửi</span><span>Kết quả</span><span>Thời gian</span></div>
              {commands.slice(0, 8).map((command) => {
                const parsed = parseCommandPayload(command.mqttPayload);
                return (
                  <div className="command-row" role="row" key={command.id}>
                    <div className="command-description"><strong>{parsed ? `${parsed.humidity} %RH · ${parsed.temperature} °C · ${parsed.mode}` : 'Lệnh cài đặt thiết bị'}</strong><code>{command.mqttPayload.trim()}</code></div>
                    <span className={`command-status ${command.status}`}>{commandStatusLabel(command.status)}</span>
                    <time>{formatTime(command.createdAt)}</time>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel event-log">
          <div className="panel-heading compact"><div><p className="section-kicker">Nhật ký sự kiện</p><h2>Trạng thái và cảnh báo</h2></div></div>
          {events.length === 0 ? <p className="empty-log">Chưa ghi nhận sự kiện bất thường.</p> : (
            <div className="event-list">
              {events.slice(0, 8).map((event) => (
                <div className={`event-row ${event.severity}`} key={event.id}>
                  <span className="event-dot" />
                  <div><strong>{event.message}</strong><time>{formatTime(event.createdAt)}</time></div>
                </div>
              ))}
            </div>
          )}
        </section>
        </section>
      </main>
    </div>
  );
}

export default App;
