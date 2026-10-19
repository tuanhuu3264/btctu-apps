'use client';

import { HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Spin, Switch, Table, Tabs, Tag, Timeline } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { Assignment, Gender, Person, PoliticalTheory } from '@/lib/api';
import { apiCall, apiGet } from '@/lib/client';
import { dateText, foldText } from '@/lib/labels';
import ExportButtons from '@/components/export-buttons';
import ChangeHistoryButton from '@/components/change-history';
import { useAction } from '@/lib/use-action';
import type { PositionRow } from './organization-view';


interface Row extends Person {
  positionTitle: string | null;
  unitName: string | null;
}

const GENDER_LABELS: Record<Gender, string> = { NAM: 'Nam', NU: 'Nữ', KHAC: 'Khác' };
const THEORY_LABELS: Record<PoliticalTheory, string> = { SO_CAP: 'Sơ cấp', TRUNG_CAP: 'Trung cấp', CAO_CAP: 'Cao cấp', CU_NHAN: 'Cử nhân' };

interface PersonValues {
  fullName: string;
  note?: string;
  employeeCode?: string;
  gender?: Gender;
  ethnicity?: string;
  dateOfBirth?: string;
  nationalId?: string;
  email?: string;
  phone?: string;
  rank?: string;
  salaryGrade?: string;
  joinedAgencyOn?: string;
  partyJoinedOn?: string;
  education?: string;
  major?: string;
  politicalTheory?: PoliticalTheory;
}

const TEXT_FIELDS = ['employeeCode', 'ethnicity', 'dateOfBirth', 'nationalId', 'email', 'phone', 'rank', 'salaryGrade', 'joinedAgencyOn', 'partyJoinedOn', 'education', 'major'] as const;

/**
 * Hộp thoại thêm hoặc sửa cán bộ (ADR-023): ba nhóm thông tin là định danh và liên hệ, công tác, trình độ. Khi sửa, tải hồ sơ
 * đầy đủ (kèm ngày sinh, CCCD, email, điện thoại) từ máy chủ. Chỉ được dựng khi đang mở, nên mỗi lần mở là một form mới.
 */
