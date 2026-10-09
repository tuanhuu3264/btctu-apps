'use client';

import { Alert, Checkbox, DatePicker, Divider, Form, Input, InputNumber, Modal, Radio, Select } from 'antd';
import CatalogItemPicker from '@/components/catalog-item-picker';
import type { PickerGroup, PickerItem, PickerTask } from '@/components/catalog-item-picker';
import type { OrgUnit, PeriodMode, ReportKind, WorkTask } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { REPORT_KIND_LABELS } from '@/lib/labels';
import { holderLabel, holdersOf, superiorsOf } from '@/lib/org';
import { inScope } from '@/lib/scope';
import { useAction } from '@/lib/use-action';

export interface Assignee {
  personId: string;
  label: string;
  /** Đơn vị và vị trí đang giữ, để chỉ liệt kê các công việc áp dụng cho người này (ADR-021). */
  unitId: string;
  positionId: string;
}

interface Values {
  assigneePersonId: string;
  taskMode: 'catalog' | 'existing' | 'new';
  /** Nhiệm vụ của danh mục đã chọn (chế độ 'catalog'). */
  catalogTaskId?: string;
  taskId?: string;
  taskTitle?: string;
  taskDescription?: string;
  catalogItemCode: string;
  plannedQuantity: number;
  dueDate: { format: (pattern: string) => string };
  periodMode: PeriodMode;
  reportKinds?: ReportKind[];
  note?: string;
  approverPersonId?: string;
  consultantPersonIds?: string[];
}

interface Props {
  assignees: Assignee[];
  /** Nhiệm vụ đã có của cấp dưới, để chọn lại. */
  tasks: WorkTask[];
  catalogItems: PickerItem[];
  catalogGroups: PickerGroup[];
  /** Nhiệm vụ của danh mục, để chia danh sách công việc theo nhiệm vụ. */
  catalogTasks: PickerTask[];
  /** Sơ đồ tổ chức, để chọn người duyệt (cc) và người tham vấn. */
  tree: OrgUnit[];
  /** Có nhiệm vụ: thêm công việc vào nhiệm vụ đó (cán bộ và nhiệm vụ đã cố định). null: giao từ đầu. */
  preset: WorkTask | null;
  onClose: () => void;
}

/**
 * Giao việc theo ba bước: chọn cán bộ; chọn **nhiệm vụ của danh mục** (mặc định), rồi chọn công việc trong nhiệm vụ đó,
 * chỉ gồm các công việc áp dụng cho người nhận (ADR-019, ADR-021). Nhiệm vụ của người nhận (ADR-018) lấy tên theo nhiệm
 * vụ danh mục, tự dùng lại nếu đã có hoặc tự tạo; vẫn chọn được nhiệm vụ đã có hoặc tạo nhiệm vụ riêng. Chỉ được dựng
 * khi đang mở nên mỗi lần mở là một form mới.
 */
