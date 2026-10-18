# Phần mềm quản lý, đánh giá kết quả thực hiện nhiệm vụ bằng KPI/OKR – Ban Tổ chức Tỉnh ủy Đắk Lắk

Bài kiểm tra năng lực vị trí CNTT. Đề bài: `docs/tai_lieu_tham_khao/Đề kiểm tra năng lực BTCTU.docx`.

## Cấu trúc thư mục

| Thư mục | Nội dung |
|---|---|
| `docs/` | Tài liệu gốc; `docs/ocr_md/` là bản md, có Nghị định 335/2025/NĐ-CP là căn cứ công thức KPI (PDF scan là OCR, cần đối chiếu bản gốc) |
| `knowledge/specs/` | Đặc tả yêu cầu (SPEC-001) |
| `knowledge/adr/` | Các quyết định kiến trúc (ADR-001 … 060) |
| `knowledge/deliverables/` | Văn bản trả lời đề: `01-bo-tieu-chi-kpi-okr.md` (yêu cầu 1), `03-phuong-an-attt-cap-do-3.md` (yêu cầu 3). Yêu cầu 2 là phần mềm trong `src/`. `Van-ban-tra-loi-yeu-cau-1-va-3.docx` gộp hai văn bản thành một tệp Word để nộp; `Slide-tra-loi-yeu-cau-1-va-3.pptx` là bộ slide (có ghi chú diễn giả); `_build/` chứa công cụ dựng lại tệp Word từ hai văn bản md. Hồ sơ đề xuất cấp độ ở `ho-so-cap-do/` |
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

Hiện có 868 test đơn vị và 171 test end-to-end (đều đạt).

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
| `organization` | Đơn vị, cán bộ, vị trí việc làm, phân công theo thời gian, sơ đồ tổ chức, cấp dưới/cấp trên; nhập từ Excel (ADR-012). Ngừng sử dụng thay cho xóa, kiêm nhiệm (ADR-047), hồ sơ cán bộ mở rộng (ADR-023), cờ lãnh đạo, quản lý và cờ người lao động hỗ trợ, phục vụ (ADR-022, 053). Giao diện `/organization` (chỉ vai trò có `org:manage`) |
| `scoring` | Hàm xếp loại theo ngưỡng điểm và tổng điểm 30 + 70 (đã test). Điều kiện "Không hoàn thành nhiệm vụ" của cá nhân tính ở `evaluation` (ADR-055); hạn mức xuất sắc chỉ cảnh báo, không tự hạ bậc |
| `security` | Tài khoản, đăng nhập bằng cookie phiên, khóa tạm khi sai nhiều lần, 7 vai trò có thời hạn, ma trận quyền, mặc định từ chối hai tầng, tách quyền, nhật ký bất biến có chuỗi băm (ADR-011); xác thực nhiều lớp TOTP (ADR-048); giao diện tài khoản, nhật ký, rà soát quyền định kỳ (ADR-032, 044); tiêu đề bảo mật, giới hạn tần suất; **tự đóng phiên khi không thao tác** (ADR-057) |
| `catalog` | Danh mục sản phẩm công việc chuẩn: **Nhóm (thêm được, A–Z, ADR-020) → Nhiệm vụ → Công việc** (ADR-019), phiên bản (có **tên danh mục** và nhãn phiên bản), phê duyệt (bản đã duyệt bất biến), công việc chuẩn và hệ số quy đổi; **phạm vi áp dụng** của công việc theo đơn vị, vị trí để chỉ giao đúng người (ADR-021); nhập từ Excel thành bản nháp (ADR-013). Giao diện: `/catalog` (xem, tạo bản nháp, thêm/sửa/xóa công việc, đặt công việc chuẩn, phê duyệt). Chưa ánh xạ công việc → vị trí |
| `evaluation` | Kỳ đánh giá (tháng, quý I–III, năm), hồ sơ, chỉ tiêu theo danh mục, luồng tự chấm → thẩm định → phê duyệt, chính sách điểm theo Nghị định 335 (KPI a, b, c, d, đ, e; ADR-017), phạm vi xem theo cây vị trí, hồ sơ đã duyệt bất biến (ADR-014). **Tiêu chí chung 30 điểm chấm theo từng mục** (05-HD/TU Phụ lục 03, Nghị định 335 Mẫu số 01), bảng theo phiên bản (ADR-054). **Kỷ luật, kết luận và điều kiện "Không hoàn thành nhiệm vụ"** của năm, ngoại lệ có căn cứ (ADR-055). **Hủy kết quả đã phê duyệt để xếp loại lại** (ADR-059), **hạn mức xuất sắc của cá nhân: gợi ý theo thứ tự điểm** (ADR-060). Điểm năm là trung bình các tháng (ADR-035), miễn tháng nghỉ (ADR-039), đánh giá tập thể theo trục (ADR-030, 036, 052), khiếu nại (ADR-038). Giao diện `/evaluations`, `/unit-evaluations` |
| `tasking` | **Cộng tác trên việc** (ADR-024): người duyệt (cc), người tham vấn, trao đổi, tệp đính kèm lưu ở MinIO (S3). **Nhiệm vụ** do cấp trên đặt cho từng cán bộ (ADR-018), chứa các việc từ danh mục; giao việc cho cấp dưới trực tiếp, cán bộ báo cáo hoàn thành, cấp trên xác nhận hoặc từ chối, đếm số lần chậm và chưa đạt (trừ 25% mỗi lần theo Nghị định 335 Điều 14.2); **miễn trừ khi do nguyên nhân khách quan**, cấp và thu hồi được (ADR-056); việc đột xuất và việc lặp định kỳ (ADR-046); Văn phòng tạo hồ sơ kỳ từ việc (ADR-016). Giao diện `/tasks` |
| `documents` | **Quản lý tài liệu** (ADR-025): danh mục tài liệu, bản tin tài liệu (đăng kèm tệp, lọc, phân trang), gom tệp của các việc mình tham gia. Dùng chung kho S3/MinIO với `tasking`. |
| `reporting` | Dashboard theo kỳ có biểu đồ (ADR-027), trong phạm vi người xem; xuất Excel/PDF có nhật ký; dự thảo báo cáo và quyết định điền mẫu, tải Word (ADR-015, 028); báo cáo tập thể theo trục (ADR-031, 037); trang `/reports`. Chưa có: áp hạn mức xuất sắc tự động |
| `integration` | Mô-đun rỗng, chưa triển khai (chưa kết nối Trung ương) |

