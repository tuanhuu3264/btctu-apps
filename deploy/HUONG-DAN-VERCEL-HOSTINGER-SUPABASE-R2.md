# Triển khai tách: giao diện (Vercel), API (Hostinger Node.js), PostgreSQL (Supabase), tệp (Cloudflare R2)

Bản dùng cho demo. Hồ sơ nộp mô tả phương án triển khai nội bộ; phương án đám mây công cộng này không thay cho phương án đó.

## 1. PostgreSQL trên Supabase

1. Tạo dự án Supabase, lấy chuỗi kết nối ở mục Database. Dùng cổng trực tiếp (5432) hoặc session pooler. Không dùng transaction pooler (cổng 6543) vì phần mềm chạy migration.
2. Biến cho API: `DB_HOST`, `DB_PORT=5432`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=postgres`, `DB_SSL=true`.
3. Nếu báo lỗi chứng chỉ, đặt tạm `DB_SSL_REJECT_UNAUTHORIZED=false`.

## 2. Tệp trên Cloudflare R2

1. Tạo bucket (ví dụ `kpi-files`) và API token có quyền đọc, ghi bucket đó.
2. Biến cho API:
   - `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`
   - `S3_REGION=auto`
   - `S3_BUCKET=kpi-files`
   - `S3_ACCESS_KEY`, `S3_SECRET_KEY` (của token R2)
   - `S3_FORCE_PATH_STYLE=false`

## 3. API trên Hostinger Node.js

1. Đẩy mã lên GitHub rồi kết nối với ứng dụng Node.js của Hostinger, thư mục gốc `src/be`.
2. Lệnh dựng: `npm install && npm run build`. Lệnh chạy: `npm run start:prod`. Cổng lấy theo biến `PORT` do Hostinger cấp.
3. Biến môi trường: các biến ở mục 1 và 2, cộng:
   - `FRONTEND_ORIGIN=https://<tên miền Vercel>`
   - `COOKIE_SECURE=true`
4. Lần chạy đầu, backend tự chạy migration. Tạo tài khoản quản trị bằng terminal của hPanel:
   `ADMIN_USERNAME=quantri ADMIN_PASSWORD='<từ 12 ký tự>' npm run create-admin`
5. Dữ liệu trình diễn (chỉ demo): `npm run seed-demo`, rồi `npm run seed-demo-periods`, `npm run seed-demo-scenarios`.
6. Kiểm tra: mở `https://<tên miền API>/api/health`.

## 4. Giao diện trên Vercel

1. Import kho GitHub, Root Directory là `src/fe`.
2. Biến môi trường:
   - `BACKEND_URL=https://<tên miền API>`
   - `NEXT_PUBLIC_API_URL=/api`
   - `API_URL=https://<tên miền API>/api`
3. Triển khai. Cấu hình `rewrites` trong `next.config.ts` chuyển `/api/*` sang API, nên cookie phiên (SameSite=Lax) hoạt động vì trình duyệt chỉ làm việc với một tên miền.

## Lưu ý

- Sao lưu bằng `backup` trong mã dùng `pg_dump` và cần công cụ Postgres trên máy chạy API; trên hosting dùng chung thường không có. Với bản demo, dùng tính năng sao lưu của Supabase.
- Giới hạn thời gian của Vercel: mỗi yêu cầu qua `rewrites` bị giới hạn thời gian; xuất tệp lớn có thể chậm.
- Không đưa mật khẩu và khóa R2 vào mã hoặc vào git.
