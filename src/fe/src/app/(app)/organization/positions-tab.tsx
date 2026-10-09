'use client';

import { PlusOutlined, UserAddOutlined } from '@ant-design/icons';
import { Button, Checkbox, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip } from 'antd';
import { useMemo, useState } from 'react';
import type { Assignment, OrgUnit, Person } from '@/lib/api';
import { apiCall, apiGet } from '@/lib/client';
import { useAction } from '@/lib/use-action';
import { LEVEL_LABELS } from './organization-view';
import type { PositionRow } from './organization-view';

interface PositionValues {
  unitId: string;
  title: string;
  level: number;
  isLeader: boolean;
  reportsToPositionId?: string | null;
  duties?: string;
  referenceOkr?: string;
}

/** Bỏ dấu, viết hoa, thay ký tự lạ bằng gạch nối: "Phó Trưởng phòng" → "PHO-TRUONG-PHONG". */
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Mã vị trí tự sinh: ĐƠN-VỊ-L{cấp}-CHỨC-DANH, thêm số thứ tự nếu trùng. */
function makeCode(unitCode: string, level: number, title: string, existing: Set<string>): string {
  const base = `${unitCode}-L${level}-${slug(title)}`.slice(0, 74);
  if (!existing.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!existing.has(candidate)) return candidate;
  }
}

interface FormModalProps {
  /** null: thêm mới; PositionRow: sửa. */
  position: PositionRow | null;
  rows: PositionRow[];
  units: OrgUnit[];
  onClose: () => void;
}

