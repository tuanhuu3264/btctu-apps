# Sao lưu và phục hồi (ADR-058)

Công cụ nằm trong backend (`src/be`), chạy bằng `npm run` sau khi `npm run build`. Cấu hình bằng biến môi trường (hoặc tệp `.env` ở `src/be`), dùng chung `DB_*`, `S3_*` với ứng dụng.

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `BACKUP_DIR` | Nơi lưu chính. Nên là ổ khác ổ chứa CSDL | `./backups` |
| `BACKUP_OFFSITE_DIR` | Nơi lưu thứ hai (ổ mạng, máy khác, ổ ngoài); trống thì chỉ lưu một nơi | trống |
| `BACKUP_ENCRYPTION_KEY` | 64 ký tự hex; có thì mã hóa AES-256-GCM. Môi trường thật phải đặt, cất tách khỏi bản sao lưu | trống |
| `BACKUP_KEEP_DAILY`, `_WEEKLY`, `_MONTHLY` | Số ngày, tuần, tháng giữ lại | 7, 4, 12 |
| `BACKUP_PG_CONTAINER` | Tên container PostgreSQL (chạy bằng docker exec). Trống thì dùng `pg_dump` trên máy | trống |
| `BACKUP_PG_BIN_DIR` | Thư mục chứa `pg_dump`, `pg_restore`, `psql` nếu không có trong PATH | trống |

Sinh khóa mã hóa: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Mất khóa là mất bản sao lưu**: lưu khóa ở nơi riêng (két mật khẩu của đơn vị).

## Lệnh

```
npm run backup                                  # sao lưu CSDL và tệp đính kèm
npm run backup:list                             # liệt kê các bản, thấy bản nào đã thử phục hồi
npm run backup:verify                           # thử phục hồi bản mới nhất vào CSDL tạm; mã thoát 2 nếu không đạt
npm run backup:verify -- 20261018-151047        # thử bản cụ thể
npm run backup:restore -- latest --into kpi_moi --with-files   # phục hồi vào CSDL trống (và đưa lại tệp đính kèm)
```

Mốc thời gian của bản sao lưu là giờ UTC (`YYYYMMDD-HHMMSS`). Mọi sự kiện ghi vào `BACKUP_DIR/backup.log`.

## Đặt lịch

Đề xuất: sao lưu mỗi đêm, thử phục hồi mỗi tuần. Chu kỳ sao lưu chính là lượng dữ liệu tối đa có thể mất khi có sự cố (do Ban quy định, GAP G-39).

Linux (cron, `crontab -e`):

```
30 1 * * *  cd /opt/kpi/src/be && /usr/bin/npm run backup        >> /var/log/kpi-backup.out 2>&1
30 3 * * 0  cd /opt/kpi/src/be && /usr/bin/npm run backup:verify >> /var/log/kpi-backup.out 2>&1
```

Windows (Task Scheduler, chạy bằng tài khoản dịch vụ có quyền đọc `.env`):

```
schtasks /Create /TN "KPI sao luu" /SC DAILY /ST 01:30 /TR "cmd /c cd /d D:\kpi\src\be && npm run backup"
schtasks /Create /TN "KPI thu phuc hoi" /SC WEEKLY /D SUN /ST 03:30 /TR "cmd /c cd /d D:\kpi\src\be && npm run backup:verify"
```

Cả hai lệnh thoát với mã khác 0 khi lỗi; bật cảnh báo "tác vụ thất bại" của lịch để có người biết.

## Phục hồi sau sự cố

1. Dựng lại PostgreSQL và kho tệp (MinIO) trống; chép bản sao lưu từ nơi thứ hai về `BACKUP_DIR`.
2. Tạo CSDL trống: `createdb -U kpi kpi_moi` (hoặc xóa CSDL hỏng rồi tạo lại).
3. `npm run backup:restore -- latest --into kpi_moi --with-files` (cần `BACKUP_ENCRYPTION_KEY` nếu bản được mã hóa).
4. Đặt `DB_NAME=kpi_moi` rồi khởi động ứng dụng; migration còn thiếu (nếu có) tự chạy.
5. Chạy `backup:verify` và kiểm tra chuỗi băm nhật ký trên màn hình Nhật ký hoạt động.

Hệ thống không bao giờ phục hồi đè lên CSDL đang có bảng; đó là chủ ý.
