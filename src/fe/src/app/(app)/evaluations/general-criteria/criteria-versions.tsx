'use client';

import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Collapse, Input, InputNumber, Popconfirm, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import type { GeneralCriteriaSet, GeneralCriteriaVersion, GeneralItem, GeneralSection } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

const round2 = (n: number) => Math.round(n * 100) / 100;
const sumOf = (set: GeneralCriteriaSet) => round2(set.items.reduce((s, i) => s + (i.max || 0), 0));
const dmy = (d: string) => d.split('-').reverse().join('/');
const monthOf = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;

function nextMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Xem một bảng: nhóm và các mục kèm điểm tối đa. */
function SetView({ set }: { set: GeneralCriteriaSet }) {
  const rows = set.sections.flatMap((s) => [
    { key: `s-${s.code}`, code: s.code, name: s.name, max: round2(set.items.filter((i) => i.section === s.code).reduce((a, i) => a + i.max, 0)), header: true },
    ...set.items.filter((i) => i.section === s.code).map((i) => ({ key: i.code, code: i.code, name: i.name, max: i.max, header: false })),
  ]);
  return (
    <Table
      size="small"
      pagination={false}
      dataSource={rows}
      columns={[
        { title: 'Mã', dataIndex: 'code', width: 70, render: (c: string, r) => (r.header ? <b>{c}</b> : c) },
        { title: 'Nội dung', dataIndex: 'name', render: (n: string, r) => (r.header ? <b>{n}</b> : n) },
        { title: 'Tối đa', dataIndex: 'max', width: 80, align: 'right', render: (m: number, r) => (r.header ? <b>{m.toLocaleString('vi-VN')}</b> : m.toLocaleString('vi-VN')) },
      ]}
      summary={() => (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={2}>
            <b>Tổng</b>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="right">
            <b>{sumOf(set).toLocaleString('vi-VN')}</b>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  );
}

/** Sửa một bảng: nhóm, mục, điểm tối đa. Tổng phải đúng 30 (máy chủ kiểm tra lại). */
function SetEditor({ value, onChange }: { value: GeneralCriteriaSet; onChange: (v: GeneralCriteriaSet) => void }) {
  const setSection = (idx: number, patch: Partial<GeneralSection>) => {
    const old = value.sections[idx];
    const sections = value.sections.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    // Đổi mã nhóm thì các mục của nhóm đổi theo.
    const items = patch.code !== undefined ? value.items.map((it) => (it.section === old.code ? { ...it, section: patch.code! } : it)) : value.items;
    onChange({ sections, items });
  };
  const setItem = (idx: number, patch: Partial<GeneralItem>) => onChange({ ...value, items: value.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });
  const total = sumOf(value);

  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Typography.Text strong>Nhóm tiêu chí</Typography.Text>
      <Table
        size="small"
        pagination={false}
        rowKey={(_, i) => `s${i}`}
        dataSource={value.sections}
        columns={[
          { title: 'Mã', width: 90, render: (_: unknown, s: GeneralSection, i) => <Input value={s.code} maxLength={4} onChange={(e) => setSection(i, { code: e.target.value.trim() })} /> },
          { title: 'Tên nhóm', render: (_: unknown, s: GeneralSection, i) => <Input value={s.name} maxLength={500} onChange={(e) => setSection(i, { name: e.target.value })} /> },
          {
            width: 50,
            render: (_: unknown, s: GeneralSection, i) => (
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                aria-label={`Xóa nhóm ${s.code}`}
                onClick={() => onChange({ sections: value.sections.filter((_, j) => j !== i), items: value.items.filter((it) => it.section !== s.code) })}
              />
            ),
          },
        ]}
      />
      <Button size="small" icon={<PlusOutlined />} onClick={() => onChange({ ...value, sections: [...value.sections, { code: '', name: '' }] })}>
        Thêm nhóm
      </Button>
      <Typography.Text strong>Mục con</Typography.Text>
      <Table
        size="small"
        pagination={false}
        rowKey={(_, i) => `i${i}`}
        dataSource={value.items}
        scroll={{ x: true }}
        columns={[
          { title: 'Mã', width: 90, render: (_: unknown, it: GeneralItem, i) => <Input value={it.code} maxLength={8} onChange={(e) => setItem(i, { code: e.target.value.trim() })} /> },
          {
            title: 'Nhóm',
            width: 90,
            render: (_: unknown, it: GeneralItem, i) => <Select value={it.section} style={{ width: 80 }} options={value.sections.map((s) => ({ value: s.code, label: s.code }))} onChange={(v) => setItem(i, { section: v })} />,
          },
          { title: 'Nội dung', render: (_: unknown, it: GeneralItem, i) => <Input.TextArea value={it.name} autoSize={{ minRows: 1, maxRows: 4 }} maxLength={2000} onChange={(e) => setItem(i, { name: e.target.value })} /> },
          { title: 'Tối đa', width: 100, render: (_: unknown, it: GeneralItem, i) => <InputNumber value={it.max} min={0.5} max={30} step={0.5} onChange={(v) => setItem(i, { max: Number(v ?? 0) })} /> },
          {
            width: 50,
            render: (_: unknown, it: GeneralItem, i) => (
              <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Xóa mục ${it.code}`} onClick={() => onChange({ ...value, items: value.items.filter((_, j) => j !== i) })} />
            ),
          },
        ]}
      />
      <Space>
        <Button size="small" icon={<PlusOutlined />} disabled={value.sections.length === 0} onClick={() => onChange({ ...value, items: [...value.items, { code: '', section: value.sections[value.sections.length - 1].code, name: '', max: 1 }] })}>
          Thêm mục
        </Button>
        <Typography.Text type={total === 30 ? 'success' : 'danger'}>Tổng: {total.toLocaleString('vi-VN')}/30</Typography.Text>
      </Space>
    </Space>
  );
}

interface Draft {
  effectiveFrom: string;
  note: string;
  leader: GeneralCriteriaSet;
  staff: GeneralCriteriaSet;
}

/**
 * Các phiên bản bảng tiêu chí chung 30 điểm của cá nhân (ADR-054). Mỗi phiên bản áp dụng từ một tháng cho mọi kỳ bắt đầu từ
 * tháng đó; chỉ thêm được từ tháng mà chưa ai tự chấm, để mọi người trong cùng một kỳ chấm theo cùng một bảng.
 */
export default function CriteriaVersions({ versions, canEdit }: { versions: GeneralCriteriaVersion[]; canEdit: boolean }) {
  const { run, busy } = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const latest = versions[0];

  const start = () =>
    setDraft({
      effectiveFrom: nextMonth(),
      note: '',
      leader: structuredClone(latest?.leader ?? { sections: [], items: [] }),
      staff: structuredClone(latest?.staff ?? { sections: [], items: [] }),
    });

  const save = () =>
    draft &&
    run(
      async () => {
        await apiCall('POST', '/evaluation/general-criteria', { effectiveFrom: draft.effectiveFrom, leader: draft.leader, staff: draft.staff, note: draft.note.trim() || undefined });
        setDraft(null);
      },
      { success: 'Đã thêm phiên bản bảng tiêu chí chung' },
    );

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        title="Mỗi mục chấm Đảm bảo (đủ điểm) hoặc Không đảm bảo (0 điểm, phải ghi căn cứ)"
        description="Bảng lãnh đạo, quản lý theo 05-HD/TU Phụ lục 03 (Mẫu 5, phần A); bảng công chức không giữ chức vụ (gồm người lao động hỗ trợ, phục vụ) theo Nghị định 335 Phụ lục II, Mẫu số 01. Phần mềm chọn bảng theo cờ lãnh đạo của vị trí việc làm. Phiên bản mới chỉ áp dụng từ tháng chưa có ai tự chấm; hồ sơ các kỳ trước giữ phiên bản cũ."
      />
      {canEdit && !draft && (
        <Button type="primary" icon={<PlusOutlined />} onClick={start} style={{ alignSelf: 'flex-start' }}>
          Thêm phiên bản
        </Button>
      )}
      {draft && (
        <Card size="small" title="Phiên bản mới">
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Space wrap>
              <span>Áp dụng từ tháng</span>
              <Input type="month" value={draft.effectiveFrom} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} style={{ width: 180 }} />
              <Input placeholder="Căn cứ (văn bản, quyết định)" value={draft.note} maxLength={1000} onChange={(e) => setDraft({ ...draft, note: e.target.value })} style={{ width: 420 }} />
            </Space>
            <Tabs
              items={[
                { key: 'leader', label: 'Lãnh đạo, quản lý', children: <SetEditor value={draft.leader} onChange={(leader) => setDraft({ ...draft, leader })} /> },
                { key: 'staff', label: 'Công chức không giữ chức vụ', children: <SetEditor value={draft.staff} onChange={(staff) => setDraft({ ...draft, staff })} /> },
              ]}
            />
            <Space>
              <Button type="primary" loading={busy} disabled={sumOf(draft.leader) !== 30 || sumOf(draft.staff) !== 30 || !draft.effectiveFrom} onClick={save}>
                Lưu phiên bản
              </Button>
              <Button onClick={() => setDraft(null)}>Hủy</Button>
            </Space>
          </Space>
        </Card>
      )}
      {versions.length === 0 ? (
        <Alert type="warning" showIcon title="Chưa có phiên bản nào: các kỳ chấm tiêu chí chung bằng một điểm từ 0 đến 30." />
      ) : (
        <Collapse
          defaultActiveKey={[latest.id]}
          items={versions.map((v) => ({
            key: v.id,
            label: (
              <Space wrap>
                <Typography.Text strong>Áp dụng từ tháng {monthOf(v.effectiveFrom)}</Typography.Text>
                {v.effectiveTo ? <Tag>đến {dmy(v.effectiveTo)}</Tag> : <Tag color="green">Hiện hành</Tag>}
                {v.usedBy.length > 0 && <Tag color="blue">Đã chấm: {v.usedBy.join(', ')}</Tag>}
              </Space>
            ),
            extra:
              canEdit && v.usedBy.length === 0 ? (
                <Popconfirm
                  title="Xóa phiên bản này?"
                  description="Các kỳ của phiên bản này trở về phiên bản trước đó."
                  okText="Xóa"
                  okButtonProps={{ danger: true }}
                  cancelText="Hủy"
                  onConfirm={() => run(async () => void (await apiCall('DELETE', `/evaluation/general-criteria/${v.id}`)), { success: 'Đã xóa phiên bản' })}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()}>
                    Xóa
                  </Button>
                </Popconfirm>
              ) : null,
            children: (
              <>
                {v.note && <Typography.Paragraph type="secondary">Căn cứ: {v.note}</Typography.Paragraph>}
                <Tabs
                  items={[
                    { key: 'leader', label: 'Lãnh đạo, quản lý', children: <SetView set={v.leader} /> },
                    { key: 'staff', label: 'Công chức không giữ chức vụ', children: <SetView set={v.staff} /> },
                  ]}
                />
              </>
            ),
          }))}
        />
      )}
    </Space>
  );
}
