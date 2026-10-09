# Phần mềm quản lý, đánh giá kết quả thực hiện nhiệm vụ bằng KPI/OKR – Ban Tổ chức Tỉnh ủy Đắk Lắk

Bài kiểm tra năng lực vị trí CNTT. Đề bài: `docs/tai_lieu_tham_khao/Đề kiểm tra năng lực BTCTU.docx`.

## Cấu trúc thư mục

| Thư mục | Nội dung |
|---|---|
| `docs/` | Tài liệu gốc; `docs/ocr_md/` là bản md, có Nghị định 335/2025/NĐ-CP là căn cứ công thức KPI (PDF scan là OCR, cần đối chiếu bản gốc) |
| `knowledge/specs/` | Đặc tả yêu cầu (SPEC-001) |
| `knowledge/adr/` | Các quyết định kiến trúc (ADR-001 … 010) |
| `gap/` | Khoảng trống tài liệu chưa trả lời, giả định đang dùng (GAP.md) |
| `database/` | PostgreSQL dùng tạm và MinIO lưu tệp đính kèm (docker compose; MinIO cổng 9100, giao diện 9101) |
| `src/be/` | Backend NestJS (TypeScript, TypeORM) |
| `src/fe/` | Frontend Next.js (TypeScript) dùng Ant Design 6: khung có menu theo quyền ở `src/app/(app)/`, trang đăng nhập ở `src/app/login/` |

## Chạy thử

Yêu cầu: Node 22, Docker.

```bash
# 1. CSDL
docker compose -f database/docker-compose.yml up -d

# 2. Backend (cổng 4000, tự chạy migration khi khởi động)
cd src/be && cp .env.example .env && npm install && npm run build
ADMIN_USERNAME=quantri ADMIN_PASSWORD='<mật khẩu từ 12 ký tự>' npm run create-admin   # tạo tài khoản đầu tiên (vai trò QUAN_TRI_HE_THONG)
npm run start:prod

# Nạp danh mục sản phẩm công việc thành BẢN NHÁP mới (không bao giờ ghi đè; cần rà soát rồi trình phê duyệt)
npm run import-catalog -- "../../docs/tai_lieu_tham_khao/Danh mục công việc của BTCTU 27.9.2026.xlsx" --label "Bản nháp từ Excel 27.9.2026" --dry-run

# Nạp cơ cấu tổ chức từ tệp Excel phân công (chạy lại nhiều lần an toàn; --dry-run chỉ kiểm tra)
npm run import-org -- "../../docs/tai_lieu_tham_khao/Cay_so_do_phan_cong_nhiem_vu_Ban_To_chuc_Tinh_uy (3).xlsx" --dry-run

# 3. Frontend (cổng 3000)
cd src/fe && cp .env.example .env.local && npm install && npm run dev
```

Kiểm tra: `http://localhost:4000/api/health`; mở `http://localhost:3000` sẽ chuyển sang trang đăng nhập.

Lưu ý chạy thử cục bộ: frontend đọc cookie phiên do backend đặt cho `localhost`, nên frontend và backend phải cùng host (khác cổng thì được). Môi trường thật cần cùng tên miền gốc và bật `COOKIE_SECURE=true` trên HTTPS.

## Kiểm thử

```bash
cd src/be
npm test            # test đơn vị (không cần CSDL)
npm run test:e2e    # cần PostgreSQL đang chạy; tự tạo lại CSDL riêng `kpi_e2e` mỗi lần (nhật ký không xóa được nên không dùng CSDL phát triển)
```

## Kiến trúc (ADR-009, ADR-010)

Monolith mô-đun, 3 lớp trong mỗi mô-đun: `presentation` (Controller, DTO) → `application` (Service, quy tắc nghiệp vụ) → `data-access` (Repository, TypeORM). Service chỉ phụ thuộc interface Repository (inject qua constructor).

Trạng thái triển khai hiện tại:

