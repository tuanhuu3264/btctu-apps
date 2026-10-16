'use client';

import { Button, Card, Input, Select, Space, Switch, Table, Typography } from 'antd';
import { useState } from 'react';
import type { LeaveMonth, LeaveReason } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

const REASONS: { value: LeaveReason; label: string }[] = [
  { value: 'OM', label: 'Nghỉ ốm' },
  { value: 'THAI_SAN', label: 'Nghỉ thai sản' },
  { value: 'KHONG_LUONG', label: 'Nghỉ việc riêng không lương' },
  { value: 'KHAC', label: 'Lý do khác có căn cứ' },
];

interface Row {
  month: number;
  on: boolean;
  reason: LeaveReason;
  note: string;
  /** Tháng đã có hồ sơ phê duyệt: không đánh dấu nghỉ được. */
  locked: boolean;
}

/**
 * Văn phòng ghi nhận các tháng nghỉ ốm, thai sản, nghỉ việc riêng không lương (Nghị định 335 Điều 11.2). Tháng nghỉ không
 * tính vào trung bình điểm năm và không bị coi là thiếu; vẫn tính vào thời gian để đủ 6 tháng (ADR-039).
 */
export default function LeaveEditor({ personId, year, initial, approvedMonths }: { personId: string; year: number; initial: LeaveMonth[]; approvedMonths: number[] }) {
  const { run, busy } = useAction();
  const [rows, setRows] = useState<Row[]>(
    Array.from({ length: 12 }, (_, i) => {
      const found = initial.find((l) => l.month === i + 1);
      return { month: i + 1, on: !!found, reason: found?.reason ?? 'OM', note: found?.note ?? '', locked: approvedMonths.includes(i + 1) };
    }),
  );
  const patch = (month: number, change: Partial<Row>) => setRows((cur) => cur.map((r) => (r.month === month ? { ...r, ...change } : r)));
  const chosen = rows.filter((r) => r.on);
  const invalid = chosen.some((r) => r.note.trim().length < 3);

  return (
    <Card size="small" title="Tháng nghỉ có căn cứ (Điều 11.2)" style={{ marginTop: 16 }}>
      <Typography.Paragraph type="secondary">
        Chỉ Văn phòng ghi nhận. Mỗi tháng nghỉ cần nêu căn cứ (số quyết định, giấy xác nhận).
      </Typography.Paragraph>
      <Table<Row>
        rowKey="month"
        size="small"
        pagination={false}
        dataSource={rows}
        scroll={{ x: 640 }}
        columns={[
          { title: 'Tháng', dataIndex: 'month', width: 80, render: (m: number) => `Tháng ${m}` },
          { title: 'Nghỉ', width: 80, render: (_: unknown, r) => <Switch checked={r.on} disabled={r.locked} onChange={(on) => patch(r.month, { on })} aria-label={`Tháng ${r.month} nghỉ`} /> },
          { title: 'Lý do', width: 240, render: (_: unknown, r) => <Select value={r.reason} disabled={!r.on} style={{ width: 220 }} options={REASONS} onChange={(reason) => patch(r.month, { reason })} /> },
          {
            title: 'Căn cứ',
            render: (_: unknown, r) =>
              r.locked ? <Typography.Text type="secondary">Đã có hồ sơ phê duyệt</Typography.Text> : <Input value={r.note} disabled={!r.on} maxLength={500} status={r.on && r.note.trim().length < 3 ? 'error' : undefined} onChange={(e) => patch(r.month, { note: e.target.value })} placeholder="Số quyết định, giấy xác nhận" />,
          },
        ]}
      />
      <Space style={{ marginTop: 12 }}>
        <Button
          type="primary"
          loading={busy}
          disabled={invalid}
          onClick={() =>
            run(async () => void (await apiCall('PUT', `/evaluation/persons/${personId}/leave`, { year, months: chosen.map((r) => ({ month: r.month, reason: r.reason, note: r.note.trim() })) })), { success: 'Đã lưu tháng nghỉ' })
          }
        >
          Lưu tháng nghỉ
        </Button>
      </Space>
    </Card>
  );
}