Chức năng bổ sung theo [PLAN-A](knowledge/plans/PLAN-A-bo-sung-chuc-nang.md):

| Mục | Nội dung | ADR |
|---|---|---|
| A1 | "Xóa" đơn vị, vị trí, công việc, nhiệm vụ trong danh mục chỉ là đổi trạng thái (ngừng sử dụng, kích hoạt lại, lý do); ghi ở PLAN-A, chưa có ADR riêng | – |
| A2 | Kiêm nhiệm: vị trí chính và kiêm nhiệm, mỗi vị trí một phiếu và điểm riêng, không gộp điểm (quy ước của dự án, GAP G-33) | 047 |
| A3 | Việc đột xuất (do cấp trên giao hoặc cán bộ đề xuất) và việc lặp định kỳ (tuần, tháng, quý, năm) | 046 |
| A4 | Rà soát quyền định kỳ hằng quý: quản trị tạo đợt, lãnh đạo phòng xác nhận | 044 |
| A5 | Nhật ký có `module`, `type`, lưu trước/sau thay đổi; lịch sử thay đổi theo đối tượng | 045 |
| A6 | Xuất Excel và PDF danh sách việc, nhật ký, tổ chức; thống kê việc (trạng thái, tỷ lệ chậm, chưa đạt, theo đơn vị); lọc theo loại việc | – |
| A7 | Tổng quan theo góc nhìn (toàn Ban, phòng, cá nhân), mục "Cần xử lý"; thêm dự thảo thông báo kết quả và ghi chú điểm năm | – |

Đề án, dự án (ADR-050): trang **Đề án, dự án** quản lý hồ sơ (đề án hoặc dự án), vòng đời soạn thảo, trình duyệt, phê duyệt, nghiệm thu, thành viên, mốc tiến độ có trọng số, tài liệu đính kèm, việc được giao gắn vào; cảnh báo mốc quá hạn trên Tổng quan; thống kê, xuất Excel và PDF. Điểm KPI không đổi (đề án chỉ nhóm và theo dõi việc).

