# Nginx đứng trước ứng dụng

Cấu hình reverse proxy cho cấp độ 3 (QĐ 342 Điều 21.1: TLS cho mọi kết nối người dùng). Một tên miền, một nguồn gốc: `/api/` về backend NestJS (cổng 4000), còn lại về giao diện Next.js (cổng 3000). Quyết định và kết quả kiểm thử: ADR-049.

| Tệp | Nội dung |
|---|---|
| `nginx.conf` | Cấu hình đầy đủ: HTTP chuyển sang HTTPS, TLS 1.2/1.3, HSTS, ẩn phiên bản, giới hạn kích thước thân, timeout, giới hạn tần suất `/api/auth/` (gồm `/api/auth/mfa/*`), nén, chặn đường dẫn không cần |
| `snippets/` | Tiêu đề bảo mật và khối chuyển tiếp về backend, dùng chung cho các location |
| `docker-compose.yml` | Chạy thử: Nginx và bước sinh chứng chỉ tự ký, trỏ tới BE/FE chạy trên máy chủ qua `host.docker.internal` |
| `gen-selfsigned.sh` | Sinh chứng chỉ tự ký vào `certs/` (chỉ khi chưa có) |
| `certs/` | Chứng chỉ và khóa riêng. `.gitignore` chặn mọi tệp trong thư mục này, không đưa vào kho mã |

## Chạy thử

1. Chạy backend với biến môi trường (cổng 4000, chỉ nghe nội bộ):
   ```
   TRUST_PROXY=1
   COOKIE_SECURE=true
   FRONTEND_ORIGIN=https://localhost
   ```
   `TRUST_PROXY=1` để backend lấy IP thật từ `X-Forwarded-For` do Nginx ghi (giới hạn tần suất, nhật ký). `COOKIE_SECURE=true` để cookie phiên có cờ `Secure`. `FRONTEND_ORIGIN` là địa chỉ người dùng gõ, đúng chữ, không có dấu `/` cuối (dùng cho CORS và `frame-ancestors`).
2. Build và chạy giao diện với địa chỉ API công khai (biến `NEXT_PUBLIC_API_URL` được nhúng lúc build):
   ```
   cd src/fe
   NEXT_PUBLIC_API_URL=https://localhost/api API_URL=http://localhost:4000/api npm run build
   npm start
   ```
3. Dựng Nginx:
   ```
   docker compose -f deploy/nginx/docker-compose.yml up -d
   docker exec kpi-nginx nginx -t
   ```
   Mở `https://localhost` (trình duyệt cảnh báo chứng chỉ tự ký, bình thường). Thử bằng `curl -k`. Cổng khác: đặt `KPI_HTTP_PORT`, `KPI_HTTPS_PORT`; khi đó nhớ rằng chuyển hướng HTTP luôn trỏ cổng 443 mặc định.
4. Dừng: `docker compose -f deploy/nginx/docker-compose.yml down`.

## Dùng chứng chỉ thật

Đặt chuỗi chứng chỉ (chứng chỉ máy chủ kèm chứng chỉ trung gian) vào `certs/fullchain.pem` và khóa riêng vào `certs/privkey.pem`. Bước sinh tự ký bỏ qua khi hai tệp đã có. Sửa `server_name` trong `nginx.conf` thành tên miền thật, đặt `FRONTEND_ORIGIN=https://<tên miền>` và build lại giao diện với `NEXT_PUBLIC_API_URL=https://<tên miền>/api`. Với chứng chỉ do CA cấp, bỏ chú thích dòng `ssl_stapling` trong `nginx.conf`. Khóa riêng phải do đơn vị vận hành giữ, phân quyền chỉ tài khoản Nginx đọc được.

Triển khai thật không dùng Docker: sao chép `nginx.conf` và `snippets/` vào `/etc/nginx/`, đổi hai khối `upstream` về `127.0.0.1:4000` và `127.0.0.1:3000` (hoặc địa chỉ nội bộ), bỏ dòng `pid /tmp/nginx.pid` nếu hệ điều hành đã có sẵn.

## Những điều cần biết

- **Cổng 4000 và 3000 không được mở ra ngoài.** Nginx chỉ bảo vệ khi mọi người đi qua nó. Ai gọi thẳng backend sẽ gửi được `X-Forwarded-For` giả để né giới hạn tần suất. Chặn bằng tường lửa hoặc cho nghe địa chỉ nội bộ; việc này nằm ở hạ tầng, không ở cấu hình này.
- **IP trong nhật ký** là IP kết nối tới Nginx. Chạy bằng Docker Desktop (Windows, macOS) thì mọi yêu cầu từ máy chủ đều hiện là địa chỉ cổng mạng Docker (kiểu `172.x.0.1`); trên máy chủ Linux hoặc Nginx cài trực tiếp thì là IP máy khách thật.
- **Sau CDN hoặc bộ cân bằng tải** phía trước Nginx: sửa `snippets/api-proxy.conf` (và khối `/` trong `nginx.conf`) dùng `$proxy_add_x_forwarded_for`, đặt `TRUST_PROXY=2`.
- **Giới hạn kích thước thân**: 1 MB mặc định; `/api/tasking/assignments/<id>/attachments` 22 MB (một tệp 20 MB, `MAX_FILE_BYTES`); `/api/documents/posts` 205 MB (10 tệp x 20 MB). Đổi giới hạn trong BE thì đổi ở đây.
- **Tiêu đề bảo mật**: Nginx đặt HSTS và `nosniff` (ẩn bản của upstream để không trùng); `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors`, `Cache-Control` vẫn do ứng dụng gửi. Chưa có CSP đầy đủ (ADR-032).
- Nhật ký truy cập ở `/var/log/nginx` trong container (đẩy ra stdout theo mặc định của image). Chưa gắn WAF; đó là hạng mục riêng của lộ trình.
