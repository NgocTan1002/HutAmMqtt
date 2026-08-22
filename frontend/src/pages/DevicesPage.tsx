import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { MqttConnectionSettings } from '../components/MqttConnectionSettings';
import type { Device, DevicePayload, MqttConnection } from '../types';

type DeviceForm = {
  id: string;
  name: string;
  telemetryTopic: string;
  commandTopic: string;
  responseTopic: string;
  offlineAfterSeconds: string;
  enabled: boolean;
};

const emptyForm: DeviceForm = {
  id: '', name: '', telemetryTopic: '', commandTopic: '', responseTopic: '',
  offlineAfterSeconds: '20', enabled: true,
};

export function DevicesPage({ onChanged }: { onChanged(): void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [brokers, setBrokers] = useState<MqttConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Device | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<DeviceForm>(emptyForm);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextDevices, nextBrokers] = await Promise.all([api.getDevices(), api.getMqttConnections()]);
      setDevices(nextDevices);
      setBrokers(nextBrokers);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải cấu hình thiết bị.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const preferredBrokerId = devices.find((device) => brokers.some((broker) => broker.id === device.mqttConnectionId))?.mqttConnectionId;
  const sharedBroker = brokers.find((broker) => broker.id === preferredBrokerId)
    ?? brokers.find((broker) => broker.enabled)
    ?? brokers[0]
    ?? null;

  const configurationChanged = async () => {
    await load();
    onChanged();
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setNotice(null);
    setShowForm(true);
  };

  const openEdit = (device: Device) => {
    setEditing(device);
    setForm({
      id: device.id,
      name: device.name,
      telemetryTopic: device.telemetryTopic,
      commandTopic: device.commandTopic,
      responseTopic: device.responseTopic,
      offlineAfterSeconds: String(device.offlineAfterSeconds),
      enabled: device.enabled,
    });
    setError(null);
    setNotice(null);
    setShowForm(true);
  };

  const useSuggestedTopics = () => {
    if (!form.id) return;
    setForm({
      ...form,
      telemetryTopic: `${form.id}/nhan`,
      commandTopic: `${form.id}/caidat`,
      responseTopic: `${form.id}/nhan`,
    });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sharedBroker) {
      setError('Hãy lưu kết nối MQTT dùng chung trước khi thêm thiết bị.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload: DevicePayload = {
      id: form.id,
      name: form.name,
      mqttConnectionId: sharedBroker.id,
      telemetryTopic: form.telemetryTopic,
      commandTopic: form.commandTopic,
      responseTopic: form.responseTopic,
      offlineAfterSeconds: Number(form.offlineAfterSeconds),
      enabled: form.enabled,
    };
    try {
      if (editing) {
        const { id: _id, ...updates } = payload;
        await api.updateDevice(editing.id, updates);
      } else {
        await api.createDevice(payload);
      }
      setNotice(editing ? 'Đã cập nhật thiết bị.' : 'Đã thêm thiết bị.');
      setShowForm(false);
      await load();
      onChanged();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không thể lưu thiết bị.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (device: Device) => {
    if (!window.confirm(`Xóa thiết bị “${device.name}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteDevice(device.id);
      setNotice('Đã xóa thiết bị.');
      await load();
      onChanged();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Không thể xóa thiết bị.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="management-page">
      <header className="management-header"><div><p className="eyebrow">Cấu hình hệ thống</p><h1>Thiết bị</h1><p>Cấu hình broker dùng chung và khai báo topic cho từng thiết bị tại địa điểm này.</p></div><button className="primary-action" disabled={!sharedBroker} onClick={openCreate} type="button">Thêm thiết bị</button></header>
      {error && <div className="inline-error" role="alert">{error}</div>}
      {notice && <div className="inline-notice" role="status">{notice}</div>}

      {!loading && <MqttConnectionSettings connection={sharedBroker} onChanged={configurationChanged} />}
      {!sharedBroker && !loading && <div className="configuration-hint">Lưu kết nối MQTT dùng chung trước, sau đó bạn có thể thêm các thiết bị và topic tương ứng.</div>}

      {showForm && <form className="panel config-form" onSubmit={save}>
        <div className="form-heading"><div><p className="section-kicker">{editing ? 'Chỉnh sửa' : 'Thiết bị mới'}</p><h2>{editing?.name ?? 'Thông tin thiết bị'}</h2></div><button className="text-button" onClick={() => setShowForm(false)} type="button">Đóng</button></div>
        <div className="form-grid">
          <label>ID thiết bị<input disabled={Boolean(editing)} maxLength={100} pattern="[A-Za-z0-9_-]+" required value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} /></label>
          <label>Tên hiển thị<input maxLength={150} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Thời gian xác định offline<input min={1} max={86400} required type="number" value={form.offlineAfterSeconds} onChange={(event) => setForm({ ...form, offlineAfterSeconds: event.target.value })} /><small>Giây</small></label>
          <label>Topic nhận telemetry<input required value={form.telemetryTopic} onChange={(event) => setForm({ ...form, telemetryTopic: event.target.value })} /></label>
          <label>Topic gửi lệnh<input required value={form.commandTopic} onChange={(event) => setForm({ ...form, commandTopic: event.target.value })} /></label>
          <label>Topic nhận phản hồi<input required value={form.responseTopic} onChange={(event) => setForm({ ...form, responseTopic: event.target.value })} /></label>
        </div>
        <div className="form-options"><label><input checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} type="checkbox" /> Bật thiết bị</label></div>
        <p className="form-note">Topic của các thiết bị trên cùng broker không được trùng nhau và không dùng wildcard.</p>
        <div className="form-actions">{!editing && <button className="secondary-button" onClick={useSuggestedTopics} type="button">Điền topic theo ID</button>}<button className="primary-button compact-button" disabled={busy} type="submit">{busy ? 'Đang xử lý...' : 'Lưu thiết bị'}</button></div>
      </form>}

      <section className="panel management-list">
        <div className="list-heading"><div><p className="section-kicker">Danh sách thiết bị</p><h2>{devices.length} thiết bị</h2></div><button className="text-button" disabled={loading} onClick={() => void load()} type="button">Làm mới</button></div>
        {loading ? <p className="empty-log">Đang tải danh sách thiết bị...</p> : devices.length === 0 ? <div className="empty-management"><strong>Chưa có thiết bị</strong><p>Thêm thiết bị và khai báo topic để bắt đầu nhận dữ liệu.</p></div> : <div className="records-table device-records"><div className="records-header"><span>Thiết bị</span><span>Trạng thái</span><span>Topic</span><span>Thao tác</span></div>{devices.map((device) => <div className="records-row" key={device.id}><div><strong>{device.name}</strong><small>{device.id}</small></div><div><span className={`record-status ${device.enabled ? device.state?.connectionStatus.toLowerCase() ?? 'disconnected' : 'disabled'}`}>{device.enabled ? device.state?.connectionStatus === 'ONLINE' ? 'Trực tuyến' : 'Ngoại tuyến' : 'Đã tắt'}</span><small>{device.state?.mqttStatus === 'connected' ? 'MQTT đã kết nối' : 'MQTT gián đoạn'}</small></div><div className="topic-list"><code>{device.telemetryTopic}</code><code>{device.commandTopic}</code><code>{device.responseTopic}</code></div><div className="row-actions"><button disabled={busy} onClick={() => openEdit(device)} type="button">Sửa</button><button className="danger-link" disabled={busy} onClick={() => void remove(device)} type="button">Xóa</button></div></div>)}</div>}
      </section>
    </div>
  );
}