Lịch họp (ADR-051): trang **Lịch họp** xem theo tuần, tháng, danh sách; mọi cán bộ tạo lịch và mời thành phần; người được mời xác nhận hoặc từ chối; cảnh báo trùng lịch khi tạo, sửa; chủ trì kết thúc họp để ghi kết luận, người có mặt, việc sau họp và tải biên bản; chọn phòng họp từ danh mục (Văn phòng quản lý) và cảnh báo trùng phòng; gắn đề án tùy chọn; Tổng quan có khối họp 7 ngày tới và việc sau họp còn mở.

Bảo mật và triển khai: xác thực nhiều lớp TOTP (ADR-048, biến `MFA_MODE`, `MFA_ENCRYPTION_KEY` trong `src/be/.env.example`); cấu hình Nginx, TLS và hướng dẫn trong [deploy/nginx](deploy/nginx/README.md) (ADR-049); tự đóng phiên sau `SESSION_IDLE_MINUTES` phút không thao tác (mặc định 30, cảnh báo trước 2 phút, ADR-057).

Sao lưu và phục hồi (ADR-058): `npm run backup` (CSDL và tệp đính kèm, mã hóa nếu đặt `BACKUP_ENCRYPTION_KEY`, chép sang nơi thứ hai, giữ 7 ngày, 4 tuần, 12 tháng), `backup:verify` (thử phục hồi vào CSDL tạm), `backup:list`, `backup:restore`. Cấu hình, đặt lịch và quy trình phục hồi sau sự cố: [deploy/backup](deploy/backup/README.md). Công cụ chưa tự chạy: người vận hành đặt lịch.

Chức năng sáng tạo (quy tắc rõ ràng, không dùng AI, không đổi công thức chấm điểm):

| Chức năng | Nội dung |
|---|---|
| Giải thích điểm | Hồ sơ tháng, quý có thẻ "Giải thích điểm và mô phỏng": điểm từng thành phần a, b, c, d, đ, e, điểm mất ở từng dòng việc (thiếu số lượng, chưa đạt, chậm), dẫn điều khoản Nghị định 335. Điểm giải thích cộng lại đúng bằng điểm kết quả |
| Mô phỏng "nếu…" | Thử đổi số lượng hoàn thành, số lần chậm, chưa đạt, điểm chung để xem điểm và xếp loại đổi thế nào; có gợi ý "làm gì để lên mức kế tiếp" và rủi ro bị trừ điểm. Chỉ tính, không ghi vào hồ sơ (`GET /evaluation/evaluations/:id/insight`, `POST .../simulate`) |
| Cảnh báo sớm | Khối trên Tổng quan: việc quá hạn, sắp đến hạn mà làm chưa được nửa, hoặc chậm so với tiến độ thời gian; kèm danh sách người cần nhắc (`GET /tasking/assignments/early-warning`) |
| Kịch bản trình diễn | `npm run seed-demo-scenarios` (sau `seed-demo`) dựng việc quá hạn, sắp đến hạn, chậm tiến độ, việc đột xuất đã duyệt và đang chờ duyệt cho tài khoản `chuyenvien`; chạy lại thì dời hạn theo ngày hôm nay |

Trình diễn nhanh: (1) `npm run seed-demo-scenarios`; (2) đăng nhập `phophong` hoặc `truongphong` (mật khẩu in lúc `seed-demo`): Tổng quan có "Cảnh báo sớm" và "Cần xử lý" (đề xuất đột xuất chờ duyệt); (3) vào Đánh giá theo kỳ, mở hồ sơ kỳ đang mở: thẻ Giải thích điểm, Để lên mức tiếp theo, Mô phỏng. Muốn khôi phục dữ liệu sau khi thử: tạo bản sao CSDL trước (`CREATE DATABASE kpi_demo TEMPLATE kpi;` khi chưa có kết nối vào `kpi`), chạy trên `kpi_demo` bằng `DB_NAME=kpi_demo`, hỏng thì xóa và tạo lại từ bản mẫu.

Chưa làm: kế hoạch KPI/OKR, tự động tính điểm tổng hợp cá nhân và tập thể mở rộng ([PLAN-B](knowledge/plans/PLAN-B-kpi-okr-diem-tong-hop.md)); mẫu biểu cố định theo văn bản cho báo cáo xuất; kết nối Trung ương; lịch sao lưu tự chạy, TLS và tường lửa thật (xem [lộ trình](knowledge/deliverables/03-phuong-an-attt-cap-do-3.md)). Các điểm đang dùng giả định: `gap/GAP.md`.
