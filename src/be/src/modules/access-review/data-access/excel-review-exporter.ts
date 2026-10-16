import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { AccessReviewItemModel, AccessReviewModel } from '../application/access-review.model.js';
import { countsOf } from '../application/access-review.model.js';
import { ReviewExporter } from '../application/access-review.ports.js';

const DECISION_LABEL = { KEEP: 'Giữ', REVOKE: 'Thu hồi' } as const;
const KIND_LABEL = { LEADER: 'Lãnh đạo', DATA_ADMIN: 'Quản trị dữ liệu' } as const;

/** Xuất một đợt rà soát quyền ra Excel làm hồ sơ kiểm toán: tóm tắt ở trang đầu, từng vai trò ở trang chi tiết. */
@Injectable()
export class ExcelReviewExporter extends ReviewExporter {
  async renderExcel(review: AccessReviewModel, items: readonly AccessReviewItemModel[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Phần mềm quản lý, đánh giá KPI/OKR';
    const counts = countsOf(items);

    const summary = wb.addWorksheet('Tóm tắt');
    summary.columns = [{ width: 32 }, { width: 40 }];
    for (const [k, v] of [
      ['Đợt rà soát', review.label],
      ['Trạng thái', review.status === 'OPEN' ? 'Đang mở' : 'Đã đóng'],
      ['Hạn xác nhận', review.dueDate],
      ['Tạo lúc', review.createdAt.toISOString()],
      ['Đóng lúc', review.closedAt ? review.closedAt.toISOString() : ''],
      ['Tổng số vai trò', counts.total],
      ['Đã xác nhận', counts.decided],
      ['Giữ', counts.keep],
      ['Thu hồi', counts.revoke],
      ['Chưa xác nhận', counts.pending],
      ['Ghi chú', review.note ?? ''],
    ] as const) {
      summary.addRow([k, v]);
    }
    summary.getColumn(1).font = { bold: true };

    const sheet = wb.addWorksheet('Chi tiết');
    sheet.columns = [
      { header: 'Tên đăng nhập', width: 22 },
      { header: 'Cán bộ', width: 28 },
      { header: 'Đơn vị', width: 28 },
      { header: 'Chức danh', width: 28 },
      { header: 'Vai trò', width: 22 },
      { header: 'Hiệu lực từ', width: 22 },
      { header: 'Hiệu lực đến', width: 22 },
      { header: 'Người xác nhận', width: 28 },
      { header: 'Loại người xác nhận', width: 20 },
      { header: 'Quyết định', width: 14 },
      { header: 'Thời điểm quyết định', width: 24 },
      { header: 'Lý do, ghi chú', width: 40 },
      { header: 'Đã thu hồi thật', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const i of items) {
      sheet.addRow([
        i.username,
        i.personName ?? '',
        i.unitName ?? '',
        i.positionTitle ?? '',
        i.role,
        i.roleValidFrom.toISOString(),
        i.roleValidTo ? i.roleValidTo.toISOString() : 'không hết hạn',
        i.reviewerName ?? KIND_LABEL[i.reviewerKind],
        KIND_LABEL[i.reviewerKind],
        i.decision ? DECISION_LABEL[i.decision] : 'Chưa xác nhận',
        i.decidedAt ? i.decidedAt.toISOString() : '',
        i.note ?? '',
        i.revokeApplied ? 'Có' : '',
      ]);
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
