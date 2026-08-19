# Lộ trình hoàn thiện hệ thống giám sát và điều khiển thiết bị MQTT

**Dự án:** NhietAmMqtt  
**Ngày chốt phương án:** 19/08/2026  
**Trạng thái:** Kế hoạch triển khai chính thức  
**Phương án cơ sở dữ liệu:** PostgreSQL  

## 1. Mục tiêu

Hoàn thiện hệ thống theo hướng có thể triển khai thực tế với các khả năng:

- Quản lý nhiều kết nối MQTT broker.
- Một broker có thể phục vụ nhiều thiết bị.
- Một hệ thống có thể kết nối đồng thời nhiều broker.
- Thêm, sửa, kiểm tra và kích hoạt kết nối MQTT trên trang web.
- Thêm, sửa và theo dõi nhiều thiết bị trên trang web.
- Hiển thị telemetry realtime cho từng thiết bị.
- Gửi lệnh cài đặt và xác nhận phản hồi riêng cho từng thiết bị.
- Lưu dữ liệu lịch sử, lệnh và sự kiện trong PostgreSQL.
- Truy xuất dữ liệu ổn định khi số lượng thiết bị và dữ liệu tăng lên.
- Có quy trình backup, chuyển đổi dữ liệu, kiểm thử, nghiệm thu và quay lui.

## 2. Các quyết định kiến trúc đã chốt

1. PostgreSQL thay thế SQLite trong phiên bản triển khai chính thức.
2. Trình duyệt không kết nối trực tiếp đến MQTT broker.
3. Người dùng cấu hình MQTT trên website; backend nhận cấu hình và quản lý kết nối.
4. Mỗi broker chỉ tạo một MQTT client, trừ khi có yêu cầu tài khoản hoặc chứng chỉ khác nhau.
5. Nhiều thiết bị dùng chung broker sẽ dùng chung MQTT client nhưng có topic riêng.
6. Mỗi thiết bị có `DeviceStateStore` và `CommandService` riêng.
7. Mỗi thiết bị chỉ được có một lệnh đang chờ phản hồi tại một thời điểm; các thiết bị khác vẫn gửi lệnh độc lập.
8. Password MQTT không được trả lại frontend sau khi lưu.
9. Password MQTT phải được mã hóa trước khi ghi vào PostgreSQL.
10. Thay đổi cấu trúc database phải thực hiện bằng migration có phiên bản.
11. Socket.IO phải phân biệt dữ liệu theo `deviceId`.
12. SQLite cũ chỉ bị loại bỏ sau khi chuyển dữ liệu và nghiệm thu thành công.

## 3. Phạm vi hoàn thiện

### 3.1. Trong phạm vi

- PostgreSQL và migration database.
- Chuyển dữ liệu SQLite hiện có sang PostgreSQL.
- Repository/service truy cập database bất đồng bộ.
- Quản lý nhiều MQTT broker.
- Quản lý nhiều thiết bị.
- Router bản tin MQTT theo topic.
- API quản lý broker và thiết bị.
- Giao diện cấu hình MQTT.
- Giao diện danh sách và chọn thiết bị.
- Dashboard realtime theo thiết bị.
- Lịch sử telemetry, lệnh và sự kiện theo thiết bị.
- Kiểm tra kết nối broker trước khi lưu.
- Reconnect khi cấu hình thay đổi hoặc broker hoạt động lại.
- Log vận hành cơ bản.
- Kiểm thử tự động cho các phần nghiệp vụ chính.
- Nghiệm thu chức năng, dữ liệu, hiệu năng cơ bản và bàn giao.

### 3.2. Chưa ưu tiên trong đợt này

- Phân quyền nhiều vai trò phức tạp.
- SSO, OAuth hoặc tích hợp tài khoản doanh nghiệp.
- Ứng dụng mobile riêng.
- TimescaleDB.
- Phân tích dự đoán hoặc cảnh báo bằng AI.
- Tự động dọn dữ liệu theo nhiều chính sách nâng cao.
- Kubernetes hoặc kiến trúc microservice.

> Trước khi đưa giao diện cấu hình MQTT ra Internet, tối thiểu phải có một lớp bảo vệ quản trị hoặc chỉ cho phép truy cập từ mạng nội bộ/VPN. Phân quyền đầy đủ có thể thực hiện ở giai đoạn tiếp theo.

## 4. Kiến trúc đích

```mermaid
flowchart LR
    UI["React Dashboard"] -->|"REST API"| API["Express API"]
    UI <-->|"Socket.IO"| RT["Realtime Gateway"]

    API --> CR["Connection Repository"]
    API --> DR["Device Repository"]
    CR --> PG["PostgreSQL"]
    DR --> PG

    API --> MCM["MQTT Connection Manager"]
    MCM --> B1["MQTT Broker A"]
    MCM --> B2["MQTT Broker B"]

    B1 --> D1["Thiết bị 1"]
    B1 --> D2["Thiết bị 2"]
    B2 --> D3["Thiết bị 3"]

    MCM --> TR["Topic Router"]
    TR --> REG["Device Registry"]
    REG --> PG
    REG --> RT
    REG --> CMD["Command Service theo thiết bị"]
    CMD --> MCM
```

### 4.1. Trách nhiệm của frontend

