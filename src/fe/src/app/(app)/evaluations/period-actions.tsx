'use client';

import { PlusOutlined, SyncOutlined, UserAddOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Form, InputNumber, List, Modal, Popconfirm, Select } from 'antd';
import { useState } from 'react';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

export interface Assignee {
  personId: string;
  label: string;
}

interface GenerateResult {
  period: string;
  created: number;
  refreshed: number;
  skipped: { personId: string; reason: string }[];
  warnings: string[];
}

interface Props {
  periodId: string | null;
  /** Tên cán bộ theo mã, để hiện kết quả tạo hồ sơ. */
  names: Record<string, string>;
  periodOpen: boolean;
  canManagePeriod: boolean;
  canAssign: boolean;
  /** Cấp dưới trực tiếp chưa có hồ sơ trong kỳ đang chọn. */
  assignees: Assignee[];
}

type PeriodType = 'MONTH' | 'QUARTER' | 'YEAR';

export default function PeriodActions({ periodId, names, periodOpen, canManagePeriod, canAssign, assignees }: Props) {
  const { run, busy, router } = useAction();
  const [periodModal, setPeriodModal] = useState(false);
  const [assignModal, setAssignModal] = useState(false);
  const [generated, setGenerated] = useState<GenerateResult | null>(null);
  const [periodForm] = Form.useForm<{ type: PeriodType; year: number; number?: number }>();
  const [assignForm] = Form.useForm<{ person: string }>();
  const type = Form.useWatch('type', periodForm);

  const showAssign = canAssign && periodOpen && periodId !== null;

  async function createPeriod(v: { type: PeriodType; year: number; number?: number }) {
    await run(
      async () => {
        const created = await apiCall<{ id: string }>('POST', '/evaluation/periods', {
          type: v.type,
          year: v.year,
          ...(v.type === 'YEAR' || v.number == null ? {} : { number: v.number }),
        });
        setPeriodModal(false);
        if (created) router.push(`/evaluations?period=${created.id}`);
      },
      { success: 'Đã tạo kỳ đánh giá' },
    );
  }

  async function generate() {
    await run(async () => setGenerated((await apiCall<GenerateResult>('POST', `/evaluation/periods/${periodId}/generate`)) ?? null));
  }

  async function createEvaluation(v: { person: string }) {
    await run(
      async () => {
        const created = await apiCall<{ id: string }>('POST', `/evaluation/periods/${periodId}/evaluations`, { personId: v.person });
        setAssignModal(false);
        assignForm.resetFields();
        if (created) router.push(`/evaluations/${created.id}`);
      },
      { refresh: false, success: 'Đã tạo hồ sơ' },
    );
  }

  return (
    <>
      {canManagePeriod && (
        <>
          <Button icon={<PlusOutlined />} onClick={() => setPeriodModal(true)}>
            Tạo kỳ
          </Button>
          <Modal
            title="Tạo kỳ đánh giá"
            open={periodModal}
            onCancel={() => setPeriodModal(false)}
            onOk={() => periodForm.submit()}
            okText="Tạo"
            cancelText="Hủy"
            confirmLoading={busy}
            destroyOnHidden
          >
            <Form form={periodForm} layout="vertical" onFinish={createPeriod} initialValues={{ type: 'QUARTER', year: new Date().getFullYear() }}>
              <Form.Item name="type" label="Loại kỳ" rules={[{ required: true }]}>
                <Select options={[{ value: 'MONTH', label: 'Tháng' }, { value: 'QUARTER', label: 'Quý' }, { value: 'YEAR', label: 'Năm' }]} />
              </Form.Item>
              <Form.Item name="year" label="Năm" rules={[{ required: true }]}>
                <InputNumber min={2000} max={2100} precision={0} />
              </Form.Item>
              {type !== 'YEAR' && (
                <Form.Item name="number" label={type === 'MONTH' ? 'Tháng (1–12)' : 'Quý (1–3)'} rules={[{ required: true, message: 'Nhập số' }]}>
                  <InputNumber min={1} max={type === 'MONTH' ? 12 : 3} precision={0} />
                </Form.Item>
              )}
            </Form>
          </Modal>
          {periodId && periodOpen && (
            <Popconfirm
              title="Tạo hồ sơ từ việc được giao?"
              description="Hệ thống gộp các việc có hạn trong kỳ và điền sẵn chỉ tiêu, kết quả đã được cấp trên xác nhận. Hồ sơ đã tự chấm trở đi không bị đổi."
              okText="Tạo hồ sơ"
              cancelText="Hủy"
              onConfirm={generate}
            >
              <Button icon={<SyncOutlined />} loading={busy}>
                Tạo hồ sơ từ việc
              </Button>
            </Popconfirm>
          )}
          {periodId && periodOpen && (
            <Popconfirm
              title="Đóng kỳ đang chọn?"
              description="Sau khi đóng không giao, chấm hay duyệt thêm được."
              okText="Đóng kỳ"
              okButtonProps={{ danger: true }}
              cancelText="Hủy"
              onConfirm={() => run(async () => void (await apiCall('POST', `/evaluation/periods/${periodId}/close`)), { success: 'Đã đóng kỳ' })}
            >
              <Button danger loading={busy}>
                Đóng kỳ
              </Button>
            </Popconfirm>
          )}
        </>
      )}

      <Modal title={`Kết quả tạo hồ sơ kỳ ${generated?.period ?? ''}`} open={generated !== null} onCancel={() => setGenerated(null)} footer={<Button onClick={() => setGenerated(null)}>Đóng</Button>}>
        {generated && (
          <>
            <Descriptions
              size="small"
              column={2}
              items={[
                { key: 'c', label: 'Hồ sơ mới', children: generated.created },
                { key: 'r', label: 'Hồ sơ được làm mới', children: generated.refreshed },
              ]}
            />
            {generated.created + generated.refreshed === 0 && generated.skipped.length === 0 && (
              <Alert type="info" showIcon message="Không có việc nào có hạn trong kỳ này." style={{ marginBottom: 12 }} />
            )}
            {generated.skipped.length > 0 && (
              <List
                size="small"
                header="Không điền được"
                dataSource={generated.skipped}
                renderItem={(s) => (
                  <List.Item>
                    {names[s.personId] ?? s.personId}: {s.reason}
                  </List.Item>
                )}
              />
            )}
            {generated.warnings.length > 0 && <Alert type="warning" showIcon style={{ marginTop: 12 }} message="Cần xem lại" description={<ul style={{ margin: 0, paddingLeft: 20 }}>{generated.warnings.map((w) => <li key={w}>{w}</li>)}</ul>} />}
          </>
        )}
      </Modal>

      {showAssign && (
        <>
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setAssignModal(true)}>
            Giao mục tiêu
          </Button>
          <Modal
            title="Giao mục tiêu cho cấp dưới"
            open={assignModal}
            onCancel={() => setAssignModal(false)}
            onOk={() => assignForm.submit()}
            okText="Tạo hồ sơ"
            cancelText="Hủy"
            confirmLoading={busy}
            okButtonProps={{ disabled: assignees.length === 0 }}
            destroyOnHidden
          >
            {assignees.length === 0 ? (
              <p>Không còn cấp dưới trực tiếp nào chưa có hồ sơ trong kỳ này.</p>
            ) : (
              <Form form={assignForm} layout="vertical" onFinish={createEvaluation}>
                <Form.Item name="person" label="Cán bộ" rules={[{ required: true, message: 'Chọn cán bộ' }]}>
                  <Select showSearch optionFilterProp="label" placeholder="Chọn cán bộ" options={assignees.map((a) => ({ value: a.personId, label: a.label }))} />
                </Form.Item>
              </Form>
            )}
          </Modal>
        </>
      )}
    </>
  );
}