function PersonFormModal({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<PersonValues>();
  const [loaded, setLoaded] = useState<Person | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const waiting = person !== null && loaded === null && loadError === null;

  useEffect(() => {
    if (!person) return;
    apiGet<Person>(`/persons/${person.id}/profile`)
      .then((full) => {
        setLoaded(full);
        form.setFieldsValue(toValues(full));
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [person, form]);

  async function submit(v: PersonValues) {
    const body: Record<string, unknown> = { fullName: v.fullName.trim(), note: v.note?.trim() || (person ? null : undefined) };
    for (const f of TEXT_FIELDS) {
      const value = v[f]?.trim();
      if (value) body[f] = value;
      else if (person) body[f] = null; // sửa: để trống là xóa giá trị
    }
    for (const f of ['gender', 'politicalTheory'] as const) {
      if (v[f]) body[f] = v[f];
      else if (person) body[f] = null;
    }
    const ok = await run(
      async () => {
        if (person) await apiCall('PATCH', `/persons/${person.id}`, body);
        else await apiCall('POST', '/persons', body);
      },
      { success: person ? 'Đã lưu' : 'Đã thêm cán bộ' },
    );
    if (ok) onClose();
  }

  const date = (name: keyof PersonValues, label: string) => (
    <Form.Item name={name} label={label}>
      <Input type="date" style={{ width: 200 }} max={new Date().toISOString().slice(0, 10)} />
    </Form.Item>
  );

  return (
    <Modal
      title={person ? 'Sửa hồ sơ cán bộ' : 'Thêm cán bộ'}
      open
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Lưu"
      cancelText="Hủy"
      confirmLoading={busy}
      okButtonProps={{ disabled: waiting || loadError !== null }}
      width={720}
    >
      {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 12 }} />}
      <Spin spinning={waiting}>
        <Form form={form} layout="vertical" onFinish={submit} initialValues={person ? undefined : {}}>
          <Form.Item name="fullName" label="Họ và tên" rules={[{ required: true, whitespace: true, message: 'Nhập họ tên' }]}>
            <Input maxLength={150} autoFocus />
          </Form.Item>
          <Tabs
            size="small"
            items={[
              {
                key: 'id',
                label: 'Định danh và liên hệ',
                forceRender: true,
                children: (
                  <>
                    <Space size="large" align="start" wrap>
                      <Form.Item name="employeeCode" label="Mã cán bộ" extra="Không trùng. Tự viết hoa.">
                        <Input maxLength={32} style={{ width: 200 }} />
                      </Form.Item>
                      <Form.Item name="gender" label="Giới tính">
                        <Select allowClear style={{ width: 140 }} options={(Object.keys(GENDER_LABELS) as Gender[]).map((g) => ({ value: g, label: GENDER_LABELS[g] }))} />
                      </Form.Item>
                      <Form.Item name="ethnicity" label="Dân tộc">
                        <Input maxLength={60} style={{ width: 160 }} />
                      </Form.Item>
                      {date('dateOfBirth', 'Ngày sinh')}
                    </Space>
                    <Space size="large" align="start" wrap>
                      <Form.Item name="nationalId" label="Số định danh cá nhân (CCCD)" rules={[{ pattern: /^[0-9]{12}$/, message: 'Gồm đúng 12 chữ số' }]}>
                        <Input maxLength={12} style={{ width: 220 }} />
                      </Form.Item>
                      <Form.Item name="phone" label="Điện thoại" rules={[{ pattern: /^(\+84|0)[0-9]{9,10}$/, message: 'Số điện thoại không đúng định dạng' }]}>
                        <Input maxLength={20} style={{ width: 180 }} />
                      </Form.Item>
                      <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Email không đúng định dạng' }]}>
                        <Input maxLength={160} style={{ width: 260 }} />
                      </Form.Item>
                    </Space>
                    <Alert type="info" showIcon message="Ngày sinh, CCCD, email, điện thoại là dữ liệu cá nhân: chỉ người quản lý tổ chức xem được, nhật ký không ghi giá trị." />
                  </>
                ),
              },
              {
                key: 'work',
                label: 'Công tác',
                forceRender: true,
                children: (
                  <>
                    <Space size="large" align="start" wrap>
                      <Form.Item name="rank" label="Ngạch">
                        <Input maxLength={160} style={{ width: 300 }} placeholder="Ví dụ: Chuyên viên chính" />
                      </Form.Item>
                      <Form.Item name="salaryGrade" label="Bậc lương">
                        <Input maxLength={40} style={{ width: 160 }} />
                      </Form.Item>
                    </Space>
                    <Space size="large" align="start" wrap>
                      {date('joinedAgencyOn', 'Ngày vào cơ quan')}
                      {date('partyJoinedOn', 'Ngày vào Đảng')}
                    </Space>
                    <p style={{ color: '#888', margin: 0 }}>Vị trí và ngày bổ nhiệm vào vị trí hiện tại được ghi ở tab Vị trí việc làm (phân công).</p>
                  </>
                ),
              },
              {
                key: 'edu',
                label: 'Trình độ',
                forceRender: true,
                children: (
                  <>
                    <Space size="large" align="start" wrap>
                      <Form.Item name="education" label="Trình độ chuyên môn">
                        <Input maxLength={160} style={{ width: 240 }} placeholder="Ví dụ: Thạc sĩ" />
                      </Form.Item>
                      <Form.Item name="major" label="Chuyên ngành">
                        <Input maxLength={160} style={{ width: 280 }} />
                      </Form.Item>
                    </Space>
                    <Form.Item name="politicalTheory" label="Lý luận chính trị">
                      <Select allowClear style={{ width: 200 }} options={(Object.keys(THEORY_LABELS) as PoliticalTheory[]).map((t) => ({ value: t, label: THEORY_LABELS[t] }))} />
                    </Form.Item>
                  </>
                ),
              },
              {
                key: 'note',
                label: 'Ghi chú',
                forceRender: true,
                children: (
                  <Form.Item name="note" label="Ghi chú">
                    <Input.TextArea rows={3} maxLength={2000} />
                  </Form.Item>
                ),
              },
            ]}
          />
        </Form>
      </Spin>
    </Modal>
  );
}

function toValues(p: Person): PersonValues {
  const v: PersonValues = { fullName: p.fullName, note: p.note ?? undefined };
  for (const f of TEXT_FIELDS) v[f] = p[f] ?? undefined;
  v.gender = p.gender ?? undefined;
  v.politicalTheory = p.politicalTheory ?? undefined;
  return v;
}

export default function PersonsTab({ persons, positions, canAudit = false }: { persons: Person[]; positions: PositionRow[]; canAudit?: boolean }) {
  const { run, busy } = useAction();
  /** undefined: đóng; null: thêm mới; Person: sửa. */
  const [editing, setEditing] = useState<Person | null | undefined>(undefined);
  const [history, setHistory] = useState<{ person: Person; items: Assignment[] } | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');

  const rows: Row[] = useMemo(() => {
    // Cán bộ kiêm nhiệm giữ nhiều vị trí: hiện vị trí chính trước, rồi các vị trí kiêm nhiệm.
    const held = new Map<string, PositionRow[]>();
    for (const p of [...positions].sort((a, b) => Number(a.holder?.kind === 'CONCURRENT') - Number(b.holder?.kind === 'CONCURRENT'))) {
      if (p.holder) held.set(p.holder.personId, [...(held.get(p.holder.personId) ?? []), p]);
    }
    const needle = foldText(search);
    return persons
      .filter((p) => showInactive || p.active)
      .filter((p) => !needle || foldText(p.fullName).includes(needle) || foldText(p.employeeCode ?? '').includes(needle))
      .map((p) => {
        const mine = held.get(p.id) ?? [];
        return {
          ...p,
          positionTitle: mine.length === 0 ? null : mine.map((x, i) => (i === 0 ? x.title : `${x.title} (kiêm nhiệm)`)).join('; '),
          unitName: mine.length === 0 ? null : [...new Set(mine.map((x) => x.unitName))].join('; '),
        };
      });
  }, [persons, positions, showInactive, search]);

  const positionTitle = (id: string) => {
    const p = positions.find((x) => x.id === id);
    return p ? `${p.title} – ${p.unitName}` : id;
  };

  async function openHistory(person: Person) {
    await run(async () => setHistory({ person, items: await apiGet<Assignment[]>(`/persons/${person.id}/assignments`) }), { refresh: false });
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
          Thêm cán bộ
        </Button>
        <Input.Search allowClear placeholder="Tìm theo họ tên hoặc mã (không cần dấu)" style={{ width: 300 }} onChange={(e) => setSearch(e.target.value)} />
        <ExportButtons path={`/org/export?list=persons&includeInactive=${showInactive}`} />
        <Space>
          <Switch checked={showInactive} onChange={setShowInactive} /> Hiện cả cán bộ đã ngừng quản lý
        </Space>
      </Space>

      <Table<Row>
        rowKey="id"
        size="middle"
        dataSource={rows}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: 1100 }}
        columns={[
          { title: 'Họ và tên', dataIndex: 'fullName' },
          { title: 'Mã', dataIndex: 'employeeCode', width: 100, render: (v: string | null) => v ?? '–' },
          { title: 'Đơn vị', dataIndex: 'unitName', render: (v: string | null) => v ?? '–' },
          { title: 'Chức vụ hiện tại', dataIndex: 'positionTitle', render: (v: string | null) => v ?? <Tag>chưa giữ vị trí</Tag> },
          { title: 'Ngạch', dataIndex: 'rank', render: (v: string | null) => v ?? '–' },
          { title: 'Trình độ', dataIndex: 'education', render: (v: string | null) => v ?? '–' },
          { title: 'Trạng thái', dataIndex: 'active', render: (a: boolean) => (a ? <Tag color="green">Đang quản lý</Tag> : <Tag color="red">Đã ngừng</Tag>) },
          { title: 'Ghi chú', dataIndex: 'note', render: (n: string | null) => n ?? '–' },
          {
            title: '',
            width: 340,
            render: (_: unknown, r) => (
              <Space>
                <Button size="small" icon={<HistoryOutlined />} onClick={() => openHistory(r)}>
                  Lịch sử
                </Button>
                <ChangeHistoryButton targetType="person" targetId={r.id} title={r.fullName} canView={canAudit} />
                <Button size="small" onClick={() => setEditing(r)}>
                  Sửa
                </Button>
                {r.active && (
                  <Popconfirm
                    title={`Ngừng quản lý ${r.fullName}?`}
                    description="Cán bộ sẽ không còn được giao hồ sơ mới. Lịch sử vẫn được giữ."
                    okText="Ngừng quản lý"
                    okButtonProps={{ danger: true }}
                    cancelText="Hủy"
                    onConfirm={() => run(async () => void (await apiCall('POST', `/persons/${r.id}/deactivate`)), { success: 'Đã ngừng quản lý' })}
                  >
                    <Button size="small" danger loading={busy}>
                      Ngừng
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      {editing !== undefined && <PersonFormModal person={editing} onClose={() => setEditing(undefined)} />}

      <Drawer title={history ? `Lịch sử giữ vị trí: ${history.person.fullName}` : ''} open={history !== null} onClose={() => setHistory(null)} size={420}>
        {history && history.items.length === 0 ? (
          <p>Chưa từng giữ vị trí nào.</p>
        ) : (
          <Timeline
            items={(history?.items ?? []).map((a) => ({
              color: a.validTo ? 'gray' : 'green',
              children: (
                <>
                  <strong>{positionTitle(a.positionId)}</strong>
                  <br />
                  {dateText(a.validFrom)} → {a.validTo ? dateText(a.validTo) : 'nay'}
                </>
              ),
            }))}
          />
        )}
      </Drawer>
    </>
  );
}