/** Hộp thoại thêm hoặc sửa vị trí. Chỉ được dựng khi đang mở, nên mỗi lần mở là một form mới. */
function PositionFormModal({ position, rows, units, onClose }: FormModalProps) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<PositionValues>();
  const level = Form.useWatch('level', form);
  const existingCodes = useMemo(() => new Set(rows.map((r) => r.code)), [rows]);
  const unitCode = (id: string) => units.find((u) => u.id === id)?.code ?? 'DV';
  // Cấp trên phải có cấp nhỏ hơn (ADR-012), nên loại sẵn các vị trí không hợp lệ khỏi danh sách chọn.
  const superiors = rows.filter((r) => (level == null || r.level < level) && r.id !== position?.id);

  async function submit(v: PositionValues) {
    const ok = await run(
      async () => {
        if (!position) {
          await apiCall('POST', '/positions', {
            code: makeCode(unitCode(v.unitId), v.level, v.title, existingCodes),
            unitId: v.unitId,
            title: v.title.trim(),
            level: v.level,
            isLeader: v.isLeader,
            ...(v.reportsToPositionId ? { reportsToPositionId: v.reportsToPositionId } : {}),
            ...(v.duties?.trim() ? { duties: v.duties.trim() } : {}),
          });
        } else {
          await apiCall('PATCH', `/positions/${position.id}`, {
            unitId: v.unitId,
            title: v.title.trim(),
            level: v.level,
            isLeader: v.isLeader,
            reportsToPositionId: v.reportsToPositionId ?? null,
            duties: v.duties?.trim() || null,
            referenceOkr: v.referenceOkr?.trim() || null,
          });
        }
      },
      { success: position ? 'Đã lưu vị trí' : 'Đã thêm vị trí' },
    );
    if (ok) onClose();
  }

  return (
    <Modal title={position ? 'Sửa vị trí việc làm' : 'Thêm vị trí việc làm'} open onCancel={onClose} onOk={() => form.submit()} okText="Lưu" cancelText="Hủy" confirmLoading={busy} width={620}>
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={
          position
            ? {
                unitId: position.unitId,
                title: position.title,
                level: position.level,
                isLeader: position.isLeader,
                reportsToPositionId: position.reportsToPositionId,
                duties: position.duties ?? undefined,
                referenceOkr: position.referenceOkr ?? undefined,
              }
            : { isLeader: false }
        }
      >
        <Form.Item name="unitId" label="Đơn vị" rules={[{ required: true, message: 'Chọn đơn vị' }]}>
          <Select options={units.map((u) => ({ value: u.id, label: u.name }))} />
        </Form.Item>
        <Form.Item name="title" label="Chức danh" rules={[{ required: true, whitespace: true, message: 'Nhập chức danh' }]}>
          <Input maxLength={160} />
        </Form.Item>
        <Space size="large" align="start" wrap>
          <Form.Item name="level" label="Cấp" rules={[{ required: true, message: 'Chọn cấp' }]}>
            <Select
              style={{ width: 260 }}
              options={Object.entries(LEVEL_LABELS).map(([value, label]) => ({ value: Number(value), label }))}
              // Thêm mới: gợi ý cờ lãnh đạo theo cấp (cấp 1 đến 4); vẫn sửa tay được.
              onChange={(v: number) => {
                if (!position) form.setFieldsValue({ isLeader: v <= 4 });
              }}
            />
          </Form.Item>
          <Form.Item
            name="reportsToPositionId"
            label="Báo cáo cho"
            extra="Chỉ hiện các vị trí có cấp nhỏ hơn. Để trống với cấp 1."
            rules={[{ required: level != null && level > 1, message: 'Chọn vị trí cấp trên' }]}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: 300 }}
              placeholder="Chọn vị trí cấp trên"
              options={superiors.map((p) => ({ value: p.id, label: `${p.title} – ${p.unitName}${p.holder ? ` (${p.holder.fullName})` : ''}` }))}
            />
          </Form.Item>
        </Space>
        <Form.Item
          name="isLeader"
          valuePropName="checked"
          extra="Người giữ vị trí này được chấm thêm ba tiêu chí lãnh đạo (kết quả đơn vị, tổ chức triển khai, đoàn kết); KPI = (a+b+c+d+đ+e)/6. Không bật: KPI = (a+b+c)/3. Nghị định 335/2025/NĐ-CP Điều 15, 16."
        >
          <Checkbox>Lãnh đạo, quản lý</Checkbox>
        </Form.Item>
        <Form.Item name="duties" label="Nhiệm vụ chính">
          <Input.TextArea rows={3} />
        </Form.Item>
        {position ? (
          <Form.Item name="referenceOkr" label="KPI/OKR then chốt (tham khảo)">
            <Input.TextArea rows={3} />
          </Form.Item>
        ) : (
          <p style={{ color: '#888', margin: 0 }}>Mã vị trí tự sinh từ đơn vị, cấp và chức danh.</p>
        )}
      </Form>
    </Modal>
  );
}

