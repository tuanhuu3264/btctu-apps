import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { buildExportFile } from '../../../common/table-export.js';
import type { ExportedTable, TableFormat, TableSheet } from '../../../common/table-export.js';
import { AuditService } from '../../security/index.js';
import { OrgQueryService } from './org-query.service.js';
import type { OrgTreeUnit } from './org-query.service.js';
import { PersonService } from './person.service.js';

export const ORG_EXPORT_LISTS = ['units', 'positions', 'persons'] as const;
export type OrgExportList = (typeof ORG_EXPORT_LISTS)[number];

const STATUS_TEXT = { ACTIVE: 'Hoạt động', INACTIVE: 'Ngừng sử dụng' } as const;
const LIST_TITLE: Record<OrgExportList, string> = { units: 'DANH SÁCH ĐƠN VỊ', positions: 'DANH SÁCH VỊ TRÍ VIỆC LÀM', persons: 'DANH SÁCH CÁN BỘ' };
const LIST_FILE: Record<OrgExportList, string> = { units: 'don-vi', positions: 'vi-tri-viec-lam', persons: 'can-bo' };

/**
 * Xuất danh sách tổ chức ra Excel và PDF (PLAN-A A6.2): đơn vị, vị trí, cán bộ. Không xuất dữ liệu cá nhân nhạy cảm
 * (ngày sinh, số định danh, email, điện thoại); cán bộ kiêm nhiệm hiện đủ các vị trí đang giữ.
 */
@Injectable()
export class OrgExportService {
  constructor(
    private readonly query: OrgQueryService,
    private readonly persons: PersonService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async export(list: OrgExportList, format: TableFormat, includeInactive: boolean): Promise<ExportedTable> {
    const tree = await this.query.tree({ includeInactive });
    const sheet = list === 'units' ? unitSheet(tree) : list === 'positions' ? positionSheet(tree) : await this.personSheet(tree, includeInactive);
    const file = await buildExportFile(
      LIST_FILE[list],
      {
        title: LIST_TITLE[list],
        info: [['Phạm vi', includeInactive ? 'Gồm cả mục đã ngừng sử dụng' : 'Chỉ mục đang hoạt động'], ['Dữ liệu cá nhân nhạy cảm', 'Không xuất']],
        generatedAt: this.clock.now(),
        sheets: [sheet],
      },
      format,
    );
    await this.audit.record({
      action: 'org.export',
      outcome: 'SUCCESS',
      details: { list, format, includeInactive, rows: sheet.rows.length, bytes: file.buffer.length },
    });
    return file;
  }

  private async personSheet(tree: OrgTreeUnit[], includeInactive: boolean): Promise<TableSheet> {
    const held = new Map<string, { title: string; unitName: string; kind: 'PRIMARY' | 'CONCURRENT' }[]>();
    for (const u of tree) {
      for (const p of u.positions) {
        if (p.holder) held.set(p.holder.personId, [...(held.get(p.holder.personId) ?? []), { title: p.title, unitName: u.name, kind: p.holder.kind }]);
      }
    }
    const people = (await this.persons.list(includeInactive ? undefined : { active: true })).sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));
    return {
      name: 'Cán bộ',
      columns: [
        { header: 'STT', width: 6, align: 'right' },
        { header: 'Mã cán bộ', width: 14 },
        { header: 'Họ và tên', width: 28 },
        { header: 'Vị trí chính', width: 30 },
        { header: 'Đơn vị', width: 30 },
        { header: 'Kiêm nhiệm', width: 40 },
        { header: 'Trạng thái', width: 16 },
      ],
      rows: people.map((p, i) => {
        const mine = held.get(p.id) ?? [];
        const main = mine.find((h) => h.kind === 'PRIMARY');
        return [
          i + 1,
          p.employeeCode ?? '',
          p.fullName,
          main?.title ?? '',
          main?.unitName ?? '',
          mine.filter((h) => h.kind === 'CONCURRENT').map((h) => `${h.title} (${h.unitName})`).join('; '),
          p.active ? 'Đang quản lý' : 'Ngừng quản lý',
        ];
      }),
    };
  }
}

function unitSheet(tree: OrgTreeUnit[]): TableSheet {
  const nameOf = new Map(tree.map((u) => [u.id, u.name]));
  return {
    name: 'Đơn vị',
    columns: [
      { header: 'STT', width: 6, align: 'right' },
      { header: 'Mã', width: 14 },
      { header: 'Tên đơn vị', width: 38 },
      { header: 'Loại', width: 10 },
      { header: 'Đơn vị cấp trên', width: 34 },
      { header: 'Số vị trí', width: 10, align: 'right' },
      { header: 'Số người đang giữ', width: 14, align: 'right' },
      { header: 'Trạng thái', width: 16 },
    ],
    rows: tree.map((u, i) => [
      i + 1,
      u.code,
      u.name,
      u.type === 'BAN' ? 'Ban' : 'Phòng',
      (u.parentId && nameOf.get(u.parentId)) || '',
      u.positions.length,
      new Set(u.positions.flatMap((p) => (p.holder ? [p.holder.personId] : []))).size,
      STATUS_TEXT[u.status],
    ]),
  };
}

function positionSheet(tree: OrgTreeUnit[]): TableSheet {
  const titleOf = new Map(tree.flatMap((u) => u.positions.map((p) => [p.id, p.title] as const)));
  return {
    name: 'Vị trí',
    columns: [
      { header: 'STT', width: 6, align: 'right' },
      { header: 'Mã', width: 16 },
      { header: 'Chức danh', width: 30 },
      { header: 'Đơn vị', width: 30 },
      { header: 'Cấp', width: 6, align: 'right' },
      { header: 'Lãnh đạo', width: 10 },
      { header: 'Hỗ trợ, phục vụ', width: 12 },
      { header: 'Báo cáo cho', width: 28 },
      { header: 'Người đang giữ', width: 26 },
      { header: 'Loại phân công', width: 14 },
      { header: 'Trạng thái', width: 16 },
    ],
    rows: tree.flatMap((u) => u.positions.map((p) => [u.name, p] as const)).map(([unitName, p], i) => [
      i + 1,
      p.code,
      p.title,
      unitName,
      p.level,
      p.isLeader ? 'Có' : 'Không',
      p.isSupport ? 'Có' : 'Không',
      (p.reportsToPositionId && titleOf.get(p.reportsToPositionId)) || '',
      p.holder?.fullName ?? '(còn trống)',
      p.holder ? (p.holder.kind === 'CONCURRENT' ? 'Kiêm nhiệm' : 'Vị trí chính') : '',
      p.status === 'ACTIVE' ? STATUS_TEXT.ACTIVE : `${STATUS_TEXT.INACTIVE}${p.inactiveReason ? `: ${p.inactiveReason}` : ''}`,
    ]),
  };
}
