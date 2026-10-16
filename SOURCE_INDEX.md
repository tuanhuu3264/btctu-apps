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
| `cli/` | `create-admin`, `import-catalog`, `import-org`, `seed-demo`, `seed-demo-periods`, `purge-notifications` |

### Mô-đun `modules/`
| Mô-đun | Nội dung chính |
|---|---|
| `security` | Tài khoản, phiên, đăng nhập (argon2), vai trò/quyền (`role-permissions`, `authorization.*`), nhật ký kiểm toán có băm chuỗi (`audit*`), guard (`auth.guard`, `permissions.guard`), decorator `@Public`, `@RequirePermission`, `@CurrentAccount` |
| `organization` | Đơn vị (`unit.*`), chức danh (`position.service`), nhân sự (`person.service`), phân công (`assignment.service`), truy vấn cơ cấu (`org-query.service`), nhập Excel (`org-import.*`, `excel-org-source`) |
| `catalog` | Danh mục sản phẩm công việc theo phiên bản (`catalog.service`), nhập Excel (`catalog-import.*`, `excel-catalog-source`), `org-directory` |
| `tasking` | Giao/nhận nhiệm vụ, cộng tác (`collaboration.service`), quy tắc tệp (`file-rules`), lưu tệp S3/MinIO (`s3-file-storage`) |
| `evaluation` | Kỳ đánh giá (`period.ts`), chính sách chấm (`scoring-policy.ts`), đánh giá KPI (`evaluation.service`), nguồn công việc (`work-source`) |
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
| `app/(app)/evaluations/` | Kỳ & phiếu đánh giá |
| `app/(app)/reports/` | Báo cáo |
| `app/(app)/documents/` | Bản tin, danh mục, tệp nhiệm vụ |
| `components/` | `charts`, `notification-bell`, `status-tags`, `catalog-item-picker`, `file-link`, `page-title` |
| `lib/` | `api`, `client`, `use-action`, `use-remote`, `labels`, `org`, `scope` |
