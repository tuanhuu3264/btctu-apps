'use client';

import { Card, Table, Tag, Typography } from 'antd';
import type { ExcellentQuota, QuotaRanked } from '@/lib/api';

interface Props {
  quota: ExcellentQuota & { mine: QuotaRanked | null };
  names: Record<string, string>;
}

/** Hạn mức xuất sắc của nhóm khi hồ sơ này ở mức xuất sắc (ADR-060): chỉ gợi ý, người phê duyệt quyết định. */
export default function ExcellentQuotaCard({ quota, names }: Props) {
  return (
    <Card size="small" title="Hạn mức xuất sắc của nhóm" style={{ marginTop: 16 }}>
      <Typography.Paragraph>
        Nhóm {quota.groupSize} người: {quota.excellent} đề xuất xuất sắc, {quota.good} hoàn thành tốt. Tối đa <b>{quota.allowed}</b> người xuất sắc (20% số hoàn thành tốt), tới {quota.allowedExceptional} người nếu cấp có thẩm quyền áp dụng 25% cho đơn vị nổi trội
        {quota.smallGroup ? '; nhóm từ 5 người trở xuống được chọn 1 người' : ''}. Khi vượt hạn mức, lấy từ điểm cao xuống thấp; bằng điểm ở ranh giới thì cấp có thẩm quyền xem xét tổng thể. Hệ thống chỉ gợi ý, không tự hạ bậc.
      </Typography.Paragraph>
      <Table<QuotaRanked>
        rowKey="evaluationId"
        size="small"
        pagination={false}
        dataSource={quota.ranking}
        rowClassName={(r) => (r.evaluationId === quota.mine?.evaluationId ? 'ant-table-row-selected' : '')}
        columns={[
          { title: 'Hạng', dataIndex: 'rank', width: 70 },
          { title: 'Cán bộ', render: (_: unknown, r) => names[r.personId] ?? r.personId },
          { title: 'Tổng điểm', dataIndex: 'score', align: 'right', width: 110 },
          {
            title: 'Theo hạn mức',
            width: 200,
            render: (_: unknown, r) => (r.within ? <Tag color="green">Trong hạn mức</Tag> : r.tie ? <Tag color="orange">Bằng điểm ranh giới</Tag> : <Tag color="red">Ngoài hạn mức</Tag>),
          },
        ]}
      />
    </Card>
  );
}