| Mô-đun | Trạng thái |
|---|---|
| `organization` | Đơn vị, cán bộ, vị trí việc làm, phân công theo thời gian, sơ đồ tổ chức, cấp dưới/cấp trên; nhập từ Excel (ADR-012). Giao diện `/organization` (quản lý cán bộ, vị trí, đơn vị, phân công; chỉ vai trò có `org:manage`). Chưa có: sửa/xóa đơn vị, kiêm nhiệm |
| `scoring` | Hàm xếp loại theo ngưỡng điểm và tổng điểm 30 + 70 (đã test); chưa có điều kiện kèm theo và hạn mức xuất sắc |
| `security` | Lát 1–3 xong: tài khoản, đăng nhập bằng cookie phiên, khóa tạm khi sai nhiều lần, 7 vai trò có thời hạn, ma trận quyền, mặc định từ chối hai tầng, tách quyền, nhật ký bất biến có chuỗi băm (ADR-011). Giao diện: `/accounts` (tạo tài khoản, gắn cán bộ, cấp/thu hồi vai trò, khóa). Chưa có giao diện nhật ký, phạm vi dữ liệu theo cây tổ chức, rà soát quyền |
| `catalog` | Danh mục sản phẩm công việc chuẩn: **Nhóm (thêm được, A–Z, ADR-020) → Nhiệm vụ → Công việc** (ADR-019), phiên bản (có **tên danh mục** và nhãn phiên bản), phê duyệt (bản đã duyệt bất biến), công việc chuẩn và hệ số quy đổi; **phạm vi áp dụng** của công việc theo đơn vị, vị trí để chỉ giao đúng người (ADR-021); nhập từ Excel thành bản nháp (ADR-013). Giao diện: `/catalog` (xem, tạo bản nháp, thêm/sửa/xóa công việc, đặt công việc chuẩn, phê duyệt). Chưa ánh xạ công việc → vị trí |
| `evaluation` | Kỳ đánh giá (tháng, quý I–III, năm), hồ sơ, chỉ tiêu theo danh mục, luồng tự chấm → thẩm định → phê duyệt, chính sách điểm v2 theo Phụ lục 2 của 05-HD/TU (KPI A, B, C, D; ADR-017), phạm vi xem theo cây vị trí, hồ sơ đã duyệt bất biến (ADR-014). Chưa có: hạn mức xuất sắc và điều kiện loại trừ, điểm năm, đánh giá tập thể. Giao diện: trang `/evaluations` (danh sách theo kỳ, chi tiết hồ sơ, giao chỉ tiêu, tự chấm, thẩm định, trả lại, phê duyệt; nút hiện theo quyền và trạng thái, máy chủ vẫn kiểm tra lại). Cũng có tạo và đóng kỳ, tạo hồ sơ cho cấp dưới trực tiếp |
| `tasking` | **Cộng tác trên việc** (ADR-024): người duyệt (cc), người tham vấn, trao đổi, tệp đính kèm lưu ở MinIO (S3), danh sách có lọc và phân trang. **Nhiệm vụ** do cấp trên đặt cho từng cán bộ (ADR-018), chứa các việc từ danh mục; giao việc từ danh mục cho cấp dưới trực tiếp (số lượng, hạn, tính vào báo cáo tự động hoặc chọn tay), cán bộ báo cáo hoàn thành, cấp trên xác nhận hoặc từ chối, đếm số lần chậm và chưa đạt; Văn phòng tạo hồ sơ kỳ từ việc (ADR-016). Giao diện `/tasks`. Chưa có: sửa việc đã giao (hủy và giao lại), việc đột xuất ngoài danh mục, việc lặp định kỳ; chưa dùng số lần chậm, chưa đạt để trừ điểm (G-02) |
| `documents` | **Quản lý tài liệu** (ADR-025): danh mục tài liệu, bản tin tài liệu (đăng kèm tệp, lọc, phân trang), gom tệp của các việc mình tham gia. Dùng chung kho S3/MinIO với `tasking`. |
| `reporting` | Dashboard theo kỳ (tổng hợp, theo đơn vị, chi tiết) trong phạm vi người xem, xuất Excel/PDF có nhật ký, dự thảo báo cáo và quyết định điền mẫu (không dùng AI), trang `/reports` (ADR-015). Chưa có: biểu đồ, xếp loại tập thể, áp hạn mức xuất sắc tự động |
| `integration` | Mô-đun rỗng, chưa triển khai (chưa kết nối Trung ương) |

Chưa làm: phạm vi dữ liệu theo cây tổ chức, rà soát quyền, báo cáo Excel/PDF. MFA bỏ qua theo quyết định (xem `gap/GAP.md` G-12).