- Hiển thị danh sách broker và trạng thái kết nối.
- Hiển thị danh sách thiết bị và trạng thái online/offline.
- Cung cấp form thêm/sửa broker.
- Cung cấp form thêm/sửa thiết bị và topic.
- Gọi API kiểm tra kết nối MQTT.
- Chọn thiết bị đang theo dõi.
- Hiển thị dữ liệu realtime, lịch sử, cài đặt và nhật ký của thiết bị được chọn.
- Không lưu password MQTT trong localStorage hoặc state lâu dài.

### 4.2. Trách nhiệm của backend

- Kiểm tra và lưu cấu hình.
- Mã hóa/giải mã password MQTT.
- Quản lý vòng đời MQTT client.
- Subscribe/unsubscribe topic theo cấu hình thiết bị.
- Phân loại topic và chuyển bản tin đến đúng thiết bị.
- Quản lý trạng thái runtime của từng thiết bị.
- Lưu PostgreSQL.
- Phát dữ liệu qua Socket.IO.
- Gửi lệnh và xác nhận phản hồi riêng theo thiết bị.

### 4.3. Trách nhiệm của PostgreSQL

- Lưu cấu hình broker.
- Lưu cấu hình thiết bị.
- Lưu telemetry.
- Lưu nhật ký lệnh.
- Lưu nhật ký sự kiện.
- Lưu phiên bản migration.
- Phục vụ truy vấn lịch sử và báo cáo cơ bản.

## 5. Cấu trúc source code mục tiêu

```text
backend/src/
├── index.ts
├── app.ts
├── config/
│   ├── env.ts
│   └── encryption.ts
├── database/
│   ├── pool.ts
│   ├── migrations/
│   └── repositories/
│       ├── mqtt-connection-repository.ts
│       ├── device-repository.ts
│       ├── telemetry-repository.ts
│       ├── command-repository.ts
│       └── event-repository.ts
├── mqtt/
│   ├── mqtt-connection-manager.ts
│   ├── mqtt-runtime.ts
│   ├── topic-router.ts
│   └── telemetry-schema.ts
├── devices/
│   ├── device-registry.ts
│   ├── device-runtime.ts
│   └── device-state.ts
├── commands/
│   └── command-service.ts
├── events/
│   └── event-service.ts
├── routes/
│   ├── health-routes.ts
│   ├── mqtt-connection-routes.ts
│   └── device-routes.ts
└── realtime/
    └── socket-gateway.ts

frontend/src/
├── App.tsx
├── api/
│   ├── http-client.ts
│   ├── mqtt-connections-api.ts
│   └── devices-api.ts
├── components/
│   ├── layout/
│   ├── dashboard/
│   ├── devices/
│   └── mqtt-settings/
├── hooks/
│   ├── use-device-realtime.ts
│   └── use-selected-device.ts
├── pages/
│   ├── dashboard-page.tsx
│   ├── devices-page.tsx
│   └── mqtt-connections-page.tsx
└── styles.css
```

## 6. Thiết kế PostgreSQL

### 6.1. Bảng `mqtt_connections`

