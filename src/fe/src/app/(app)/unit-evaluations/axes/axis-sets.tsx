'use client';

import { Alert, Button, Card, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import type { AxisSet } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';
import AxesEditor from './axes-editor';

const DEFAULT_KEY = 'default';

/**
 * Chọn bộ trục để xem, sửa (ADR-052): bộ mặc định dùng cho Ban và phòng chưa có bộ riêng; mỗi phòng có thể có bộ riêng.
 * Sửa bộ của một phòng đang dùng bộ mặc định thì lưu thành bộ riêng của phòng đó; bỏ bộ riêng thì phòng dùng lại bộ mặc định.
 */
export default function AxisSets({ sets, selected, canEdit }: { sets: AxisSet[]; selected: string | null; canEdit: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { run, busy } = useAction();
  const current = sets.find((s) => s.unitId === selected) ?? sets[0];
  const key = current.unitId ?? DEFAULT_KEY;
  const label = (s: AxisSet) => (s.unitId === null ? 'Bộ mặc định (Ban và phòng chưa có bộ riêng)' : `${s.unitName} (${s.unitCode})`);

  const choose = (value: string) => router.replace(value === DEFAULT_KEY ? pathname : `${pathname}?unit=${value}`);

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap align="center">
          <Typography.Text strong>Bộ trục</Typography.Text>
          <Select
            style={{ minWidth: 360, maxWidth: '100%' }}
            value={key}
            onChange={choose}
            aria-label="Chọn bộ trục"
            options={sets.map((s) => ({
              value: s.unitId ?? DEFAULT_KEY,
              label: (
                <Space size={6}>
                  {label(s)}
                  {s.unitId !== null && (s.own ? <Tag color="blue">Bộ riêng</Tag> : <Tag>Dùng bộ mặc định</Tag>)}
                </Space>
              ),
            }))}
          />
          {canEdit && current.unitId !== null && current.own && (
            <Popconfirm
              title="Bỏ bộ trục riêng?"
              description="Phòng sẽ chấm theo bộ mặc định. Hồ sơ đã chấm vẫn giữ bộ trục lúc chấm."
              okText="Bỏ bộ riêng"
              cancelText="Không"
              onConfirm={() => run(async () => void (await apiCall('DELETE', `/unit-evaluation/axes/${current.unitId}`)), { success: 'Đã bỏ bộ trục riêng' })}
            >
              <Button loading={busy}>Bỏ bộ riêng, dùng bộ mặc định</Button>
            </Popconfirm>
          )}
        </Space>
        {current.unitId !== null && !current.own && (
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message={`${current.unitName} đang dùng bộ mặc định`}
            description={canEdit ? 'Sửa các trục dưới đây rồi bấm Lưu cấu hình để tạo bộ riêng cho phòng này; bộ mặc định không bị đổi.' : undefined}
          />
        )}
      </Card>
      <AxesEditor key={`${key}-${current.own}`} initial={current.axes} canEdit={canEdit} unitId={current.unitId} createsOwn={current.unitId !== null && !current.own} />
    </Space>
  );
}
