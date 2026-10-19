'use client';

import { Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Typography } from 'antd';
import { useState } from 'react';
import type { EvaluationDetail, EvaluationStatus, EvaluationTask, GeneralMark, SupportScores } from '@/lib/api';
import { apiCall } from '@/lib/client';
import CatalogItemPicker from '@/components/catalog-item-picker';
import type { PickerGroup, PickerItem, PickerTask } from '@/components/catalog-item-picker';
import { EXCEPTION_LABELS, QUALITY_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-action';
import GeneralCriteriaFields, { generalInitial, generalMarks } from './general-criteria-fields';

interface Props {
  evaluationId: string;
  status: EvaluationStatus;
  periodOpen: boolean;
  permissions: string[];
  tasks: EvaluationTask[];
  /** Điểm chung đã tự chấm, dùng làm giá trị gợi ý khi thẩm định. */
  selfGeneralScore: number | null;
  /** Cán bộ lãnh đạo, quản lý được chấm thêm tiêu chí D; unitResult là gợi ý từ xếp loại của cấp dưới. */
  isLeader: boolean;
  /** Vị trí hỗ trợ, phục vụ: chấm ba tiêu chí a, b, c (%) thay cho chỉ tiêu (ADR-053). */
  isSupport: boolean;
  /** Ba tiêu chí người lao động đã tự đánh giá, dùng làm giá trị gợi ý khi thẩm định. */
  selfSupport: SupportScores | null;
  /** Kỳ năm: điểm là trung bình các tháng, không nhập điểm và chỉ tiêu (ADR-035). */
  isYear: boolean;
  /** Kỳ năm: đủ điều kiện xếp loại (từ 6 tháng); chưa đủ thì được đóng là "không xếp loại" (ADR-039). */
  yearEnough: boolean;
  suggestedUnitResult: number | null;
  /** Gợi ý tiêu chí đoàn kết từ phản ánh, khiếu nại về mất đoàn kết trong kỳ (ADR-040). */
  suggestedSolidarity: { value: number; reason: string } | null;
  /** Bảng tiêu chí chung chấm theo mục (ADR-054); null thì nhập một điểm 0–30. */
  generalCriteria: EvaluationDetail['generalCriteria'];
  /** Kết quả tự chấm từng mục, gợi ý khi thẩm định và để so khi chấm khác. */
  selfGeneral: GeneralMark[] | null;
  previous: EvaluationDetail['previous'];
  /** Mục bắt buộc Không đảm bảo do kỷ luật, kết luận trong kỳ (ADR-055). */
  forcedItems: EvaluationDetail['forcedItems'];
  /** Kỳ năm: điều kiện "Không hoàn thành nhiệm vụ"; có thì người phê duyệt được chọn ngoại lệ. */
  yearConditions: EvaluationDetail['yearConditions'];
  /** Công việc trong danh mục của kỳ, để chọn khi giao chỉ tiêu. */
  catalogItems: PickerItem[];
  catalogGroups: PickerGroup[];
  catalogTasks: PickerTask[];
}

const LEADERSHIP_OPTIONS = [
  { value: 1, label: 'Đạt 100%' },
  { value: 0.5, label: 'Đạt 50%' },
];

const blank = (s?: string) => (s?.trim() ? s.trim() : undefined);

const GENERAL_RULES = [{ required: true, message: 'Nhập điểm' }];

/** Ba tiêu chí của người lao động hỗ trợ, phục vụ (Sổ tay Bộ Nội vụ Chương III); tên trường có tiền tố `sup-`. */
const SUPPORT_FIELDS: { key: keyof SupportScores; label: string; extra: string }[] = [
  { key: 'quality', label: 'a. Chất lượng công việc (%)', extra: 'Ví dụ lái xe: đưa đón, vận chuyển đúng địa điểm, đúng giờ; phục vụ: khu vực được giao sạch sẽ, phục vụ hội nghị đầy đủ.' },
  { key: 'compliance', label: 'b. Tuân thủ quy định, quy trình (%)', extra: 'An toàn giao thông, an toàn lao động, phòng cháy; bảo vệ bí mật nhà nước khi vận chuyển, sao chụp tài liệu.' },
  { key: 'efficiency', label: 'c. Hiệu quả công việc (%)', extra: 'Bảo dưỡng phương tiện, thiết bị đúng định kỳ; dùng vật tư, nhiên liệu tiết kiệm.' },
];

function SupportCriteria({ title }: { title: string }) {
  return (
    <Card size="small" type="inner" title={title} style={{ marginBottom: 16 }}>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Điểm đánh giá = (a + b + c) / 3; điểm kết quả = điểm đánh giá × 70. Mỗi tiêu chí tối đa 100%.
      </Typography.Paragraph>
      {SUPPORT_FIELDS.map((f) => (
        <Form.Item key={f.key} name={`sup-${f.key}`} label={f.label} extra={f.extra} rules={[{ required: true, message: 'Nhập tỷ lệ' }]}>
          <InputNumber min={0} max={100} step={5} addonAfter="%" />
        </Form.Item>
      ))}
    </Card>
  );
}

type Values = Record<string, unknown>;

const supportOf = (v: Values): SupportScores => ({
  quality: Number(v['sup-quality']),
  compliance: Number(v['sup-compliance']),
  efficiency: Number(v['sup-efficiency']),
});

export default function EvaluationActions({
  evaluationId,
  status,
  periodOpen,
  permissions,
  tasks,
  selfGeneralScore,
  isLeader,
  isSupport,
  selfSupport,
  isYear,
  yearEnough,
  suggestedUnitResult,
  suggestedSolidarity,
  generalCriteria,
  selfGeneral,
  previous,
  forcedItems,
  yearConditions,
  catalogItems,
  catalogGroups,
  catalogTasks,
}: Props) {
  const { run, busy } = useAction();
  const can = (p: string) => permissions.includes(p);
  const [returning, setReturning] = useState(false);
  const [approving, setApproving] = useState(false);
  const [assignForm] = Form.useForm<{ code: string; planned: number }>();
  const [selfForm] = Form.useForm<Values>();
  const [reviewForm] = Form.useForm<Values>();
  const criteria = isYear ? null : generalCriteria;
  const byItem = criteria !== null;
  const [returnForm] = Form.useForm<{ reason: string }>();
  const [approveForm] = Form.useForm<{ comment?: string; exception?: string; exceptionNote?: string }>();
  const exceptionChosen = Form.useWatch('exception', approveForm);

  const planned = status === 'PLANNED';
  const canAssign = periodOpen && planned && can('evaluation:assign') && !isYear;
  const canSelf = periodOpen && planned && can('evaluation:self');
  const canReview = periodOpen && status === 'SELF_SUBMITTED' && can('evaluation:review');
  const canApprove = periodOpen && status === 'REVIEWED' && can('evaluation:approve');

  const canNotRated = periodOpen && isYear && !yearEnough && (planned || status === 'SELF_SUBMITTED') && can('evaluation:review');

  if (!canAssign && !canSelf && !canReview && !canApprove && !canNotRated) return null;

  const saveResults = async (v: Values) => {
    for (const t of tasks.filter((x) => x.sourceAssignmentIds.length === 0)) {
      await apiCall('PATCH', `/evaluation/tasks/${t.id}/result`, { completedQuantity: Number(v[`done-${t.id}`] ?? 0), evidence: blank(v[`ev-${t.id}`] as string | undefined) });
    }
  };

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {canNotRated && (
        <Card size="small" title="Không xếp loại (chưa đủ thời gian công tác)">
          <Typography.Paragraph type="secondary">
            Công chức có thời gian công tác trong năm chưa đủ 6 tháng thì không xếp loại (Nghị định 335 Điều 11.1). Tháng nghỉ có căn cứ do Văn phòng ghi nhận được tính vào thời gian. Hồ sơ đóng lại, không có điểm và xếp loại.
          </Typography.Paragraph>
          <Popconfirm
            title="Đóng hồ sơ năm là không xếp loại?"
            description="Hồ sơ sẽ khóa và không sửa được."
            okText="Đóng hồ sơ"
            okButtonProps={{ danger: true }}
            cancelText="Hủy"
            onConfirm={() => run(async () => void (await apiCall('POST', `/evaluation/evaluations/${evaluationId}/not-rated`, {})), { success: 'Đã đóng hồ sơ là không xếp loại' })}
          >
            <Button danger loading={busy}>
              Không xếp loại
            </Button>
          </Popconfirm>
        </Card>
      )}

      {canAssign && (
        <Card size="small" title="Giao chỉ tiêu">
          <Form
            form={assignForm}
            layout="inline"
            onFinish={(v) =>
              run(
                async () => {
                  await apiCall('POST', `/evaluation/evaluations/${evaluationId}/tasks`, { catalogItemCode: v.code, plannedQuantity: v.planned });
                  assignForm.resetFields();
                },
                { success: 'Đã thêm chỉ tiêu' },
              )
            }
          >
            <Form.Item name="code" rules={[{ required: true, message: 'Chọn nhiệm vụ' }]}>
              <CatalogItemPicker items={catalogItems} groups={catalogGroups} tasks={catalogTasks} exclude={tasks.map((t) => t.catalogItemCode)} />
            </Form.Item>
            <Form.Item name="planned" rules={[{ required: true, message: 'Nhập số lượng' }]}>
              <InputNumber min={1} precision={0} placeholder="Số lượng giao" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>
              Thêm
            </Button>
          </Form>
          {tasks.length > 0 && (
            <Space wrap style={{ marginTop: 12 }}>
              <Typography.Text type="secondary">Gỡ chỉ tiêu:</Typography.Text>
              {tasks.filter((t) => t.sourceAssignmentIds.length === 0).map((t) => (
                <Popconfirm
                  key={t.id}
                  title={`Gỡ chỉ tiêu ${t.catalogItemCode}?`}
                  okText="Gỡ"
                  okButtonProps={{ danger: true }}
                  cancelText="Hủy"
                  onConfirm={() => run(async () => void (await apiCall('DELETE', `/evaluation/tasks/${t.id}`)), { success: 'Đã gỡ chỉ tiêu' })}
                >
                  <Button size="small" danger>
                    {t.catalogItemCode}
                  </Button>
                </Popconfirm>
              ))}
            </Space>
          )}
        </Card>
      )}

      {canSelf && (
        <Card size="small" title="Cán bộ tự đánh giá">
          <Form
            form={selfForm}
            layout="vertical"
            initialValues={{
              ...Object.fromEntries(tasks.flatMap((t) => [[`done-${t.id}`, t.completedQuantity], [`ev-${t.id}`, t.evidence ?? '']])),
              ...(byItem ? generalInitial(criteria!, selfGeneral, forcedItems) : {}),
            }}
          >
            {isYear && <Typography.Paragraph type="secondary">Điểm năm là trung bình cộng điểm các tháng đã phê duyệt, nên bạn không tự chấm điểm ở kỳ năm. Chỉ cần nộp hồ sơ để cấp trên thẩm định.</Typography.Paragraph>}
            {!isYear && !isSupport && tasks.length === 0 && <Typography.Paragraph type="secondary">Chưa có chỉ tiêu nào được giao.</Typography.Paragraph>}
            {!isYear && isSupport && <SupportCriteria title="Tự đánh giá ba tiêu chí (người lao động hỗ trợ, phục vụ)" />}
            {(isYear || isSupport ? [] : tasks).map((t) =>
              t.sourceAssignmentIds.length > 0 ? (
                <Typography.Paragraph key={t.id}>
                  <Typography.Text strong>{t.catalogItemCode}</Typography.Text>: đã hoàn thành {t.completedQuantity}/{t.plannedQuantity} (lấy từ việc được giao, cấp trên đã xác nhận, không sửa ở đây).
                </Typography.Paragraph>
              ) : (
              <Space key={t.id} align="start" wrap>
                <Typography.Text strong style={{ lineHeight: '32px', width: 60, display: 'inline-block' }}>
                  {t.catalogItemCode}
                </Typography.Text>
                <Form.Item name={`done-${t.id}`} label={`Hoàn thành (giao ${t.plannedQuantity})`}>
                  <InputNumber min={0} precision={0} />
                </Form.Item>
                <Form.Item name={`ev-${t.id}`} label="Minh chứng">
                  <Input maxLength={2000} style={{ width: 360 }} />
                </Form.Item>
              </Space>
              ),
            )}
            {byItem && <GeneralCriteriaFields form={selfForm} criteria={criteria!} previous={previous} forced={forcedItems} />}
            <Space align="start" wrap>
              {!isYear && !byItem && (
                <Form.Item name="general" label="Điểm tiêu chí chung (0–30)" rules={GENERAL_RULES}>
                  <InputNumber min={0} max={30} step={0.5} />
                </Form.Item>
              )}
              <Form.Item name="comment" label="Nhận xét">
                <Input maxLength={2000} style={{ width: 360 }} />
              </Form.Item>
            </Space>
            <Space>
              {!isYear && !isSupport && (
                <Button loading={busy} onClick={() => run(async () => saveResults(selfForm.getFieldsValue()), { success: 'Đã lưu kết quả' })}>
                  Lưu kết quả
                </Button>
              )}
              <Button
                type="primary"
                loading={busy}
                onClick={async () => {
                  const v = await selfForm.validateFields().catch(() => null);
                  if (!v) return;
                  await run(
                    async () => {
                      if (!isYear && !isSupport) await saveResults(v);
                      await apiCall('POST', `/evaluation/evaluations/${evaluationId}/self-submit`, {
                        ...(isYear ? {} : byItem ? { general: generalMarks(criteria!, v) } : { generalScore: Number(v.general) }),
                        ...(isSupport && !isYear ? { support: supportOf(v) } : {}),
                        comment: blank(v.comment as string | undefined),
                      });
                    },
                    { success: 'Đã gửi thẩm định' },
                  );
                }}
              >
                Lưu và gửi thẩm định
              </Button>
            </Space>
          </Form>
        </Card>
      )}

      {canReview && (
        <Card size="small" title="Thẩm định">
          <Form
            form={reviewForm}
            layout="vertical"
            initialValues={{
              general: selfGeneralScore ?? undefined,
              ...(byItem ? generalInitial(criteria!, selfGeneral, forcedItems) : {}),
              ...(isSupport && selfSupport ? { 'sup-quality': selfSupport.quality, 'sup-compliance': selfSupport.compliance, 'sup-efficiency': selfSupport.efficiency } : {}),
              ...(isLeader && suggestedUnitResult !== null ? { 'lead-unit': suggestedUnitResult } : {}),
              ...(isLeader && suggestedSolidarity ? { 'lead-sol': suggestedSolidarity.value } : {}),
              ...Object.fromEntries(tasks.flatMap((t) => [[`c-${t.id}`, t.completedQuantity], [`q-${t.id}`, t.qualityLevel ?? undefined]])),
            }}
            onFinish={(v) =>
              run(
                async () => {
                  await apiCall('POST', `/evaluation/evaluations/${evaluationId}/review`, {
                    comment: blank(v.comment as string | undefined),
                    ...(isYear
                      ? {}
                      : {
                          ...(byItem ? { general: generalMarks(criteria!, v) } : { generalScore: Number(v.general) }),
                          ...(isLeader ? { leadership: { unitResult: v['lead-unit'], organizing: v['lead-org'], solidarity: v['lead-sol'] } } : {}),
                          ...(isSupport
                            ? { support: supportOf(v) }
                            : { tasks: tasks.map((t) => ({ taskId: t.id, qualityLevel: v[`q-${t.id}`] as number | undefined, completedQuantity: v[`c-${t.id}`] as number | undefined })) }),
                        }),
                  });
                },
                { success: 'Đã chốt thẩm định' },
              )
            }
          >
            {isYear && <Typography.Paragraph type="secondary">Điểm năm lấy trung bình cộng các tháng đã phê duyệt (xem bảng ở trên), bạn không nhập điểm. Nếu có tháng thiếu thuộc nghỉ ốm, thai sản thì ghi vào nhận xét.</Typography.Paragraph>}
            {!isYear && isSupport && <SupportCriteria title="Người quản lý đánh giá ba tiêu chí (gợi ý sẵn theo điểm tự đánh giá)" />}
            {(isYear || isSupport ? [] : tasks).map((t) => (
              <Space key={t.id} align="start" wrap>
                <Typography.Text strong style={{ lineHeight: '32px', width: 60, display: 'inline-block' }}>
                  {t.catalogItemCode}
                </Typography.Text>
                <Form.Item name={`c-${t.id}`} label="Hoàn thành">
                  <InputNumber min={0} precision={0} />
                </Form.Item>
                <Form.Item name={`q-${t.id}`} label="Chất lượng" rules={[{ required: true, message: 'Chọn mức' }]}>
                  <Select placeholder="Chọn mức" style={{ width: 240 }} options={[1, 2, 3].map((q) => ({ value: q, label: QUALITY_LABELS[q] }))} />
                </Form.Item>
              </Space>
            ))}
            {isLeader && !isYear && (
              <Card size="small" type="inner" title="Tiêu chí D: lãnh đạo, chỉ đạo, điều hành (cán bộ lãnh đạo, quản lý)" style={{ marginBottom: 16 }}>
                <Form.Item
                  name="lead-unit"
                  label="Kết quả hoạt động của đơn vị"
                  extra={
                    suggestedUnitResult === null
                      ? '100% nếu mọi công chức thuộc quyền từ hoàn thành nhiệm vụ trở lên; 50% nếu có người không hoàn thành. Chưa có xếp loại cấp dưới trong kỳ này để gợi ý.'
                      : `Gợi ý từ xếp loại cấp dưới trong kỳ: ${suggestedUnitResult === 1 ? '100%' : '50%'}. 100% nếu mọi công chức thuộc quyền từ hoàn thành nhiệm vụ trở lên; 50% nếu có người không hoàn thành.`
                  }
                  rules={[{ required: true, message: 'Chọn mức' }]}
                >
                  <Select placeholder="Chọn mức" style={{ width: 200 }} options={LEADERSHIP_OPTIONS} />
                </Form.Item>
                <Form.Item
                  name="lead-org"
                  label="Khả năng tổ chức triển khai nhiệm vụ"
                  extra="100% nếu hoàn thành đầy đủ nhiệm vụ đúng hạn, bảo đảm chất lượng, có sáng kiến hoặc giải pháp hiệu quả; 50% nếu có tồn tại, hạn chế, chậm trễ kéo dài."
                  rules={[{ required: true, message: 'Chọn mức' }]}
                >
                  <Select placeholder="Chọn mức" style={{ width: 200 }} options={LEADERSHIP_OPTIONS} />
                </Form.Item>
                <Form.Item
                  name="lead-sol"
                  label="Năng lực tập hợp, đoàn kết công chức"
                  extra={`100% nếu duy trì môi trường làm việc đoàn kết, phối hợp hiệu quả; 50% nếu phát sinh phản ánh, khiếu nại, mâu thuẫn mất đoàn kết kéo dài.${suggestedSolidarity ? ` Gợi ý: ${suggestedSolidarity.reason}` : ''}`}
                  rules={[{ required: true, message: 'Chọn mức' }]}
                  style={{ marginBottom: 0 }}
                >
                  <Select placeholder="Chọn mức" style={{ width: 200 }} options={LEADERSHIP_OPTIONS} />
                </Form.Item>
              </Card>
            )}
            {byItem && <GeneralCriteriaFields form={reviewForm} criteria={criteria!} selfMarks={selfGeneral} previous={previous} forced={forcedItems} />}
            <Space align="start" wrap>
              {!isYear && !byItem && (
                <Form.Item name="general" label="Điểm tiêu chí chung (0–30)" rules={GENERAL_RULES}>
                  <InputNumber min={0} max={30} step={0.5} />
                </Form.Item>
              )}
              <Form.Item name="comment" label="Nhận xét">
                <Input maxLength={2000} style={{ width: 360 }} />
              </Form.Item>
            </Space>
            <Space>
              <Button type="primary" htmlType="submit" loading={busy}>
                Chốt thẩm định
              </Button>
              <Button danger onClick={() => setReturning(true)}>
                Trả lại để chỉnh sửa
              </Button>
            </Space>
          </Form>
          <Modal
            title="Trả lại hồ sơ"
            open={returning}
            onCancel={() => setReturning(false)}
            onOk={() => returnForm.submit()}
            okText="Trả lại"
            cancelText="Hủy"
            confirmLoading={busy}
            destroyOnHidden
          >
            <Form
              form={returnForm}
              layout="vertical"
              onFinish={async (v) => {
                const ok = await run(async () => void (await apiCall('POST', `/evaluation/evaluations/${evaluationId}/return`, { reason: v.reason.trim() })), { success: 'Đã trả lại hồ sơ' });
                if (ok) setReturning(false);
              }}
            >
              <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, message: 'Nhập lý do' }]}>
                <Input.TextArea rows={3} maxLength={2000} />
              </Form.Item>
            </Form>
          </Modal>
        </Card>
      )}

      {canApprove && (
        <Card size="small" title="Phê duyệt">
          <Typography.Paragraph>Sau khi phê duyệt, hồ sơ bị khóa và không sửa được.</Typography.Paragraph>
          <Button type="primary" onClick={() => setApproving(true)}>
            Phê duyệt
          </Button>
          <Modal
            title="Phê duyệt hồ sơ"
            open={approving}
            onCancel={() => setApproving(false)}
            onOk={() => approveForm.submit()}
            okText="Phê duyệt"
            cancelText="Hủy"
            confirmLoading={busy}
            destroyOnHidden
          >
            <Form
              form={approveForm}
              layout="vertical"
              onFinish={async (v) => {
                const exception = v.exception ? { code: v.exception, note: (v.exceptionNote ?? '').trim() } : undefined;
                const ok = await run(async () => void (await apiCall('POST', `/evaluation/evaluations/${evaluationId}/approve`, { comment: blank(v.comment), exception })), { success: 'Đã phê duyệt' });
                if (ok) setApproving(false);
              }}
            >
              {yearConditions.length > 0 && (
                <>
                  <Typography.Paragraph>
                    Hồ sơ có điều kiện xếp loại <b>Không hoàn thành nhiệm vụ</b> (39-QĐ/TU Điều 11 mục 4):
                  </Typography.Paragraph>
                  <ul style={{ marginTop: 0 }}>
                    {yearConditions.map((c) => (
                      <li key={c.code}>
                        {c.text} ({c.basis})
                      </li>
                    ))}
                  </ul>
                  <Form.Item name="exception" label="Ngoại lệ (chỉ chọn khi văn bản cho phép; để trống thì giữ Không hoàn thành nhiệm vụ)">
                    <Select allowClear placeholder="Không áp dụng ngoại lệ" options={Object.entries(EXCEPTION_LABELS).map(([value, label]) => ({ value, label }))} />
                  </Form.Item>
                  {exceptionChosen && (
                    <Form.Item name="exceptionNote" label="Căn cứ của ngoại lệ" rules={[{ required: true, whitespace: true, message: 'Ghi căn cứ: hoàn cảnh, tính chất, mức độ vi phạm, kết quả khắc phục' }]}>
                      <Input.TextArea rows={3} maxLength={2000} />
                    </Form.Item>
                  )}
                </>
              )}
              <Form.Item name="comment" label="Ý kiến (tùy chọn)">
                <Input.TextArea rows={3} maxLength={2000} />
              </Form.Item>
            </Form>
          </Modal>
        </Card>
      )}
    </Space>
  );
}
