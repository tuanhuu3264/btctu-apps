'use client';

import { Button, Form, Modal, Select, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { OrgUnit } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

/** Tiêu đề của một ô chọn, kèm các nút thao tác nhanh nằm cùng hàng ở bên phải. */
function FieldHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
      <span>{title}</span>
      <span>{children}</span>
    </div>
  );
}

interface Values {
  unitIds: string[];
  positionIds: string[];
}

interface Props {
  title: string;
  /** Đường dẫn PUT: công việc hoặc nhiệm vụ của danh mục. */
  endpoint: string;
  initial: Values;
  org: OrgUnit[];
  /** Ghi chú thêm dưới tiêu đề, ví dụ nhiệm vụ này sẽ thay phạm vi của mọi công việc trong nó. */
  note?: string;
  onClose: () => void;
}

/**
 * Hộp thoại gán phạm vi áp dụng của công việc (ADR-021): chọn các đơn vị và vị trí được giao công việc này.
 * Để trống cả hai là việc chung, giao được cho mọi cán bộ. Chỉ được dựng khi đang mở nên mỗi lần mở là một form mới.
 */
export default function ScopeEditor({ title, endpoint, initial, org, note, onClose }: Props) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<Values>();
  const selectedUnits = Form.useWatch('unitIds', form) ?? [];
  const selectedPositions = Form.useWatch('positionIds', form) ?? [];
  // Nút "Chọn tất cả" của ô cán bộ: cán bộ của các phòng ban đã chọn; chưa chọn phòng ban nào thì của mọi phòng ban.
  const candidatePositions = (selectedUnits.length > 0 ? org.filter((u) => selectedUnits.includes(u.id)) : org).flatMap((u) => u.positions.map((p) => p.id));

  async function submit(v: Values) {
    const ok = await run(async () => void (await apiCall('PUT', endpoint, { unitIds: v.unitIds ?? [], positionIds: v.positionIds ?? [] })), {
      success: 'Đã lưu phạm vi áp dụng',
    });
    if (ok) onClose();
  }

  return (
    <Modal title={title} open onCancel={onClose} onOk={() => form.submit()} okText="Lưu" cancelText="Hủy" confirmLoading={busy} width={640}>
      <Typography.Paragraph type="secondary">
        Chỉ cán bộ thuộc các đơn vị hoặc đang giữ các vị trí được chọn mới được giao công việc này. Để trống cả hai nghĩa là công việc chung, giao được cho mọi cán bộ.
        {note ? ` ${note}` : ''}
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={initial}>
        <FieldHeader title="Đơn vị (ban, phòng)">
          <Button type="link" size="small" onClick={() => form.setFieldsValue({ unitIds: org.map((u) => u.id) })}>
            Chọn tất cả
          </Button>
          <Button type="link" size="small" onClick={() => form.setFieldsValue({ unitIds: [] })} disabled={selectedUnits.length === 0}>
            Bỏ chọn tất cả
          </Button>
        </FieldHeader>
        <Form.Item name="unitIds" extra="Không bao gồm đơn vị con: chọn riêng từng ban, phòng.">
          <Select
            mode="multiple"
            allowClear
            optionFilterProp="label"
            placeholder="Chưa chọn đơn vị nào"
            options={org.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))}
          />
        </Form.Item>
        <FieldHeader title="Vị trí việc làm (cán bộ)">
          <Button
            type="link"
            size="small"
            title={selectedUnits.length > 0 ? 'Chọn mọi cán bộ trong các phòng ban đã chọn ở trên' : 'Chưa chọn phòng ban nào nên chọn cán bộ của mọi phòng ban'}
            onClick={() => form.setFieldsValue({ positionIds: [...new Set([...(form.getFieldValue('positionIds') ?? []), ...candidatePositions])] })}
          >
            Chọn tất cả
          </Button>
          <Button type="link" size="small" onClick={() => form.setFieldsValue({ positionIds: [] })} disabled={selectedPositions.length === 0}>
            Bỏ chọn tất cả
          </Button>
        </FieldHeader>
        <Form.Item name="positionIds">
          <Select
            mode="multiple"
            allowClear
            optionFilterProp="label"
            placeholder="Chưa chọn vị trí nào"
            options={org
              .filter((u) => u.positions.length > 0)
              .map((u) => ({
                label: u.name,
                options: u.positions.map((p) => ({ value: p.id, label: `${p.title}${p.holder ? ` – ${p.holder.fullName}` : ' (trống)'}` })),
              }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