export default function AssignModal({ assignees, tasks, catalogItems, catalogGroups, catalogTasks, tree, preset, onClose }: Props) {
  const { run, busy, router } = useAction();
  const [form] = Form.useForm<Values>();
  const assigneeId = Form.useWatch('assigneePersonId', form);
  const taskMode = Form.useWatch('taskMode', form);
  const taskId = Form.useWatch('taskId', form);
  const catalogTaskId = Form.useWatch('catalogTaskId', form);
  const taskTitle = Form.useWatch('taskTitle', form);
  const periodMode = Form.useWatch('periodMode', form);

  const personTasks = tasks.filter((t) => t.assigneePersonId === assigneeId);
  // Bước 3 chỉ hiện sau khi đã có nhiệm vụ: chọn nhiệm vụ đã có, hoặc đã gõ tên nhiệm vụ mới.
  const hasTask = preset !== null || (taskMode === 'catalog' ? Boolean(catalogTaskId) : taskMode === 'new' ? (taskTitle ?? '').trim().length >= 3 : Boolean(taskId));
  const presetPerson = preset ? assignees.find((a) => a.personId === preset.assigneePersonId) : undefined;
  // Công việc có phạm vi chỉ hiện cho người thuộc phạm vi đó; việc chung hiện cho mọi người.
  const recipient = assignees.find((a) => a.personId === (preset?.assigneePersonId ?? assigneeId));
  const target = recipient ? { unitId: recipient.unitId, positionId: recipient.positionId } : null;
  const availableItems = recipient ? catalogItems.filter((i) => inScope(i, target)) : catalogItems;
  const hiddenCount = catalogItems.length - availableItems.length;
  const assigneeKey = preset?.assigneePersonId ?? assigneeId;
  const superiors = assigneeKey ? superiorsOf(tree, assigneeKey) : [];
  const everyone = holdersOf(tree).filter((h) => h.personId !== assigneeKey);
  const chosenCatalogTask = catalogTasks.find((t) => t.id === catalogTaskId);
  // Chế độ danh mục: chỉ các công việc của nhiệm vụ đã chọn. Nhiệm vụ không còn công việc nào dành cho người nhận thì không hiện.
  const pickableItems = taskMode === 'catalog' && !preset ? availableItems.filter((i) => i.taskId === catalogTaskId) : availableItems;
  const catalogTaskOptions = catalogGroups
    .map((g) => ({
      label: `Nhóm ${g.code}: ${g.name}`,
      options: catalogTasks
        .filter((t) => t.groupCode === g.code)
        .map((t) => ({ t, n: availableItems.filter((i) => i.taskId === t.id).length }))
        .filter(({ n }) => n > 0)
        .map(({ t, n }) => ({ value: t.id, label: `${t.name} (${n} công việc)` })),
    }))
    .filter((g) => g.options.length > 0);

  async function submit(v: Values) {
    const ok = await run(
      async () => {
        let id = preset?.id ?? v.taskId;
        let created: WorkTask | null = null;
        if (!preset && v.taskMode === 'catalog') {
          // Nhiệm vụ của người nhận lấy tên theo nhiệm vụ danh mục: dùng lại nếu đã có, chưa có thì tạo.
          const name = chosenCatalogTask?.name ?? '';
          const same = personTasks.find((t) => t.title.trim().toLowerCase() === name.trim().toLowerCase());
          if (same) id = same.id;
          else {
            created = await apiCall<WorkTask>('POST', '/tasking/tasks', { assigneePersonId: v.assigneePersonId, title: name });
            id = created?.id;
          }
        } else if (!preset && v.taskMode === 'new') {
          created = await apiCall<WorkTask>('POST', '/tasking/tasks', {
            assigneePersonId: v.assigneePersonId,
            title: (v.taskTitle ?? '').trim(),
            ...(v.taskDescription?.trim() ? { description: v.taskDescription.trim() } : {}),
          });
          id = created?.id;
        }
        try {
          await apiCall('POST', '/tasking/assignments', {
            taskId: id,
            catalogItemCode: v.catalogItemCode,
            plannedQuantity: v.plannedQuantity,
            dueDate: v.dueDate.format('YYYY-MM-DD'),
            periodMode: v.periodMode,
            ...(v.periodMode === 'MANUAL' ? { reportKinds: v.reportKinds } : {}),
            ...(v.note?.trim() ? { note: v.note.trim() } : {}),
            ...(v.approverPersonId ? { approverPersonId: v.approverPersonId } : {}),
            ...((v.consultantPersonIds ?? []).length > 0 ? { consultantPersonIds: v.consultantPersonIds } : {}),
          });
        } catch (e) {
          // Nhiệm vụ đã tạo thì giữ lại: làm mới danh sách và chuyển sang "nhiệm vụ đã có" để thử lại không bị trùng tên.
          if (created) {
            form.setFieldsValue({ taskMode: 'existing', taskId: created.id });
            router.refresh();
          }
          throw e;
        }
      },
      { success: 'Đã giao việc' },
    );
    if (ok) onClose();
  }

  const noAssignee = !preset && assignees.length === 0;

  return (
    <Modal
      title={preset ? `Thêm công việc vào nhiệm vụ: ${preset.title}` : 'Giao việc cho cấp dưới'}
      open
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Giao việc"
      cancelText="Hủy"
      confirmLoading={busy}
      okButtonProps={{ disabled: !hasTask }}
      width={760}
    >
      {noAssignee ? (
        <Alert type="info" showIcon message="Bạn chưa có cấp dưới trực tiếp nào trong sơ đồ tổ chức." />
      ) : (
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ periodMode: 'AUTO', taskMode: 'catalog', ...(preset ? { assigneePersonId: preset.assigneePersonId, taskId: preset.id } : {}) }}>
          <Divider titlePlacement="start" plain style={{ marginTop: 0 }}>
            Bước 1: cán bộ nhận việc
          </Divider>
          {preset ? (
            <p>{presetPerson?.label ?? 'Cán bộ của nhiệm vụ'}</p>
          ) : (
            <Form.Item name="assigneePersonId" rules={[{ required: true, message: 'Chọn cán bộ' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Chọn cán bộ"
                options={assignees.map((a) => ({ value: a.personId, label: a.label }))}
                onChange={() => form.setFieldsValue({ taskId: undefined, taskTitle: undefined, catalogTaskId: undefined, catalogItemCode: undefined, taskMode: 'catalog', approverPersonId: undefined, consultantPersonIds: [] })}
              />
            </Form.Item>
          )}

          {!preset && assigneeId && (
            <>
              <Divider titlePlacement="start" plain>
                Bước 2: nhiệm vụ
              </Divider>
              <Form.Item name="taskMode">
                <Radio.Group onChange={() => form.setFieldsValue({ catalogItemCode: undefined })}>
                  <Radio value="catalog">Từ danh mục nhiệm vụ</Radio>
                  <Radio value="existing" disabled={personTasks.length === 0}>
                    Nhiệm vụ đã có của cán bộ ({personTasks.length})
                  </Radio>
                  <Radio value="new">Nhiệm vụ riêng mới</Radio>
                </Radio.Group>
              </Form.Item>
              {taskMode === 'catalog' ? (
                <Form.Item name="catalogTaskId" rules={[{ required: true, message: 'Chọn nhiệm vụ trong danh mục' }]} extra="Chọn nhiệm vụ trước, danh sách công việc của nhiệm vụ đó hiện ở bước sau.">
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder={catalogTaskOptions.length === 0 ? 'Không có nhiệm vụ nào có công việc dành cho cán bộ này' : 'Chọn nhiệm vụ trong danh mục (gõ để lọc)'}
                    options={catalogTaskOptions}
                    listHeight={400}
                    onChange={() => form.setFieldsValue({ catalogItemCode: undefined })}
                  />
                </Form.Item>
              ) : taskMode === 'new' ? (
                <>
                  <Form.Item name="taskTitle" label="Tên nhiệm vụ" rules={[{ required: true, whitespace: true, min: 3, message: 'Nhập tên nhiệm vụ (ít nhất 3 ký tự)' }]}>
                    <Input maxLength={200} placeholder="Ví dụ: Rà soát, bổ sung quy hoạch cán bộ 2025-2030" />
                  </Form.Item>
                  <Form.Item name="taskDescription" label="Mô tả (tùy chọn)">
                    <Input.TextArea rows={2} maxLength={2000} />
                  </Form.Item>
                </>
              ) : (
                <Form.Item name="taskId" rules={[{ required: true, message: 'Chọn nhiệm vụ' }]}>
                  <Select
                    placeholder={personTasks.length === 0 ? 'Cán bộ này chưa có nhiệm vụ nào, hãy tạo mới' : 'Chọn nhiệm vụ'}
                    options={personTasks.map((t) => ({ value: t.id, label: t.title }))}
                  />
                </Form.Item>
              )}
            </>
          )}

          {hasTask && (
            <>
              <Divider titlePlacement="start" plain>
                {preset ? 'Công việc từ danh mục' : 'Bước 3: công việc từ danh mục'}
              </Divider>
              <Form.Item name="catalogItemCode" rules={[{ required: true, message: 'Chọn công việc' }]}>
                <CatalogItemPicker items={pickableItems} groups={catalogGroups} tasks={catalogTasks} placeholder={taskMode === 'catalog' && !preset ? 'Chọn công việc của nhiệm vụ (gõ mã hoặc tên để lọc)' : undefined} />
              </Form.Item>
              {hiddenCount > 0 && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={`Đã ẩn ${hiddenCount} công việc không thuộc phạm vi áp dụng của đơn vị, vị trí của cán bộ này.`}
                />
              )}
              <Form.Item label="Số lượng và hạn hoàn thành" style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <Form.Item name="plannedQuantity" rules={[{ required: true, message: 'Nhập số lượng' }]}>
                    <InputNumber min={1} max={100000} precision={0} placeholder="Số lượng" />
                  </Form.Item>
                  <Form.Item name="dueDate" rules={[{ required: true, message: 'Chọn hạn' }]}>
                    <DatePicker format="DD/MM/YYYY" placeholder="Hạn hoàn thành" />
                  </Form.Item>
                </div>
              </Form.Item>
              <Form.Item name="periodMode" label="Tính vào báo cáo">
                <Radio.Group>
                  <Radio value="AUTO">Tự động (máy cộng vào báo cáo tháng, quý, năm theo hạn)</Radio>
                  <Radio value="MANUAL">Thêm tay (tôi chọn loại báo cáo)</Radio>
                </Radio.Group>
              </Form.Item>
              {periodMode === 'MANUAL' && (
                <Form.Item name="reportKinds" label="Loại báo cáo" rules={[{ required: true, message: 'Chọn ít nhất một loại', type: 'array', min: 1 }]}>
                  <Checkbox.Group options={(Object.keys(REPORT_KIND_LABELS) as ReportKind[]).map((k) => ({ value: k, label: REPORT_KIND_LABELS[k] }))} />
                </Form.Item>
              )}
              <Form.Item name="note" label="Nội dung việc">
                <Input.TextArea rows={4} maxLength={4000} showCount placeholder="Yêu cầu, phạm vi, căn cứ, lưu ý cho người thực hiện" />
              </Form.Item>
              <Form.Item name="approverPersonId" label="Người duyệt (cc)" extra="Người xác nhận hoặc từ chối báo cáo của việc này. Để trống: cấp trên trực tiếp.">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="Mặc định: cấp trên trực tiếp"
                  options={superiors.map((h, i) => ({ value: h.personId, label: `${holderLabel(h)}${i === 0 ? ' (cấp trên trực tiếp)' : ''}` }))}
                />
              </Form.Item>
              <Form.Item name="consultantPersonIds" label="Người tham vấn (không bắt buộc)" extra="Tối đa 10 người. Họ xem được việc, trao đổi và góp ý ở mục Trao đổi.">
                <Select mode="multiple" allowClear showSearch optionFilterProp="label" maxCount={10} placeholder="Chọn người tham vấn" options={everyone.map((h) => ({ value: h.personId, label: holderLabel(h) }))} />
              </Form.Item>
            </>
          )}
        </Form>
      )}
    </Modal>
  );
}