```sql
CREATE TABLE mqtt_connections (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  broker_url TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  use_tls BOOLEAN NOT NULL DEFAULT FALSE,
  username TEXT,
  encrypted_password TEXT,
  client_id_prefix VARCHAR(100),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 6.2. Bảng `devices`

```sql
CREATE TABLE devices (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  mqtt_connection_id UUID NOT NULL REFERENCES mqtt_connections(id),
  telemetry_topic TEXT NOT NULL,
  command_topic TEXT NOT NULL,
  response_topic TEXT NOT NULL,
  offline_after_seconds INTEGER NOT NULL DEFAULT 20,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mqtt_connection_id, telemetry_topic),
  UNIQUE (mqtt_connection_id, command_topic)
);
```

### 6.3. Bảng `telemetry`

```sql
CREATE TABLE telemetry (
  id BIGSERIAL PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL REFERENCES devices(id),
  temperature DOUBLE PRECISION NOT NULL,
  humidity DOUBLE PRECISION NOT NULL,
  coil_temperature DOUBLE PRECISION NOT NULL,
  humidity_setpoint DOUBLE PRECISION NOT NULL,
  temperature_setpoint DOUBLE PRECISION NOT NULL,
  running_status VARCHAR(50) NOT NULL,
  running_mode VARCHAR(50) NOT NULL,
  water_tank_status VARCHAR(50) NOT NULL,
  sensor_error INTEGER NOT NULL,
  received_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_telemetry_device_received_at
ON telemetry (device_id, received_at DESC);
```

### 6.4. Bảng `command_logs`

```sql
CREATE TABLE command_logs (
  id UUID PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL REFERENCES devices(id),
  mqtt_payload TEXT NOT NULL,
  status VARCHAR(20) NOT NULL,
  response TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_command_logs_device_created_at
ON command_logs (device_id, created_at DESC);
```

### 6.5. Bảng `event_logs`

```sql
CREATE TABLE event_logs (
  id UUID PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL REFERENCES devices(id),
  type VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_event_logs_device_created_at
ON event_logs (device_id, created_at DESC);
```

### 6.6. Quy tắc dữ liệu

- Thời gian luôn lưu bằng `TIMESTAMPTZ` và truyền API dưới dạng ISO 8601.
- `device_id` phải tồn tại trước khi lưu telemetry.
- Không xóa cứng broker đang có thiết bị, trừ khi thiết bị đã được chuyển hoặc xóa.
- Không cho phép trùng telemetry topic trên cùng một broker.
- Password đã mã hóa không được xuất hiện trong response API.
- Truy vấn biểu đồ vẫn giới hạn tối đa khoảng 240 điểm sau khi lấy mẫu.

### 6.7. Phân vùng dữ liệu

Chưa cần phân vùng ngay ở lần triển khai đầu. Bắt đầu bổ sung partition theo tháng khi:

- Bảng telemetry vượt khoảng 20–50 triệu bản ghi; hoặc
- Truy vấn/backup bắt đầu chậm; hoặc
- Hệ thống phải giữ dữ liệu nhiều năm.

## 7. Cấu hình môi trường mới

```dotenv
DATABASE_URL=postgresql://app_user:password@localhost:5432/nhiet_am_mqtt
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
DATABASE_SSL=false

CONFIG_ENCRYPTION_KEY=<base64-key>
BACKEND_PORT=3001
FRONTEND_PORT=5173
```

Sau khi chuyển hoàn tất, các biến `DEVICE_ID`, `MQTT_BROKER_URL` và topic cố định không còn là nguồn cấu hình chính. Chúng chỉ có thể được giữ tạm cho script import lần đầu.

## 8. API mục tiêu

### 8.1. Quản lý MQTT connection

| Method | Endpoint | Chức năng |
|---|---|---|
| `GET` | `/api/mqtt-connections` | Danh sách broker và trạng thái runtime |
| `POST` | `/api/mqtt-connections/test` | Kiểm tra kết nối tạm thời trước khi lưu |
| `POST` | `/api/mqtt-connections` | Thêm kết nối |
| `GET` | `/api/mqtt-connections/:id` | Lấy chi tiết không bao gồm password thật |
| `PATCH` | `/api/mqtt-connections/:id` | Chỉnh sửa cấu hình |
| `POST` | `/api/mqtt-connections/:id/reconnect` | Yêu cầu kết nối lại |
| `DELETE` | `/api/mqtt-connections/:id` | Xóa khi không còn thiết bị phụ thuộc |

Response cấu hình chỉ được trả:

```json
{
  "id": "...",
  "name": "Broker nhà máy",
  "brokerUrl": "192.168.1.105",
  "port": 1883,
  "useTls": false,
  "username": "operator",
  "hasPassword": true,
  "enabled": true,
  "runtimeStatus": "connected"
}
```

Không được trả trường password hoặc encrypted password.

### 8.2. Quản lý thiết bị

| Method | Endpoint | Chức năng |
|---|---|---|
| `GET` | `/api/devices` | Danh sách thiết bị |
| `POST` | `/api/devices` | Thêm thiết bị |
| `GET` | `/api/devices/:id` | Chi tiết thiết bị |
| `PATCH` | `/api/devices/:id` | Sửa tên, broker, topic hoặc timeout |
| `DELETE` | `/api/devices/:id` | Xóa/ngừng quản lý thiết bị |
| `GET` | `/api/devices/:id/state` | Trạng thái hiện tại |
| `GET` | `/api/devices/:id/telemetry` | Dữ liệu lịch sử |
| `GET` | `/api/devices/:id/commands` | Nhật ký lệnh |
| `GET` | `/api/devices/:id/events` | Nhật ký sự kiện |
| `POST` | `/api/devices/:id/commands` | Gửi lệnh cài đặt |

## 9. Thiết kế MQTT runtime

### 9.1. MQTT Connection Manager

Quản lý:

```ts
Map<connectionId, MqttRuntime>
```

Mỗi `MqttRuntime` gồm:

- Cấu hình broker đã giải mã tại runtime.
- Một `MqttClient`.
- Trạng thái `connecting`, `connected`, `disconnected`, `error`.
- Danh sách topic đã subscribe.
- Thời điểm kết nối/lỗi gần nhất.
- Cơ chế reconnect và shutdown an toàn.

### 9.2. Device Registry

Quản lý:

```ts
Map<deviceId, DeviceRuntime>
```

Mỗi `DeviceRuntime` gồm:

- Cấu hình thiết bị.
- `DeviceStateStore`.
- `CommandService`.
- `EventService`.
- Topic telemetry, command và response.

### 9.3. Topic Router

Quản lý ánh xạ:

```ts
Map<connectionIdAndTopic, {
  deviceId: string;
  messageType: 'telemetry' | 'response';
}>
```

Khi nhận message, backend phải xác định đúng broker, topic, thiết bị và loại message trước khi parse.

### 9.4. Quy tắc phản hồi lệnh

- Tốt nhất mỗi thiết bị có response topic riêng.
- Nếu response topic trùng telemetry topic, payload phải phân biệt được JSON và chuỗi phản hồi.
- Nếu nhiều thiết bị dùng chung response topic nhưng response không chứa Device ID, không thể đảm bảo xác định đúng thiết bị.
- Trong trường hợp firmware không đổi được, bắt buộc dùng topic riêng cho từng thiết bị hoặc xác nhận qua telemetry riêng của thiết bị.
- Một thiết bị chỉ có một lệnh pending; các thiết bị khác không bị khóa.

## 10. Giao diện cấu hình trên website

### 10.1. Trang “Kết nối MQTT”

Danh sách hiển thị:

- Tên broker.
- Host và port.
- TLS bật/tắt.
- Trạng thái runtime.
- Số thiết bị đang sử dụng.
- Thời điểm kết nối/lỗi gần nhất.
- Các thao tác: kiểm tra, sửa, kết nối lại, bật/tắt.

Form cấu hình:

- Tên kết nối.
- Giao thức MQTT/MQTTS.
- Host hoặc broker URL.
- Port.
- Username.
- Password.
- Client ID prefix.
- TLS.
- Trạng thái kích hoạt.

Quy tắc UX:

- Form sửa không hiển thị password cũ.
- Để trống password nghĩa là giữ password hiện có.
- Có nút “Kiểm tra kết nối”.
- Có nút “Lưu và kích hoạt”.
- Hiển thị lỗi dễ hiểu, không hiển thị stack trace.
- Không hiển thị giao diện cầu kỳ hoặc hiệu ứng giống AI-generated.

### 10.2. Trang “Thiết bị”

Danh sách hiển thị:

- Tên thiết bị.
- Device ID.
- Broker đang sử dụng.
- Trạng thái online/offline.
- Telemetry topic.
- Thời gian nhận dữ liệu cuối.

Form thiết bị:

- Tên hiển thị.
- Device ID.
- Broker.
- Telemetry topic.
- Command topic.
- Response topic.
- Thời gian xác định offline.
- Trạng thái kích hoạt.

### 10.3. Dashboard nhiều thiết bị

- Có bộ chọn thiết bị ở đầu dashboard.
- API không còn ghi cứng `mayhutam1`.
- Tất cả lịch sử, lệnh và sự kiện đi theo thiết bị được chọn.
- Socket.IO chỉ cập nhật dashboard nếu `deviceId` khớp.
- Có thể dùng Socket.IO room `device:<deviceId>` để giảm dữ liệu truyền.

## 11. Lộ trình thực hiện

### Giai đoạn 0 — Chuẩn bị và khóa phạm vi

**Thời gian dự kiến:** 0,5 ngày

Việc cần làm:

- Backup source code hiện tại.
- Backup toàn bộ file SQLite.
- Ghi lại cấu hình `.env` hiện tại.
- Chụp số lượng bản ghi của ba bảng.
- Chốt số thiết bị và broker dùng để kiểm thử.
- Chốt topic thật của từng thiết bị.
- Xác nhận firmware có response topic riêng hay xác nhận qua telemetry.

Kết quả bàn giao:

- Bản backup có thể phục hồi.
- Bảng cấu hình broker/thiết bị kiểm thử.
- Biên bản chốt giao thức MQTT.

### Giai đoạn 1 — Tách lớp truy cập database

**Thời gian dự kiến:** 1,5 ngày

Việc cần làm:

- Tạo interface repository cho telemetry, command và event.
- Thay import trực tiếp `database.ts` trong `index.ts` bằng repository.
- Chuyển các thao tác lưu/truy vấn thành `async`.
- Giữ SQLite adapter tạm thời để xác nhận refactor không đổi hành vi.
- Viết unit test cho truy vấn lịch sử và lấy mẫu 240 điểm.

Điều kiện hoàn thành:

- Backend vẫn chạy với SQLite adapter tạm.
- Dashboard, lịch sử, lệnh và sự kiện hoạt động như cũ.
- `index.ts` không còn phụ thuộc vào câu SQL cụ thể.

**Trạng thái ngày 19/08/2026: Đã hoàn thành.**

- Đã tạo repository cho telemetry, command và event; toàn bộ hàm truy cập dữ liệu dùng `Promise`.
- Đã cô lập `node:sqlite` và câu SQL trong `backend/src/database/sqlite/`.
- Đã tách thuật toán lấy mẫu lịch sử ra khỏi adapter và kiểm thử giới hạn 240 điểm.
- Đã bổ sung unit test cho cả ba repository, khởi tạo schema lặp lại và đóng kết nối an toàn.
- Đã kiểm tra API thực tế với SQLite hiện có; số bản ghi sau refactor vẫn là telemetry `1939`, command `19`, event `8`.
- Bản sao trước khi refactor nằm trong `backups/phase1-20260819-151147/`; file database backup được loại khỏi Git để tránh đưa dữ liệu vận hành vào repository.

### Giai đoạn 2 — PostgreSQL và migration schema

**Thời gian dự kiến:** 1,5–2 ngày

Việc cần làm:

- Cài PostgreSQL cho môi trường phát triển/kiểm thử.
- Tạo database và user riêng cho ứng dụng.
- Thêm connection pool.
- Thêm migration tool và migration đầu tiên.
- Tạo năm bảng chính.
- Thêm index và ràng buộc.
- Thêm health check database thật.
- Thêm graceful shutdown cho pool.

Điều kiện hoàn thành:

- Backend khởi động bằng `DATABASE_URL`.
- Migration chạy được trên database rỗng.
- Migration có thể chạy lặp lại mà không phá dữ liệu.
- `/api/health` phản ánh đúng trạng thái PostgreSQL.

**Trạng thái ngày 19/08/2026: Đã hoàn thành và nghiệm thu.**

- Đã thêm driver PostgreSQL song song với SQLite, connection pool và graceful shutdown bất đồng bộ.
- Đã tạo migration đầu tiên cho năm bảng cùng index, khóa ngoại và ràng buộc chính.
- Đã tạo PostgreSQL adapter cho telemetry, command và event.
- Đã đổi `/api/health` sang kiểm tra database thực tế.
- Đã thêm integration test tự chạy migration hai lần và kiểm tra cả ba repository.
- PostgreSQL 18 trên máy hoạt động tại `localhost:5432`; migration đã chạy thành công trên `hut_am_mqtt` và lần chạy lại không thay đổi schema.
- Integration test trên `hut_am_mqtt_test` đã đạt; fixture được dọn sau kiểm thử.
- Backend chạy thử bằng PostgreSQL báo database `connected`; khi MQTT kiểm thử bị ngắt, health chuyển đúng sang `degraded` mà API database vẫn hoạt động.

### Giai đoạn 3 — Khởi tạo dữ liệu mới và chuyển sang PostgreSQL

**Thời gian thực tế:** dưới 0,5 ngày

Theo quyết định ngày 19/08/2026, dữ liệu lịch sử SQLite không được import. PostgreSQL bắt đầu một tập dữ liệu mới; SQLite chỉ được giữ làm bản lưu cũ để tra cứu hoặc quay lui khi cần.

Việc đã thực hiện:

- Tạo script seed idempotent từ cấu hình `.env` hiện tại.
- Tạo một broker mặc định và thiết bị `mayhutam1` trong PostgreSQL.
- Không import telemetry, command log hoặc event log từ SQLite.
- Chuyển `DATABASE_DRIVER=postgres`.
- Khởi động lại backend và kiểm tra MQTT/database health.
- Chạy smoke test ghi/đọc telemetry, command và event bằng đúng thiết bị đã seed.
- Xóa toàn bộ bản ghi smoke test sau khi kiểm tra.

**Trạng thái ngày 19/08/2026: Đã hoàn thành.**

- PostgreSQL có đúng một broker và một thiết bị, không tạo trùng khi chạy seed lần hai.
- Health backend báo MQTT và database `connected`.
- Thiết bị thật đang offline tại thời điểm nghiệm thu nên chưa phát sinh telemetry vận hành mới.
- SQLite và backup giai đoạn 1 vẫn được giữ nguyên, nhưng không còn là database đang hoạt động.

### Giai đoạn 4 — Đa broker và đa thiết bị phía backend

**Thời gian dự kiến:** 3 ngày

Việc cần làm:

- Tạo `MqttConnectionManager`.
- Tạo `DeviceRegistry`.
- Tạo `TopicRouter`.
- Khởi tạo runtime từ cấu hình PostgreSQL.
- Subscribe tất cả topic đang bật.
- Thêm/sửa/xóa thiết bị ở runtime mà không cần restart backend.
- Kết nối lại broker khi cấu hình thay đổi.
- Tách trạng thái broker khỏi trạng thái thiết bị.
- Tạo một `CommandService` cho mỗi thiết bị.
- Phát Socket.IO event có `deviceId` và `connectionId` phù hợp.
- Xử lý shutdown tất cả MQTT client.

Điều kiện hoàn thành:

- Hai thiết bị cùng broker nhận telemetry độc lập.
- Hai broker kết nối đồng thời.
- Một broker mất kết nối không làm broker khác dừng.
- Hai thiết bị có thể cùng có lệnh pending.
- Message không bị chuyển nhầm thiết bị.

### Giai đoạn 5 — API quản lý cấu hình

**Thời gian dự kiến:** 1,5–2 ngày

Việc cần làm:

- API CRUD MQTT connection.
- API test connection.
- API reconnect.
- API CRUD thiết bị.
- Kiểm tra trùng topic.
- Chặn xóa broker có thiết bị phụ thuộc.
- Mã hóa password bằng AES-GCM.
- Mask password trong response.
- Không ghi password vào log.
- Kiểm tra host, port và protocol hợp lệ.

Điều kiện hoàn thành:

- Có thể thêm broker mà không sửa `.env`.
- Có thể thêm thiết bị mà không restart backend.
- Test connection trả đúng thành công/thất bại.
- Password không xuất hiện trong API response và log.

### Giai đoạn 6 — Giao diện cấu hình và dashboard nhiều thiết bị

**Thời gian dự kiến:** 2,5–3 ngày

Việc cần làm:

- Tách `App.tsx` thành pages/components/hooks.
- Thêm trang MQTT connections.
- Thêm form test, thêm và sửa connection.
- Thêm trang danh sách thiết bị.
- Thêm form thiết bị.
- Thêm bộ chọn thiết bị trên dashboard.
- Thay toàn bộ `mayhutam1` ghi cứng bằng thiết bị được chọn.
- Cập nhật Socket.IO theo thiết bị.
- Thêm trạng thái loading, empty và error.
- Giữ phong cách giao diện công nghiệp tối giản hiện tại.

Điều kiện hoàn thành:

- Người dùng cấu hình broker và thiết bị hoàn toàn trên web.
- Chuyển thiết bị không cần tải lại toàn trang.
- Dashboard không trộn dữ liệu giữa các thiết bị.
- Cài đặt gửi đúng thiết bị đang chọn.

### Giai đoạn 7 — Độ ổn định và quan sát vận hành

**Thời gian dự kiến:** 1–1,5 ngày

Việc cần làm:

- Chuẩn hóa log có thời gian, connection ID và device ID.
- Thêm log reconnect nhưng giới hạn tần suất.
- Thêm health check chi tiết.
- Thêm timeout query database.
- Kiểm tra graceful shutdown.
- Kiểm tra backend khởi động khi một broker đang offline.
- Kiểm tra PostgreSQL tạm mất kết nối.
- Bảo đảm lỗi một thiết bị không dừng toàn hệ thống.

### Giai đoạn 8 — Kiểm thử, nghiệm thu và bàn giao

**Thời gian dự kiến:** 2 ngày

Việc cần làm:

- Unit test.
- Integration test PostgreSQL.
- Integration test MQTT bằng broker kiểm thử/MQTTX.
- Test hai broker và nhiều thiết bị.
- Test giao diện theo checklist.
- Test migration trên bản copy dữ liệu thật.
- Test hiệu năng cơ bản.
- Viết hướng dẫn cài đặt và vận hành.
- Lập biên bản nghiệm thu.

## 12. Thời gian tổng thể dự kiến

| Giai đoạn | Thời gian |
|---|---:|
| Chuẩn bị | 0,5 ngày |
| Repository/database abstraction | 1,5 ngày |
| PostgreSQL và migration schema | 1,5–2 ngày |
| Chuyển dữ liệu | 1 ngày |
| Đa broker/đa thiết bị | 3 ngày |
| API cấu hình | 1,5–2 ngày |
| Giao diện | 2,5–3 ngày |
| Ổn định hệ thống | 1–1,5 ngày |
| Kiểm thử và nghiệm thu | 2 ngày |
| **Tổng** | **13–16 ngày làm việc** |

Thời gian trên dành cho một người phát triển có AI hỗ trợ, giữ phạm vi như tài liệu và có sẵn broker/thiết bị để kiểm thử.

## 13. Chiến lược kiểm thử

### 13.1. Unit test

- Parse telemetry chuẩn.
- Chuẩn hóa telemetry firmware cũ.
- Build command đúng CRLF.
- Map `SMART = 0`, `CONTINUOUS = 1`.
- Timeout lệnh.
- Xác nhận lệnh qua response.
- Xác nhận lệnh qua telemetry.
- Chuyển trạng thái online/offline.
- Sinh sự kiện khi trạng thái thay đổi.
- Mã hóa và giải mã password.
- Lấy mẫu lịch sử tối đa 240 điểm.

### 13.2. Integration test

- Repository với PostgreSQL thật.
- Migration trên database rỗng.
- Migration dữ liệu SQLite.
- API CRUD broker.
- API CRUD thiết bị.
- MQTT client kết nối broker kiểm thử.
- Subscribe nhiều topic.
- Publish đúng topic thiết bị.
- Socket.IO nhận đúng `deviceId`.

### 13.3. End-to-end test

- Tạo broker trên trang web.
- Test connection.
- Lưu broker.
- Tạo hai thiết bị.
- Publish telemetry bằng MQTTX.
- Kiểm tra dashboard hai thiết bị.
- Gửi hai lệnh độc lập.
- Kiểm tra lịch sử PostgreSQL.
- Làm broker offline và online lại.

## 14. Bộ tiêu chí nghiệm thu

### 14.1. Nghiệm thu PostgreSQL

| ID | Nội dung | Kết quả mong đợi |
|---|---|---|
| DB-01 | Khởi tạo database rỗng | Migration tạo đủ bảng và index |
| DB-02 | Restart backend | Kết nối lại PostgreSQL thành công |
| DB-03 | Ghi telemetry | Dữ liệu đúng device và thời gian |
| DB-04 | Truy vấn 1/6/24 giờ | Trả đúng khoảng thời gian, tối đa khoảng 240 điểm |
| DB-05 | Mất PostgreSQL tạm thời | Backend báo degraded, không crash không kiểm soát |
| DB-06 | Backup và restore | Khôi phục được database kiểm thử |

### 14.2. Nghiệm thu chuyển dữ liệu

| ID | Nội dung | Kết quả mong đợi |
|---|---|---|
| MIG-01 | Import telemetry | Tổng số bản ghi khớp SQLite |
| MIG-02 | Import commands | ID, status và thời gian khớp |
| MIG-03 | Import events | Nội dung và severity khớp |
| MIG-04 | Kiểm tra thời gian đầu/cuối | Giá trị khớp SQLite |
| MIG-05 | Chạy lại script | Không tạo bản ghi trùng |

### 14.3. Nghiệm thu nhiều kết nối MQTT

| ID | Nội dung | Kết quả mong đợi |
|---|---|---|
| MQTT-01 | Kết nối broker hợp lệ | Trạng thái `connected` |
| MQTT-02 | Sai host/port | Báo lỗi rõ ràng, không lưu password ra log |
| MQTT-03 | Hai broker đồng thời | Cả hai hoạt động độc lập |
| MQTT-04 | Một broker offline | Broker còn lại vẫn nhận dữ liệu |
| MQTT-05 | Broker hoạt động trở lại | Backend tự reconnect |
| MQTT-06 | Chỉnh broker trên web | Runtime kết nối lại bằng cấu hình mới |
| MQTT-07 | Tắt connection | MQTT client tương ứng đóng an toàn |

### 14.4. Nghiệm thu nhiều thiết bị

| ID | Nội dung | Kết quả mong đợi |
|---|---|---|
| DEV-01 | Hai thiết bị cùng broker | Nhận đúng topic và không trộn dữ liệu |
| DEV-02 | Thiết bị ở hai broker | Cùng hiển thị realtime |
| DEV-03 | Một thiết bị offline | Chỉ thiết bị đó chuyển offline |
| DEV-04 | Đổi topic | Topic cũ unsubscribe, topic mới hoạt động |
| DEV-05 | Trùng telemetry topic | API từ chối cấu hình |
| DEV-06 | Gửi lệnh hai thiết bị | Hai lệnh pending độc lập |
| DEV-07 | Response thiết bị | Cập nhật đúng command của đúng thiết bị |

### 14.5. Nghiệm thu giao diện

| ID | Nội dung | Kết quả mong đợi |
|---|---|---|
| UI-01 | Danh sách broker | Hiển thị đủ trạng thái và số thiết bị |
| UI-02 | Test connection | Có trạng thái đang kiểm tra và kết quả |
| UI-03 | Sửa broker | Không hiển thị password cũ |
| UI-04 | Danh sách thiết bị | Online/offline cập nhật realtime |
| UI-05 | Chuyển thiết bị | Dashboard đổi đúng dữ liệu |
| UI-06 | Gửi cài đặt | Lệnh đi đúng thiết bị được chọn |
| UI-07 | Lịch sử | Dữ liệu đúng thiết bị và khoảng thời gian |
| UI-08 | Lỗi backend/broker | Thông báo dễ hiểu, không hiển thị stack trace |

### 14.6. Nghiệm thu bảo mật cấu hình

| ID | Nội dung | Kết quả mong đợi |
|---|---|---|
| SEC-01 | GET MQTT connection | Không có password/encrypted password |
| SEC-02 | Log backend | Không chứa password |
| SEC-03 | Database | Password không lưu dạng rõ |
| SEC-04 | Sai encryption key | Backend từ chối khởi động hoặc báo lỗi rõ ràng |
| SEC-05 | Form sửa để trống password | Giữ password cũ |

### 14.7. Nghiệm thu hiệu năng cơ bản

Mục tiêu ban đầu:

- Mô phỏng 50 thiết bị, mỗi thiết bị gửi một bản tin mỗi 5 giây.
- Tổng tải trung bình khoảng 10 telemetry/giây.
- Chạy liên tục tối thiểu 2 giờ trong bài kiểm thử tải.
- Không trộn hoặc mất dữ liệu do lỗi logic ứng dụng.
- Backend không tăng bộ nhớ liên tục không kiểm soát.
- Telemetry hiển thị trên dashboard trong vòng 2 giây kể từ khi backend nhận bản tin ở điều kiện mạng nội bộ bình thường.
- API lịch sử 24 giờ của một thiết bị phản hồi dưới 2 giây ở bộ dữ liệu kiểm thử.
- Broker trở lại hoạt động phải được reconnect trong vòng 30 giây.
- Timeout command 15 giây với sai số cho phép khoảng 1 giây.

Các con số này là tiêu chí cho phiên bản đầu, không phải benchmark tối đa của PostgreSQL.

## 15. Kịch bản nghiệm thu thực tế bằng MQTTX

### Kịch bản A — Hai thiết bị cùng broker

1. Tạo broker `Broker nhà máy` trên web.
2. Kiểm tra kết nối thành công.
3. Tạo `mayhutam1` và `mayhutam2`.
4. Dùng MQTTX publish hai telemetry khác nhau.
5. Chuyển qua lại hai thiết bị trên dashboard.
6. Xác nhận số liệu không bị trộn.
7. Kiểm tra PostgreSQL có đúng `device_id`.

### Kịch bản B — Hai broker

1. Tạo broker A và broker B.
2. Gán mỗi thiết bị vào một broker.
3. Publish telemetry đồng thời.
4. Dừng broker A.
5. Xác nhận thiết bị A offline và thiết bị B vẫn hoạt động.
6. Khởi động broker A và xác nhận reconnect.

### Kịch bản C — Gửi lệnh đồng thời

1. Gửi lệnh cho thiết bị 1.
2. Trước khi thiết bị 1 phản hồi, gửi lệnh cho thiết bị 2.
3. Gửi phản hồi thành công cho thiết bị 2 trước.
4. Xác nhận chỉ command thiết bị 2 thành công.
5. Gửi phản hồi thiết bị 1.
6. Xác nhận command thiết bị 1 thành công.

### Kịch bản D — Timeout

1. Gửi lệnh cho thiết bị.
2. Không gửi response và không đổi telemetry setpoint.
3. Chờ 15 giây.
4. Xác nhận command chuyển `timeout`.
5. Xác nhận thiết bị khác vẫn gửi lệnh bình thường.

## 16. Backup, chuyển đổi và rollback

### 16.1. Backup trước chuyển đổi

- Source code.
- `.env`.
- `data/nhiet-am-mqtt.db`.
- File WAL/SHM nếu backend vẫn đang chạy; tốt nhất dừng backend trước khi copy.
- Dump PostgreSQL sau khi import.

### 16.2. Điều kiện rollback

Rollback nếu xảy ra một trong các trường hợp:

- Số bản ghi chuyển đổi không khớp.
- Backend không thể ghi telemetry ổn định.
- Command bị gửi nhầm thiết bị.
- Truy vấn lịch sử sai dữ liệu.
- PostgreSQL không thể vận hành ổn định trong môi trường triển khai.

### 16.3. Cách rollback

1. Dừng backend phiên bản mới.
2. Khôi phục source/tag trước chuyển đổi.
3. Khôi phục `.env` cũ.
4. Đưa file SQLite backup về `data/`.
5. Chạy backend cũ.
6. Kiểm tra telemetry và command.

Không xóa SQLite backup ít nhất 30 ngày sau nghiệm thu.

## 17. Rủi ro và biện pháp xử lý

| Rủi ro | Ảnh hưởng | Biện pháp |
|---|---|---|
| Nhiều thiết bị dùng chung response topic không có Device ID | Xác nhận nhầm lệnh | Bắt buộc topic riêng hoặc xác nhận qua telemetry riêng |
| Password MQTT bị lộ | Mất an toàn broker | Mã hóa, mask API, lọc log |
| PostgreSQL dừng | Không lưu/truy xuất lịch sử | Health check, backup, giám sát và retry có giới hạn |
| Query lịch sử lớn | Dashboard chậm | Index, giới hạn khoảng thời gian, lấy mẫu 240 điểm |
| Thay cấu hình topic khi đang chạy | Mất message ngắn hạn | Trình tự subscribe mới trước, sau đó unsubscribe cũ khi phù hợp |
| Broker reconnect liên tục | Log và CPU tăng | Backoff, giới hạn log, trạng thái runtime rõ ràng |
| Migration dữ liệu sai timezone | Biểu đồ sai thời gian | Chuẩn hóa ISO/TIMESTAMPTZ và đối chiếu mẫu |
| Một file frontend quá lớn | Khó bảo trì | Tách pages/components/hooks trong giai đoạn giao diện |

## 18. Tài liệu cần bàn giao

- Hướng dẫn cài PostgreSQL.
- Hướng dẫn tạo database và application user.
- Hướng dẫn chạy migration.
- Hướng dẫn backup/restore.
- Hướng dẫn cấu hình broker trên website.
- Hướng dẫn thêm thiết bị và topic.
- Hướng dẫn sử dụng MQTTX để kiểm thử.
- Danh sách biến môi trường.
- Sơ đồ kiến trúc.
- Danh sách API.
- Báo cáo migration dữ liệu.
- Báo cáo kiểm thử.
- Biên bản nghiệm thu.

## 19. Definition of Done

Dự án được xem là hoàn thành phạm vi này khi:

- PostgreSQL là database chính và không còn code runtime phụ thuộc `node:sqlite`.
- Migration database chạy thành công từ database rỗng.
- Dữ liệu SQLite cũ đã được chuyển và đối chiếu.
- Có thể cấu hình broker hoàn toàn trên website.
- Có thể thêm thiết bị hoàn toàn trên website.
- Kết nối đồng thời ít nhất hai broker.
- Quản lý đồng thời ít nhất hai thiết bị trên cùng broker.
- Realtime, lịch sử, command và event đúng theo từng thiết bị.
- Password MQTT không bị lộ qua API, log hoặc database dạng rõ.
- Các test bắt buộc đều vượt qua.
- Không còn lỗi build TypeScript.
- Có hướng dẫn cài đặt, backup, khôi phục và vận hành.
- Người nghiệm thu ký xác nhận các hạng mục chức năng chính.

## 20. Mẫu biên bản nghiệm thu

```text
Tên dự án: NhietAmMqtt
Phiên bản nghiệm thu:
Ngày nghiệm thu:
Môi trường:
PostgreSQL server:
MQTT broker sử dụng:
Số thiết bị kiểm thử:

Kết quả:
[ ] PostgreSQL và migration đạt
[ ] Chuyển dữ liệu SQLite đạt
[ ] Đa broker đạt
[ ] Đa thiết bị đạt
[ ] Cấu hình MQTT trên web đạt
[ ] Telemetry realtime đạt
[ ] Gửi và xác nhận command đạt
[ ] Lịch sử và nhật ký đạt
[ ] Backup/restore đạt
[ ] Kiểm thử bảo mật cấu hình đạt
[ ] Kiểm thử hiệu năng cơ bản đạt
[ ] Tài liệu bàn giao đầy đủ

Lỗi còn tồn tại/chấp nhận:

Kết luận:
[ ] Đạt nghiệm thu
[ ] Đạt có điều kiện
[ ] Chưa đạt

Người thực hiện:
Người nghiệm thu:
Ngày ký:
```

## 21. Bước triển khai tiếp theo

Bước đầu tiên sau khi phê duyệt tài liệu này là thực hiện **Giai đoạn 0 và Giai đoạn 1**:

1. Backup SQLite và cấu hình hiện tại.
2. Ghi nhận số lượng dữ liệu hiện có.
3. Chốt topic của ít nhất hai thiết bị kiểm thử.
4. Tạo repository interface.
5. Refactor backend để tách khỏi `node:sqlite` trước khi thay PostgreSQL.

Không nên bắt đầu bằng cách thay trực tiếp toàn bộ câu SQL trong `database.ts`, vì việc tạo repository trước sẽ giảm rủi ro và giúp kiểm thử/rollback dễ hơn.
