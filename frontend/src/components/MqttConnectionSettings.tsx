import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MqttConnection, MqttConnectionPayload } from '../types';

type BrokerForm = {
  name: string;
  brokerUrl: string;
  port: string;
  useTls: boolean;
  username: string;
  password: string;
  clearPassword: boolean;
  clientIdPrefix: string;
  enabled: boolean;
};

const emptyForm: BrokerForm = {
  name: 'Broker MQTT',
  brokerUrl: 'mqtt://localhost',
  port: '1883',
  useTls: false,
  username: '',
  password: '',
  clearPassword: false,
  clientIdPrefix: 'nhiet-am-mqtt',
  enabled: true,
};

function formFromConnection(connection: MqttConnection | null): BrokerForm {
  if (!connection) return emptyForm;
  return {
    name: connection.name,
    brokerUrl: connection.brokerUrl,
    port: String(connection.port),
    useTls: connection.useTls,
    username: connection.username ?? '',
    password: '',
    clearPassword: false,
    clientIdPrefix: connection.clientIdPrefix ?? '',
    enabled: connection.enabled,
  };
}

function statusLabel(connection: MqttConnection) {
  if (!connection.enabled) return 'Đã tắt';
  return {
    connected: 'Đã kết nối',
    connecting: 'Đang kết nối',
    disconnected: 'Mất kết nối',
    error: 'Lỗi kết nối',
  }[connection.runtime?.status ?? 'disconnected'];
}

export function MqttConnectionSettings({
  connection,
  onChanged,
}: {
  connection: MqttConnection | null;
  onChanged(): Promise<void> | void;
}) {
  const [editing, setEditing] = useState(connection === null);
  const [form, setForm] = useState<BrokerForm>(() => formFromConnection(connection));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setForm(formFromConnection(connection));
    if (!connection) setEditing(true);
  }, [connection]);

  const basePayload = (): MqttConnectionPayload => ({
    name: form.name,
    brokerUrl: form.brokerUrl,
    port: Number(form.port),
    useTls: form.useTls,
    username: form.username.trim() || null,
    clientIdPrefix: form.clientIdPrefix.trim() || null,
    enabled: form.enabled,
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = basePayload();
      if (!connection || form.password) payload.password = form.password || null;
      else if (form.clearPassword) payload.password = null;

      if (connection) await api.updateMqttConnection(connection.id, payload);
      else await api.createMqttConnection(payload);

      setEditing(false);
      setNotice(connection ? 'Đã cập nhật kết nối MQTT dùng chung.' : 'Đã lưu kết nối MQTT dùng chung.');
      await onChanged();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không thể lưu kết nối MQTT.');
    } finally {
      setBusy(false);
    }
  };

  const testForm = async (formElement: HTMLFormElement | null) => {
    if (formElement && !formElement.reportValidity()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { enabled: _enabled, ...testPayload } = basePayload();
      const result = await api.testMqttConnection({ ...testPayload, password: form.password || null });
      setNotice(`Kết nối thành công trong ${result.durationMs} ms.`);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Không thể kiểm tra kết nối.');
    } finally {
      setBusy(false);
    }
  };

  const runStoredAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Không thể thực hiện thao tác.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel shared-broker-panel">
      <div className="form-heading">
        <div>
          <p className="section-kicker">Kết nối dùng chung</p>
          <h2>Broker MQTT</h2>
          <p className="section-description">Tất cả thiết bị tại địa điểm này sử dụng kết nối dưới đây.</p>
        </div>
        {connection && !editing && <span className={`record-status ${connection.runtime?.status ?? (connection.enabled ? 'disconnected' : 'disabled')}`}>{statusLabel(connection)}</span>}
      </div>

      {error && <div className="inline-error embedded-message" role="alert">{error}</div>}
      {notice && <div className="inline-notice embedded-message" role="status">{notice}</div>}

      {editing ? <form className="embedded-config-form" onSubmit={save}>
        <div className="form-grid">
          <label>Tên kết nối<input required maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Địa chỉ broker<input required placeholder="mqtt://192.168.1.10" value={form.brokerUrl} onChange={(event) => setForm({ ...form, brokerUrl: event.target.value })} /></label>
          <label>Port<input required min={1} max={65535} type="number" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></label>
          <label>Tiền tố Client ID<input maxLength={100} value={form.clientIdPrefix} onChange={(event) => setForm({ ...form, clientIdPrefix: event.target.value })} /></label>
          <label>Username<input autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
          <label>Password<input autoComplete="new-password" placeholder={connection?.hasPassword ? 'Để trống để giữ password hiện tại' : 'Không bắt buộc'} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value, clearPassword: false })} /></label>
        </div>
        <div className="form-options">
          <label><input checked={form.useTls} onChange={(event) => setForm({ ...form, useTls: event.target.checked, brokerUrl: event.target.checked ? form.brokerUrl.replace(/^mqtt:\/\//, 'mqtts://') : form.brokerUrl.replace(/^mqtts:\/\//, 'mqtt://') })} type="checkbox" /> Sử dụng TLS</label>
          <label><input checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} type="checkbox" /> Bật kết nối</label>
          {connection?.hasPassword && <label><input checked={form.clearPassword} onChange={(event) => setForm({ ...form, clearPassword: event.target.checked, password: '' })} type="checkbox" /> Xóa password đang lưu</label>}
        </div>
        <p className="form-note">URL chỉ gồm giao thức và hostname; port và thông tin đăng nhập được nhập riêng.</p>
        <div className="form-actions">
          {connection && <button className="secondary-button" disabled={busy} onClick={() => { setEditing(false); setForm(formFromConnection(connection)); setError(null); }} type="button">Hủy</button>}
          <button className="secondary-button" disabled={busy} onClick={(event) => void testForm(event.currentTarget.form)} type="button">Thử kết nối</button>
          <button className="primary-button compact-button" disabled={busy} type="submit">{busy ? 'Đang xử lý...' : 'Lưu kết nối'}</button>
        </div>
      </form> : connection && <div className="broker-summary">
        <dl>
          <div><dt>Địa chỉ</dt><dd>{connection.brokerUrl}:{connection.port}</dd></div>
          <div><dt>Xác thực</dt><dd>{connection.username || 'Không dùng username'}{connection.hasPassword ? ' · Có password' : ''}</dd></div>
          <div><dt>TLS</dt><dd>{connection.useTls ? 'Đang bật' : 'Không sử dụng'}</dd></div>
        </dl>
        <div className="row-actions broker-actions">
          <button disabled={busy} onClick={() => { setEditing(true); setNotice(null); setError(null); }} type="button">Sửa cấu hình</button>
          <button disabled={busy || !connection.enabled} onClick={() => void runStoredAction(() => api.testStoredMqttConnection(connection.id), 'Kết nối kiểm tra thành công.')} type="button">Kiểm tra</button>
          <button disabled={busy || !connection.enabled} onClick={() => void runStoredAction(() => api.reconnectMqttConnection(connection.id), 'Đã yêu cầu kết nối lại broker.')} type="button">Kết nối lại</button>
        </div>
      </div>}
    </section>
  );
}
