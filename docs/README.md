# NhietAmMqtt

Web dashboard theo doi va dieu khien may hut am qua MQTT.

## Buoc 0 - Cau hinh MQTT

Project chua dung Docker. Cac gia tri MQTT duoc dat trong file `.env` tai thu muc goc project.

1. File `.env` mau da duoc tao tai thu muc goc project. Neu bi xoa, sao chep `.env.example` thanh `.env`.
2. Mo MQTTX va ket noi broker hien dang dung cho thiet bi.
3. Cap nhat `MQTT_BROKER_URL`, `MQTT_USE_TLS`, `MQTT_USERNAME` va `MQTT_PASSWORD` trong `.env` neu broker khac cau hinh mac dinh.
4. Subscribe topic `mayhutam1/nhan` trong MQTTX.
5. Xac nhan thiet bi gui JSON telemetry dinh ky khoang 5 giay mot lan.

Topic giu theo giao thuc hien tai:

| Muc dich | Topic |
| --- | --- |
| Telemetry tu thiet bi | `mayhutam1/nhan` |
| Lenh cai dat xuong thiet bi | `mayhutam1/caidat` |
| Phan hoi lenh tam thoi | `mayhutam1/nhan` |

Giao thuc hien tai chua quy dinh topic phan hoi rieng. Vi vay, `MQTT_RESPONSE_TOPIC` tam thoi dung `mayhutam1/nhan`; se tach thanh topic rieng neu firmware xac nhan sau.

## Luu y

- Khong commit file `.env`: file nay co the chua thong tin dang nhap broker.
- Cau hinh mac dinh `mqtt://localhost:1883` chi la gia tri mau, khong phai dia chi broker cua thiet bi.
- Không gửi lệnh điều khiển từ MQTTX trong ngày 1; chỉ subscribe và xác nhận telemetry.
- Khi broker đi qua Internet, thay `mqtt://` bang `mqtts://` va dat `MQTT_USE_TLS=true`.

## Buoc 1 - Cau truc project

Da khoi tao monorepo npm khong dung Docker:

| Thu muc | Cong nghe | Vai tro |
| --- | --- | --- |
| `frontend/` | React + TypeScript + Vite | Dashboard cho nguoi van hanh |
| `backend/` | Node.js + Express + Socket.IO | API, realtime va MQTT bridge |

Sau khi cai dependencies, co the chay:

```bash
npm run dev
```

Backend cung cap `GET http://localhost:3001/api/health`. Ket noi MQTT duoc bo sung o buoc 2; database se bo sung o buoc sau.

## Buoc 2 - MQTT bridge

Backend subscribe `MQTT_TELEMETRY_TOPIC` (mac dinh `mayhutam1/nhan`) va phat telemetry hop le qua Socket.IO event `telemetry:update`.

- Trang thai hien tai: `GET http://localhost:3001/api/devices/mayhutam1/state`
- Suc khoe backend/MQTT: `GET http://localhost:3001/api/health`
- Chua co ket noi database va chua publish lenh dieu khien.

Cap nhat `MQTT_BROKER_URL` trong `.env` bang gia tri connection tu MQTTX truoc khi chay `npm run dev:backend`.

## Dashboard, dieu khien va lich su

Chay ca backend va frontend:

```bash
npm run dev
```

Mo `http://localhost:5173` de xem telemetry realtime, canh bao va lich su gan day.

- Dashboard chi cho gui lenh khi thiet bi Online va backend dang ket noi.
- Lenh cai dat duoc publish vao `mayhutam1/caidat` voi CRLF that.
- Moi thiet bi chi co mot lenh dang cho phan hoi; timeout mac dinh la 10 giay.
- Telemetry va nhat ky lenh duoc luu tai `data/nhiet-am-mqtt.db`.
- Firmware hien tai gui JSON cu; backend tu chuan hoa ba gia tri chuoi truoc khi parse.
- Lich su telemetry co bo loc 1, 6 va 24 gio, kem thong ke min, max va trung binh.
- Nhat ky su kien chi ghi khi trang thai thay doi: online/offline, khay nuoc, cam bien, loi he thong va xa da.

## Lop truy cap du lieu

Backend khong con truy cap SQL truc tiep tu `src/index.ts`. Ba nhom du lieu duoc tach thanh repository bat dong bo:

| Repository | Du lieu |
| --- | --- |
| `TelemetryRepository` | Luu va truy van lich su do |
| `CommandRepository` | Luu/cap nhat va doc nhat ky lenh |
| `EventRepository` | Luu va doc nhat ky su kien |

Backend hien dung PostgreSQL. SQLite adapter van duoc giu trong `backend/src/database/sqlite/` de quay lui khi can, nhung du lieu SQLite cu khong duoc import.

Chay kiem tra sau khi thay doi database:

```bash
npm run test:unit
npm run check
npm run build
```

## PostgreSQL 18

PostgreSQL la driver van hanh chinh. Lich su bat dau moi tu thoi diem chuyen doi; SQLite cu chi duoc luu tru.

Bien moi trong `.env`:

```dotenv
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://hut_am_app:password@localhost:5432/hut_am_mqtt
DATABASE_POOL_MAX=10
DATABASE_CONNECTION_TIMEOUT_MS=5000
DATABASE_IDLE_TIMEOUT_MS=30000
DATABASE_SSL=false
```

Sau khi database va user PostgreSQL da duoc tao:

```bash
npm run db:migrate
npm run db:seed:current
npm run db:smoke
npm run db:verify
```

De chay integration test, dat `TEST_DATABASE_URL` tro den mot database kiem thu rieng roi chay:

```bash
npm run test:postgres
npm run db:verify:test
```

Khong dung `db:migrate:down` tren database co du lieu that vi migration down se xoa cac bang ung dung.