/** Hộp thoại phân công cán bộ vào một vị trí đang trống. */
function AssignModal({ position, persons, onClose }: { position: PositionRow; persons: Person[]; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<{ personId: string; validFrom?: { toISOString: () => string } }>();

  async function submit(v: { personId: string; validFrom?: { toISOString: () => string } }) {
    const ok = await run(
      async () => void (await apiCall('POST', `/positions/${position.id}/assignments`, { personId: v.personId, ...(v.validFrom ? { validFrom: v.validFrom.toISOString() } : {}) })),
      { success: 'Đã phân công' },
    );
    if (ok) onClose();
  }

  return (
    <Modal title={`Phân công vào vị trí: ${position.title} – ${position.unitName}`} open onCancel={onClose} onOk={() => form.submit()} okText="Phân công" cancelText="Hủy" confirmLoading={busy}>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="personId" label="Cán bộ" rules={[{ required: true, message: 'Chọn cán bộ' }]}>
          <Select showSearch optionFilterProp="label" placeholder="Chọn cán bộ" options={persons.filter((p) => p.active).map((p) => ({ value: p.id, label: p.fullName }))} />
        </Form.Item>
        <Form.Item name="validFrom" label="Từ ngày" extra="Để trống nếu bắt đầu từ bây giờ">
          <DatePicker format="DD/MM/YYYY" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface Props {
  rows: PositionRow[];
  units: OrgUnit[];
  persons: Person[];
}

export default function PositionsTab({ rows, units, persons }: Props) {
  const { run, busy } = useAction();
  /** undefined: đóng; null: thêm mới; PositionRow: sửa. */
  const [editing, setEditing] = useState<PositionRow | null | undefined>(undefined);
  const [assigning, setAssigning] = useState<PositionRow | null>(null);
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const shown = filter ? rows.filter((r) => r.unitId === filter) : rows;

  async function endAssignment(r: PositionRow) {
    if (!r.holder) return;
    await run(
      async () => {
        const history = await apiGet<Assignment[]>(`/persons/${r.holder!.personId}/assignments`);
        const current = history.find((a) => a.positionId === r.id && a.validTo === null);
        if (!current) throw new Error('Không tìm thấy phân công đang hiệu lực');
        await apiCall('POST', `/assignments/${current.id}/end`, {});
      },
      { success: 'Đã kết thúc phân công' },
    );
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
          Thêm vị trí
        </Button>
        <Select allowClear style={{ width: 280 }} placeholder="Lọc theo đơn vị" value={filter} onChange={setFilter} options={units.map((u) => ({ value: u.id, label: u.name }))} />
      </Space>

      <Table<PositionRow>
        rowKey="id"
        size="middle"
        dataSource={shown}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 980 }}
        columns={[
          { title: 'Chức danh', dataIndex: 'title' },
          { title: 'Đơn vị', dataIndex: 'unitName' },
          { title: 'Cấp', dataIndex: 'level', width: 70, align: 'center' },
          {
            title: (
              <Tooltip title="Cán bộ giữ vị trí này được chấm thêm ba tiêu chí lãnh đạo, KPI chia 6">
                <span>Lãnh đạo</span>
              </Tooltip>
            ),
            dataIndex: 'isLeader',
            width: 90,
            align: 'center',
            render: (v: boolean) => (v ? <Tag color="gold">Lãnh đạo</Tag> : '–'),
          },
          { title: 'Báo cáo cho', dataIndex: 'reportsToTitle', render: (t: string | null) => t ?? '–' },
          { title: 'Người đang giữ', dataIndex: 'holder', render: (h: PositionRow['holder']) => h?.fullName ?? <Tag color="orange">còn trống</Tag> },
          {
            title: '',
            width: 340,
            render: (_: unknown, r) => (
              <Space>
                {r.holder ? (
                  <Popconfirm
                    title={`Kết thúc phân công của ${r.holder.fullName}?`}
                    description="Vị trí sẽ trống. Lịch sử giữ chức vẫn được lưu."
                    okText="Kết thúc"
                    okButtonProps={{ danger: true }}
                    cancelText="Hủy"
                    onConfirm={() => endAssignment(r)}
                  >
                    <Button size="small" danger loading={busy}>
                      Kết thúc
                    </Button>
                  </Popconfirm>
                ) : (
                  <Button size="small" type="primary" icon={<UserAddOutlined />} onClick={() => setAssigning(r)}>
                    Phân công
                  </Button>
                )}
                <Button size="small" onClick={() => setEditing(r)}>
                  Sửa
                </Button>
                <Popconfirm
                  title={`Xóa vị trí "${r.title}"?`}
                  description="Chỉ xóa được khi vị trí chưa có cấp dưới, lịch sử phân công, hồ sơ đánh giá hay phạm vi công việc."
                  okText="Xóa"
                  okButtonProps={{ danger: true }}
                  cancelText="Hủy"
                  onConfirm={() => run(async () => void (await apiCall('DELETE', `/positions/${r.id}`)), { success: 'Đã xóa vị trí' })}
                >
                  <Button size="small" danger loading={busy}>
                    Xóa
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      {editing !== undefined && <PositionFormModal position={editing} rows={rows} units={units} onClose={() => setEditing(undefined)} />}
      {assigning && <AssignModal position={assigning} persons={persons} onClose={() => setAssigning(null)} />}
    </>
  );
}
