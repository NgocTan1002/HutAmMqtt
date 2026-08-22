import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  binaryStatusLabel,
  commandStatusLabel,
  formatNumber,
  formatTime,
  HistoryChart,
  MetricCard,
  modeLabel,
  parseCommandPayload,
  RelativeTime,
  statusLabel,
} from '../components/DashboardParts';
import { useDeviceDashboard } from '../hooks/useDeviceDashboard';
import type { Device } from '../types';

function dateTimeLocalValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function DashboardPage({ devices, selectedDeviceId, onSelectDevice, catalogLoading, catalogError }: {
  devices: Device[];
  selectedDeviceId: string | null;
  onSelectDevice(id: string): void;
  catalogLoading: boolean;
  catalogError: string | null;
}) {
  const [historyRange, setHistoryRange] = useState<1 | 6 | 24>(1);
  const [humiditySetpoint, setHumiditySetpoint] = useState('60.0');
  const [temperatureSetpoint, setTemperatureSetpoint] = useState('28.0');
  const [mode, setMode] = useState<'SMART' | 'CONTINUOUS'>('SMART');
  const [formTouched, setFormTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [commandMessage, setCommandMessage] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState(() => dateTimeLocalValue(new Date(Date.now() - 24 * 60 * 60 * 1_000)));
  const [exportTo, setExportTo] = useState(() => dateTimeLocalValue(new Date()));
  const [includeCommands, setIncludeCommands] = useState(true);
  const [includeEvents, setIncludeEvents] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const dashboard = useDeviceDashboard(selectedDeviceId, historyRange);
  const telemetry = dashboard.deviceState.telemetry;
  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? null;

  useEffect(() => {
    setFormTouched(false);
    setCommandMessage(null);
    setSubmitting(false);
  }, [selectedDeviceId]);

  useEffect(() => {
    if (!telemetry || formTouched) return;
    setHumiditySetpoint(telemetry.humiditySetpoint.toFixed(1));
    setTemperatureSetpoint(telemetry.temperatureSetpoint.toFixed(1));
    setMode(telemetry.runningMode === 'SMART' ? 'SMART' : 'CONTINUOUS');
  }, [formTouched, telemetry]);

  useEffect(() => {
    const latest = dashboard.commands[0];
    if (!latest) return;
    setSubmitting(latest.status === 'pending');
    if (latest.status !== 'pending') setCommandMessage(commandStatusLabel(latest.status));
  }, [dashboard.commands]);

  const alerts = useMemo(() => {
    const items: Array<{ level: 'danger' | 'warning'; text: string }> = [];
    if (dashboard.deviceState.connectionStatus === 'OFFLINE') items.push({ level: 'danger', text: 'Không nhận được dữ liệu từ thiết bị.' });
    if (telemetry?.runningStatus === 'SYS_ERROR') items.push({ level: 'danger', text: 'Thiết bị đang báo lỗi hệ thống.' });
    if ((telemetry?.sensorError ?? 0) !== 0) items.push({ level: 'danger', text: 'Cảm biến SHT đang báo lỗi.' });
    if (telemetry?.waterTankStatus === 'FULL') items.push({ level: 'warning', text: 'Khay nước đã đầy, cần kiểm tra.' });
    if (dashboard.serverStatus === 'disconnected') items.push({ level: 'danger', text: 'Dashboard mất kết nối với backend.' });
    return items;
  }, [dashboard.deviceState.connectionStatus, dashboard.serverStatus, telemetry]);

  const historySummary = useMemo(() => {
    if (dashboard.history.length === 0) return null;
    const temperatures = dashboard.history.map((point) => point.temperature);
    const humidities = dashboard.history.map((point) => point.humidity);
    const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
    return {
      temperatureMin: Math.min(...temperatures), temperatureMax: Math.max(...temperatures), temperatureAverage: average(temperatures),
      humidityMin: Math.min(...humidities), humidityMax: Math.max(...humidities), humidityAverage: average(humidities),
    };
  }, [dashboard.history]);

  const settingsUnavailableReason = useMemo(() => {
    if (submitting) return null;
    if (dashboard.deviceState.connectionStatus === 'OFFLINE') {
      return 'Không thể áp dụng khi thiết bị đang ngoại tuyến.';
    }
    if (dashboard.serverStatus === 'connecting') {
      return 'Đang chờ kết nối với máy chủ điều khiển.';
    }
    if (dashboard.serverStatus === 'disconnected') {
      return 'Không thể áp dụng vì dashboard đã mất kết nối với máy chủ.';
    }
    return null;
  }, [dashboard.deviceState.connectionStatus, dashboard.serverStatus, submitting]);

  const submitSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedDeviceId) return;
    setSubmitting(true);
    setCommandMessage(null);
    try {
      const command = await api.sendSettings(selectedDeviceId, {
        humiditySetpoint: Number(humiditySetpoint),
        temperatureSetpoint: Number(temperatureSetpoint),
        mode,
      });
      dashboard.setCommands((current) => [command, ...current.filter((item) => item.id !== command.id)].slice(0, 20));
      setCommandMessage('Đã gửi lệnh, đang chờ thiết bị xác nhận.');
      setFormTouched(false);
    } catch (error) {
      setSubmitting(false);
      setCommandMessage(error instanceof Error ? error.message : 'Không thể gửi lệnh.');
    }
  };

  const exportExcel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedDeviceId) return;
    const from = new Date(exportFrom);
    const to = new Date(exportTo);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
      setExportMessage('Khoảng thời gian xuất dữ liệu không hợp lệ.');
      return;
    }
    if (to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1_000) {
      setExportMessage('Mỗi lần chỉ được xuất tối đa 31 ngày.');
      return;
    }

    setExporting(true);
    setExportMessage(null);
    try {
      const result = await api.exportDeviceExcel(selectedDeviceId, {
        from: from.toISOString(),
        to: to.toISOString(),
        includeCommands,
        includeEvents,
      });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportMessage('Đã tạo và tải file Excel.');
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'Không thể xuất file Excel.');
    } finally {
      setExporting(false);
    }
  };

  if (catalogLoading && devices.length === 0) {
    return <div className="page-empty"><h1>Đang tải thiết bị</h1><p>Đang lấy danh sách cấu hình từ backend...</p></div>;
  }
  if (catalogError && devices.length === 0) {
    return <div className="page-empty error-empty"><h1>Không thể tải thiết bị</h1><p>{catalogError}</p></div>;
  }
  if (!selectedDeviceId || !selectedDevice) {
    return <div className="page-empty"><h1>Chưa có thiết bị hoạt động</h1><p>Thêm hoặc bật một thiết bị trong mục Thiết bị để bắt đầu theo dõi.</p></div>;
  }

  return (
    <div className="dashboard-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Thiết bị {selectedDevice.id.toUpperCase()}</p>
          <h1>{selectedDevice.name}</h1>
          <p className="last-update">Dữ liệu nhận <RelativeTime value={dashboard.deviceState.lastSeenAt} /> · {formatTime(dashboard.deviceState.lastSeenAt)}</p>
        </div>
        <div className="header-actions">
          <label className="device-selector">Thiết bị đang xem<select value={selectedDeviceId} onChange={(event) => onSelectDevice(event.target.value)}>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
          <div className="header-status"><span className="header-status-label">Trạng thái thiết bị</span><div className={`device-badge ${dashboard.deviceState.connectionStatus.toLowerCase()}`}><span />{dashboard.deviceState.connectionStatus === 'ONLINE' ? 'Đang trực tuyến' : 'Ngoại tuyến'}</div></div>
        </div>
      </header>

      {dashboard.loading && <div className="loading-bar">Đang tải dữ liệu thiết bị...</div>}
      {dashboard.errorMessage && <div className="inline-error" role="alert">{dashboard.errorMessage}</div>}

      <section className="metrics" aria-label="Thông số môi trường">
        <MetricCard label="Nhiệt độ phòng" value={formatNumber(telemetry?.temperature)} unit="°C" detail={`Ngưỡng đặt ${formatNumber(telemetry?.temperatureSetpoint)} °C`} />
        <MetricCard label="Độ ẩm phòng" value={formatNumber(telemetry?.humidity)} unit="%RH" detail={`Ngưỡng đặt ${formatNumber(telemetry?.humiditySetpoint)} %RH`} />
        <MetricCard label="Nhiệt độ giàn" value={formatNumber(telemetry?.coilTemperature)} unit="°C" detail="Cảm biến NTC giàn lạnh" />
      </section>

      <section className="panel operation-panel">
        <div className="operation-main">
          <div className="panel-heading"><div><p className="section-kicker">Trạng thái vận hành</p><h2>{statusLabel(telemetry?.runningStatus)}</h2></div><span className={`status-chip ${telemetry?.runningStatus === 'SYS_ERROR' ? 'danger' : 'normal'}`}>{telemetry?.runningStatus ?? 'Chưa có dữ liệu'}</span></div>
          <dl className="status-list">
            <div><dt>Chế độ hoạt động</dt><dd>{modeLabel(telemetry?.runningMode)}</dd></div>
            <div><dt>Khay chứa nước</dt><dd className={telemetry?.waterTankStatus === 'FULL' ? 'text-danger' : ''}>{telemetry?.waterTankStatus === 'FULL' ? 'Đã đầy' : telemetry ? 'Bình thường' : '--'}</dd></div>
            <div><dt>Cảm biến nhiệt ẩm</dt><dd className={(telemetry?.sensorError ?? 0) !== 0 ? 'text-danger' : ''}>{telemetry ? (telemetry.sensorError === 0 ? 'Bình thường' : `Lỗi ${telemetry.sensorError}`) : '--'}</dd></div>
            <div><dt>Kết nối broker MQTT</dt><dd>{dashboard.deviceState.mqttStatus === 'connected' ? 'Đã kết nối' : 'Đang gián đoạn'}</dd></div>
          </dl>
          <div className="component-status-grid" aria-label="Trạng thái các bộ phận">
            <div><span>Bộ lọc</span><strong className={telemetry?.filterStatus === 1 ? 'running' : telemetry?.filterStatus === 0 ? 'stopped' : 'unknown'}>{binaryStatusLabel(telemetry?.filterStatus)}</strong></div>
            <div><span>Quạt</span><strong className={telemetry?.fanStatus === 1 ? 'running' : telemetry?.fanStatus === 0 ? 'stopped' : 'unknown'}>{binaryStatusLabel(telemetry?.fanStatus)}</strong></div>
            <div><span>Gia nhiệt</span><strong className={telemetry?.heaterStatus === 1 ? 'running' : telemetry?.heaterStatus === 0 ? 'stopped' : 'unknown'}>{binaryStatusLabel(telemetry?.heaterStatus)}</strong></div>
          </div>
        </div>
        <aside className={`health-summary ${alerts.length > 0 ? 'has-alerts' : ''}`}>
          <p className="section-kicker">Tình trạng hệ thống</p>
          {alerts.length === 0 ? <div className="healthy-state"><span className="healthy-mark">✓</span><div><strong>Hệ thống bình thường</strong><p>Không có cảnh báo cần xử lý.</p></div></div> : <><strong>{alerts.length} cảnh báo cần kiểm tra</strong><ul className="alert-list">{alerts.map((alert) => <li className={alert.level} key={alert.text}>{alert.text}</li>)}</ul></>}
        </aside>
      </section>

      <section className="lower-grid">
        <article className="panel history-panel">
          <div className="panel-heading compact"><div><p className="section-kicker">Dữ liệu gần đây</p><h2>Biến động nhiệt độ và độ ẩm</h2></div><div className="range-buttons" aria-label="Khoảng thời gian">{([1, 6, 24] as const).map((hours) => <button className={historyRange === hours ? 'active' : ''} key={hours} onClick={() => setHistoryRange(hours)} type="button">{hours} giờ</button>)}</div></div>
          <HistoryChart history={dashboard.history} />
          {historySummary && <div className="history-summary"><div><span>Nhiệt độ</span><strong>TB {formatNumber(historySummary.temperatureAverage)} °C</strong><small>{formatNumber(historySummary.temperatureMin)} – {formatNumber(historySummary.temperatureMax)} °C</small></div><div><span>Độ ẩm</span><strong>TB {formatNumber(historySummary.humidityAverage)} %RH</strong><small>{formatNumber(historySummary.humidityMin)} – {formatNumber(historySummary.humidityMax)} %RH</small></div></div>}
        </article>

        <form className="panel settings-panel" onSubmit={submitSettings}>
          <div className="panel-heading compact"><div><p className="section-kicker">Cài đặt thiết bị</p><h2>Thông số vận hành</h2></div></div>
          <div className="applied-settings"><span>Thiết bị đang áp dụng</span><strong>{formatNumber(telemetry?.humiditySetpoint)} %RH · {formatNumber(telemetry?.temperatureSetpoint)} °C</strong><small>{modeLabel(telemetry?.runningMode)}</small></div>
          <div className="settings-fields">
            <label><span className="field-label">Ngưỡng độ ẩm<small>0–100 %RH</small></span><span><input aria-label="Ngưỡng độ ẩm" min="0" max="100" step="0.1" type="number" value={humiditySetpoint} onChange={(event) => { setHumiditySetpoint(event.target.value); setFormTouched(true); }} /> %RH</span></label>
            <label><span className="field-label">Ngưỡng nhiệt độ<small>0–50 °C</small></span><span><input aria-label="Ngưỡng nhiệt độ" min="0" max="50" step="0.1" type="number" value={temperatureSetpoint} onChange={(event) => { setTemperatureSetpoint(event.target.value); setFormTouched(true); }} /> °C</span></label>
            <label><span className="field-label">Chế độ chạy<small>Chọn cách thiết bị vận hành</small></span><select aria-label="Chế độ chạy" value={mode} onChange={(event) => { setMode(event.target.value as 'SMART' | 'CONTINUOUS'); setFormTouched(true); }}><option value="SMART">Thông minh</option><option value="CONTINUOUS">Liên tục</option></select></label>
          </div>
          {commandMessage && <p className={`command-message ${dashboard.commands[0]?.status ?? ''}`} role="status">{commandMessage}</p>}
          {settingsUnavailableReason && <p className="settings-unavailable" id="settings-unavailable" role="status">{settingsUnavailableReason}</p>}
          <button aria-describedby={settingsUnavailableReason ? 'settings-unavailable' : undefined} className="primary-button" disabled={submitting || Boolean(settingsUnavailableReason)} type="submit">{submitting ? 'Đang chờ phản hồi...' : 'Áp dụng cài đặt'}</button>
        </form>
      </section>

      <section className="panel export-panel">
        <div className="export-copy"><p className="section-kicker">Xuất báo cáo</p><h2>Dữ liệu Excel</h2><p>File gồm trang tổng hợp, dữ liệu đo và các nhật ký được chọn.</p></div>
        <form className="export-form" onSubmit={exportExcel}>
          <label>Từ thời điểm<input required type="datetime-local" value={exportFrom} onChange={(event) => setExportFrom(event.target.value)} /></label>
          <label>Đến thời điểm<input required type="datetime-local" value={exportTo} onChange={(event) => setExportTo(event.target.value)} /></label>
          <div className="export-options">
            <label><input checked={includeCommands} onChange={(event) => setIncludeCommands(event.target.checked)} type="checkbox" /> Kèm lệnh điều khiển</label>
            <label><input checked={includeEvents} onChange={(event) => setIncludeEvents(event.target.checked)} type="checkbox" /> Kèm sự kiện</label>
          </div>
          <button className="primary-action" disabled={exporting} type="submit">{exporting ? 'Đang tạo file...' : 'Xuất Excel'}</button>
          {exportMessage && <p className={`export-message ${exportMessage.startsWith('Đã tạo') ? 'success' : 'error'}`} role="status">{exportMessage}</p>}
        </form>
      </section>

      <section className="activity-grid">
        <section className="panel command-log">
          <div className="panel-heading compact"><div><p className="section-kicker">Nhật ký điều khiển</p><h2>Các lệnh gần nhất</h2></div></div>
          {dashboard.commands.length === 0 ? <p className="empty-log">Chưa có lệnh nào được gửi từ dashboard.</p> : <div className="command-table" role="table" aria-label="Nhật ký điều khiển"><div className="command-header" role="row"><span>Cài đặt đã gửi</span><span>Kết quả</span><span>Thời gian</span></div>{dashboard.commands.slice(0, 8).map((command) => { const parsed = parseCommandPayload(command.mqttPayload); return <div className="command-row" role="row" key={command.id}><div className="command-description"><strong>{parsed ? `${parsed.humidity} %RH · ${parsed.temperature} °C · ${parsed.mode}` : 'Lệnh cài đặt thiết bị'}</strong><code>{command.mqttPayload.trim()}</code></div><span className={`command-status ${command.status}`}>{commandStatusLabel(command.status)}</span><time>{formatTime(command.createdAt)}</time></div>; })}</div>}
        </section>
        <section className="panel event-log">
          <div className="panel-heading compact"><div><p className="section-kicker">Nhật ký sự kiện</p><h2>Trạng thái và cảnh báo</h2></div></div>
          {dashboard.events.length === 0 ? <p className="empty-log">Chưa ghi nhận sự kiện bất thường.</p> : <div className="event-list">{dashboard.events.slice(0, 8).map((event) => <div className={`event-row ${event.severity}`} key={event.id}><span className="event-dot" /><div><strong>{event.message}</strong><time>{formatTime(event.createdAt)}</time></div></div>)}</div>}
        </section>
      </section>
    </div>
  );
}
