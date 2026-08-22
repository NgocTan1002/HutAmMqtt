import { useEffect, useState } from 'react';
import type { CommandRecord, HistoryPoint } from '../types';

export function formatNumber(value: number | undefined) {
  return value === undefined ? '--' : value.toFixed(1);
}

export function formatTime(value: string | null) {
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

export function RelativeTime({ value }: { value: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [value]);
  return <>{formatRelativeTime(value, now)}</>;
}

export function modeLabel(value?: string) {
  if (value === 'SMART') return 'Thông minh';
  if (value === 'CONTINUOUS') return 'Liên tục';
  return value ?? '--';
}

export function statusLabel(value?: string) {
  const labels: Record<string, string> = {
    SYS_INIT: 'Đang khởi tạo', SYS_RUNNING: 'Đang vận hành', SYS_DEFROST: 'Đang xả đá', SYS_ERROR: 'Lỗi hệ thống',
  };
  return value ? (labels[value] ?? value) : '--';
}

export function binaryStatusLabel(value: 0 | 1 | null | undefined) {
  if (value === 1) return 'Đang chạy';
  if (value === 0) return 'Đang dừng';
  return 'Chưa có dữ liệu';
}

export function commandStatusLabel(status: CommandRecord['status']) {
  return { pending: 'Đang chờ', success: 'Thành công', error: 'Thiết bị báo lỗi', timeout: 'Hết thời gian chờ' }[status];
}

export function parseCommandPayload(payload: string) {
  const humidity = payload.match(/SH=([-\d.]+)/)?.[1];
  const temperature = payload.match(/ST=([-\d.]+)/)?.[1];
  const mode = payload.match(/MD=(\d+)/)?.[1];
  if (!humidity || !temperature || mode === undefined) return null;
  return { humidity, temperature, mode: mode === '0' ? 'Thông minh' : 'Liên tục' };
}

function TrendLine({ label, unit, color, values, setpoint, timestamps }: {
  label: string; unit: string; color: string; values: number[]; setpoint?: number; timestamps: string[];
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

export function HistoryChart({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) return <div className="empty-chart">Đang thu thập dữ liệu lịch sử...</div>;
  return (
    <div className="history-chart" aria-label="Biến động nhiệt độ và độ ẩm gần đây">
      <TrendLine color="#bd6b31" label="Nhiệt độ phòng" setpoint={history.at(-1)?.temperatureSetpoint} timestamps={history.map((point) => point.receivedAt)} unit="°C" values={history.map((point) => point.temperature)} />
      <TrendLine color="#247864" label="Độ ẩm phòng" setpoint={history.at(-1)?.humiditySetpoint} timestamps={history.map((point) => point.receivedAt)} unit="%RH" values={history.map((point) => point.humidity)} />
    </div>
  );
}

export function MetricCard({ label, value, unit, detail }: { label: string; value: string; unit: string; detail: string }) {
  return <article className="metric-card"><p className="metric-label">{label}</p><div className="metric-value">{value} <span>{unit}</span></div><p className="metric-detail">{detail}</p></article>;
}
