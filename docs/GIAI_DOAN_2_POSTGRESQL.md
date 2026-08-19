# Giai đoạn 2 - PostgreSQL 18

## Trạng thái

Phần mã nguồn và nghiệm thu PostgreSQL đã hoàn thành. PostgreSQL hiện là database vận hành; SQLite cũ được giữ nguyên nhưng không import dữ liệu lịch sử.

Kết quả ngày 19/08/2026:

- Migration đã tạo đủ năm bảng trên `hut_am_mqtt`.
- Chạy migration lần hai an toàn, không tạo lại schema.
- Integration test trên `hut_am_mqtt_test` đạt.
- PostgreSQL health check và ba API lịch sử hoạt động.
- Broker mặc định và thiết bị `mayhutam1` đã được seed.
- `DATABASE_DRIVER=postgres`; smoke test ghi/đọc đã đạt và dữ liệu thử đã được dọn sạch.

PostgreSQL trên máy:

- Service: `postgresql-x64-18`
- Host: `localhost`
- Port: `5432`
- Trạng thái: đang nhận kết nối

## Tạo database ứng dụng

Đăng nhập pgAdmin bằng tài khoản quản trị `postgres`, mở Query Tool và chạy:

```sql
CREATE ROLE nhiet_am_app
WITH LOGIN
PASSWORD 'THAY_BANG_MAT_KHAU_RIENG'
NOSUPERUSER
NOCREATEDB
NOCREATEROLE;

CREATE DATABASE nhiet_am_mqtt
WITH OWNER = nhiet_am_app
ENCODING = 'UTF8';
```

Nên tạo database kiểm thử riêng để integration test không đụng dữ liệu ứng dụng:

```sql
CREATE DATABASE nhiet_am_mqtt_test
WITH OWNER = nhiet_am_app
ENCODING = 'UTF8';
```

## Cấu hình cục bộ

Không commit `.env`. Trong giai đoạn 2 giữ:

```dotenv
DATABASE_DRIVER=sqlite
DATABASE_URL=postgresql://nhiet_am_app:MAT_KHAU@localhost:5432/nhiet_am_mqtt
```

Nếu password chứa ký tự đặc biệt như `@`, `:`, `/` hoặc `#`, phải URL-encode phần password.

## Chạy migration

```powershell
npm run db:migrate
```

Lệnh này tạo năm bảng ứng dụng và bảng `pgmigrations`. Chạy lại lần hai phải trả về không có migration mới, không tạo trùng bảng.

## Chạy integration test

Trong cửa sổ PowerShell chỉ dùng cho kiểm thử:

```powershell
$env:TEST_DATABASE_URL='postgresql://nhiet_am_app:MAT_KHAU@localhost:5432/nhiet_am_mqtt_test'
npm run test:postgres
Remove-Item Env:TEST_DATABASE_URL
```

Test tự tạo broker/device có ID ngẫu nhiên và xóa dữ liệu fixture sau khi hoàn tất. Không trỏ `TEST_DATABASE_URL` vào database sản xuất.

## Chuyển backend sang PostgreSQL để kiểm tra

Chỉ thực hiện sau khi migration và integration test đạt:

```dotenv
DATABASE_DRIVER=postgres
```

PostgreSQL lúc này chưa có dữ liệu SQLite cũ. Sau khi kiểm tra phải đổi lại `sqlite` cho đến khi hoàn thành giai đoạn 3.

## Quay lui

Đổi lại:

```dotenv
DATABASE_DRIVER=sqlite
```

Khởi động lại backend. File `data/nhiet-am-mqtt.db` và bản backup giai đoạn 1 không bị PostgreSQL migration tác động.
