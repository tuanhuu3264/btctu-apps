'use client';

import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Input, InputNumber, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import type { AxisDefinition, AxisKind } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

const KIND: Record<AxisKind, { label: string; max: number }> = {
  GENERAL: { label: 'Tiêu chí chung', max: 30 },
  RESULT: { label: 'Kết quả thực hiện nhiệm vụ', max: 70 },
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const CODE_PATTERN = /^[A-Z][A-Z0-9]{0,9}$/;
const EMPTY_DRAFT = { code: '', name: '', kind: 'RESULT' as AxisKind, maxPoints: 5 };

/**
 * Cấu hình các trục chấm điểm tập thể (ADR-036). Tổng điểm tối đa các trục đang bật của mỗi nhóm phải đúng 30 hoặc 70;
 * nhóm tắt hết trục thì người chấm nhập một số. Máy chủ vẫn kiểm tra lại và từ chối khi còn hồ sơ đang chờ thẩm định.
 */
export default function AxesEditor({ initial, canEdit }: { initial: AxisDefinition[]; canEdit: boolean }) {
  const { run, busy } = useAction();
  const [axes, setAxes] = useState(initial);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const dirty = JSON.stringify(axes) !== JSON.stringify(initial);

  const patch = (code: string, change: Partial<AxisDefinition>) => setAxes((cur) => cur.map((a) => (a.code === code ? { ...a, ...change } : a)));
  const sums = (Object.keys(KIND) as AxisKind[]).map((kind) => {
    const active = axes.filter((a) => a.kind === kind && a.active);
    return { kind, count: active.length, sum: round2(active.reduce((s, a) => s + a.maxPoints, 0)) };
  });
  const problems = sums.filter((s) => s.count > 0 && s.sum !== KIND[s.kind].max);
  const code = draft.code.trim().toUpperCase();
  const draftError = !code
    ? null
    : !CODE_PATTERN.test(code)
      ? 'Mã gồm chữ in hoa và số, bắt đầu bằng chữ, tối đa 10 ký tự'
      : axes.some((a) => a.code === code)
        ? `Mã ${code} đã có`
        : null;
  const canAdd = code !== '' && draftError === null && draft.name.trim().length >= 3 && draft.maxPoints > 0;
  const add = () => {
    setAxes((cur) => [...cur, { code, name: draft.name.trim(), kind: draft.kind, maxPoints: draft.maxPoints, sortOrder: Math.max(0, ...cur.map((a) => a.sortOrder)) + 1, autoMetric: null, active: true }]);
    setDraft(EMPTY_DRAFT);
  };
  const remove = (codeToRemove: string) => setAxes((cur) => cur.filter((a) => a.code !== codeToRemove));

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Người thẩm định chấm điểm từng trục; điểm tiêu chí chung và điểm kết quả là tổng các trục cùng nhóm"
        description="Phân bổ mặc định theo bộ tiêu chí là đề xuất, vì văn bản chưa quy định chi tiết (Nghị định 335/2025/NĐ-CP Điều 7.2). Hồ sơ đã chấm giữ nguyên bộ trục lúc chấm. Không đổi được khi còn hồ sơ đang chờ thẩm định hoặc công nhận."
      />
      <Card size="small">
        <Table<AxisDefinition>
          rowKey="code"
          size="small"
          pagination={false}
          dataSource={axes}
          scroll={{ x: 760 }}
          columns={[
            { title: 'Mã', dataIndex: 'code', width: 70 },
            {
              title: 'Tên trục',
              dataIndex: 'name',
              render: (name: string, a) => (canEdit ? <Input value={name} maxLength={200} onChange={(e) => patch(a.code, { name: e.target.value })} /> : name),
            },
            { title: 'Nhóm', dataIndex: 'kind', width: 190, render: (k: AxisKind) => <Tag color={k === 'GENERAL' ? 'default' : 'geekblue'}>{KIND[k].label}</Tag> },
            {
              title: 'Điểm tối đa',
              dataIndex: 'maxPoints',
              width: 120,
              align: 'right',
              render: (n: number, a) => (canEdit ? <InputNumber min={0.5} max={70} step={0.5} value={n} onChange={(v) => patch(a.code, { maxPoints: Number(v ?? 0) })} /> : n),
            },
            { title: 'Gợi ý', dataIndex: 'autoMetric', width: 110, render: (m: string | null) => (m ? <Tag color="green">Tự động</Tag> : '–') },
            {
              title: 'Đang bật',
              dataIndex: 'active',
              width: 90,
              align: 'center',
              render: (on: boolean, a) => <Switch checked={on} disabled={!canEdit} onChange={(v) => patch(a.code, { active: v })} aria-label={`Bật trục ${a.code}`} />,
            },
            ...(canEdit
              ? [
                  {
                    title: '',
                    width: 60,
                    align: 'center' as const,
                    render: (_: unknown, a: AxisDefinition) => (
                      <Popconfirm title={`Xóa trục ${a.code}?`} description="Hồ sơ đã chấm vẫn giữ điểm trục này." okText="Xóa" cancelText="Không" onConfirm={() => remove(a.code)}>
                        <Button type="text" danger icon={<DeleteOutlined />} aria-label={`Xóa trục ${a.code}`} />
                      </Popconfirm>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      {canEdit && (
        <Card size="small" title="Thêm trục">
          <Space wrap align="start">
            <Input placeholder="Mã (ví dụ T7)" style={{ width: 120 }} maxLength={10} value={draft.code} status={draftError ? 'error' : undefined} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} aria-label="Mã trục mới" />
            <Input placeholder="Tên trục" style={{ width: 280 }} maxLength={200} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Tên trục mới" />
            <Select<AxisKind> style={{ width: 230 }} value={draft.kind} onChange={(kind) => setDraft({ ...draft, kind })} options={(Object.keys(KIND) as AxisKind[]).map((k) => ({ value: k, label: KIND[k].label }))} aria-label="Nhóm trục mới" />
            <InputNumber min={0.5} max={70} step={0.5} value={draft.maxPoints} onChange={(v) => setDraft({ ...draft, maxPoints: Number(v ?? 0) })} aria-label="Điểm tối đa trục mới" />
            <Button icon={<PlusOutlined />} disabled={!canAdd} onClick={add}>
              Thêm
            </Button>
          </Space>
          {draftError && <Typography.Text type="danger" style={{ display: 'block', marginTop: 8 }}>{draftError}</Typography.Text>}
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            Sau khi thêm hoặc xóa, chỉnh điểm tối đa để mỗi nhóm đang bật đúng 30 hoặc 70 rồi bấm Lưu cấu hình.
          </Typography.Paragraph>
        </Card>
      )}

      <Space orientation="vertical" size={4}>
        {sums.map((s) => (
          <Typography.Text key={s.kind} type={s.count > 0 && s.sum !== KIND[s.kind].max ? 'danger' : undefined}>
            {KIND[s.kind].label}: {s.count === 0 ? 'không có trục nào bật, người chấm nhập một số 0 đến ' + KIND[s.kind].max : `${s.count} trục, tổng ${String(s.sum).replace('.', ',')} / ${KIND[s.kind].max}`}
          </Typography.Text>
        ))}
      </Space>

      {canEdit ? (
        <Space>
          <Button
            type="primary"
            disabled={!dirty || problems.length > 0}
            loading={busy}
            onClick={() =>
              run(
                async () => {
                  const saved = await apiCall<AxisDefinition[]>('PUT', '/unit-evaluation/axes', { axes });
                  if (saved) setAxes(saved);
                },
                { success: 'Đã lưu cấu hình trục' },
              )
            }
          >
            Lưu cấu hình
          </Button>
          <Button disabled={!dirty} onClick={() => setAxes(initial)}>
            Hoàn tác
          </Button>
        </Space>
      ) : (
        <Alert type="warning" showIcon message="Chỉ Văn phòng sửa được cấu hình trục chấm điểm." />
      )}
    </Space>
  );
}
