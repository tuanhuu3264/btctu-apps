# Mục lục mã nguồn

Monolith mô-đun: mỗi mô-đun backend có 3 lớp `presentation` (Controller, DTO) → `application` (Service, model, port) → `data-access` (entity, repository TypeORM). Test dùng bản `application/testing/in-memory.ts`.

## Gốc repo
| Đường dẫn | Nội dung |
|---|---|
| `README.md` | Hướng dẫn chạy, kiến trúc, trạng thái mô-đun |
| `database/docker-compose.yml` | PostgreSQL + MinIO |
| `src/be/` | Backend NestJS |
| `src/fe/` | Frontend Next.js + Ant Design |

## Backend `src/be/src`
| Đường dẫn | Vai trò |
|---|---|
| `main.ts`, `app.module.ts` | Khởi động, ghép mô-đun |
| `health/health.controller.ts` | `/api/health` |
| `common/` | `clock`, `notifier`, `request-context(.middleware)`, `scope` |
| `database/` | `database.module.ts`, `migrations/` (CreateUnit … CreateNotifications, đăng ký ở `index.ts`) |
| `cli/` | `create-admin`, `import-catalog`, `import-org`, `seed-demo`, `seed-demo-periods`, `seed-demo-scenarios`, `purge-notifications`, `backup` (sao lưu, thử phục hồi, phục hồi) |
| `backup/` | Sao lưu và phục hồi (ADR-058): `config`, `postgres` (pg_dump, pg_restore, psql, trực tiếp hoặc trong container), `files` (chép tăng dần kho S3), `crypto` (AES-256-GCM theo luồng), `retention` (giữ theo ngày, tuần, tháng), `remote` (đẩy, tải, dọn bản sao lưu trên MinIO riêng), `service` (điều phối, bảng kê, nhật ký `backup.log`) |

### Mô-đun `modules/`
| Mô-đun | Nội dung chính |
|---|---|
| `security` | Tài khoản, phiên (hạn tuyệt đối và hạn không thao tác, `session.service`, ADR-057), đăng nhập (argon2), vai trò/quyền (`role-permissions`, `authorization.*`), nhật ký kiểm toán có băm chuỗi (`audit*`), guard (`auth.guard`, `permissions.guard`), decorator `@Public`, `@RequirePermission`, `@CurrentAccount` |
| `organization` | Đơn vị (`unit.*`), chức danh (`position.service`), nhân sự (`person.service`), phân công (`assignment.service`), truy vấn cơ cấu (`org-query.service`), nhập Excel (`org-import.*`, `excel-org-source`) |
| `catalog` | Danh mục sản phẩm công việc theo phiên bản (`catalog.service`), nhập Excel (`catalog-import.*`, `excel-catalog-source`), `org-directory` |
| `tasking` | Giao/nhận nhiệm vụ, miễn trừ lần chậm, chưa đạt do nguyên nhân khách quan (`tasking.service`, bảng `work_progress_waiver`, ADR-056), cộng tác (`collaboration.service`), quy tắc tệp (`file-rules`), lưu tệp S3/MinIO (`s3-file-storage`) |
| `evaluation` | Kỳ đánh giá (`period.ts`), chính sách chấm (`scoring-policy.ts`), đánh giá KPI (`evaluation.service`), nguồn công việc (`work-source`), tiêu chí chung chấm theo mục và bảng theo phiên bản (`general-criteria.*`, ADR-054), kỷ luật, kết luận và điều kiện xếp loại năm (`rating-events.ts`, `rating-event.service`, ADR-055), hạn mức xuất sắc theo điểm (`excellent-quota.ts`, ADR-060), hủy kết quả đã phê duyệt (`evaluation.service` `revoke`, bảng `evaluation_revocation`, ADR-059) |
| `scoring` | Xếp loại (`classification.ts`) |
| `reporting` | Báo cáo (`report-builder`, `report.service`), mẫu dự thảo (`draft-templates`), xuất tệp (`file-report-renderer`, `draft-docx`) |
| `documents` | Văn bản/bản tin, danh mục, tệp nhiệm vụ |
| `notifications` | Thông báo cho người dùng |
| `integration` | Điểm tích hợp ngoài (chỉ có module) |

Test: `src/be/test/app.e2e-spec.ts` (cần PostgreSQL), các `*.spec.ts` cạnh service (đơn vị).

## Frontend `src/fe/src`
| Đường dẫn | Nội dung |
|---|---|
| `app/layout.tsx`, `providers.tsx`, `login/page.tsx` | Khung gốc, đăng nhập |
| `app/(app)/layout.tsx`, `app-shell.tsx` | Khung có menu theo quyền |
| `app/(app)/` `page.tsx`, `dashboard-view.tsx` | Trang tổng quan |
| `app/(app)/accounts/` | Quản lý tài khoản |
| `app/(app)/organization/`, `org-chart/`, `org-tree.tsx` | Cơ cấu tổ chức (đơn vị, chức danh, nhân sự) |
| `app/(app)/catalog/` | Danh mục & phiên bản (nhóm, mục, nhiệm vụ, phạm vi) |
| `app/(app)/tasks/` | Bảng nhiệm vụ, giao việc, chi tiết |
| `app/(app)/evaluations/` | Kỳ & phiếu đánh giá; `[id]/general-criteria-fields.tsx` (chấm tiêu chí chung theo mục), `rating-events.tsx` (kỷ luật, kết luận), `revocation-panel.tsx` (hủy kết quả và lịch sử), `excellent-quota-card.tsx` (hạn mức xuất sắc), `general-criteria/` (cấu hình bảng theo phiên bản) |
| `app/(app)/reports/` | Báo cáo |
| `app/(app)/documents/` | Bản tin, danh mục, tệp nhiệm vụ |
| `components/` | `idle-guard` (cảnh báo và tự đóng phiên), `charts`, `notification-bell`, `status-tags`, `catalog-item-picker`, `file-link`, `page-title` |
| `lib/` | `api`, `client`, `use-action`, `use-remote`, `labels`, `org`, `scope` |

## Triển khai và tài liệu dựng lại được
| Đường dẫn | Nội dung |
|---|---|
| `deploy/nginx/` | Nginx, TLS, cấu hình mẫu (ADR-049) |
| `deploy/backup/README.md` | Cấu hình, đặt lịch và quy trình phục hồi sau sự cố (ADR-058) |
| `knowledge/deliverables/_build/` | Dựng `Van-ban-tra-loi-yeu-cau-1-va-3.docx` từ `01-bo-tieu-chi-kpi-okr.md` và `03-phuong-an-attt-cap-do-3.md` |
| `knowledge/deliverables/ho-so-cap-do/_build/` | Dựng 4 tài liệu hồ sơ đề xuất cấp độ |
