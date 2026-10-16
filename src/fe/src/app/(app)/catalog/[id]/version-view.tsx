'use client';

import { ApartmentOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Collapse, Descriptions, Popconfirm, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import type { CatalogItem, CatalogTask, CatalogVersionView, OrgUnit } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { DURATION_LABELS, dateText, num, UNIT_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-action';
import GroupEditor from './group-editor';
import ItemEditor from './item-editor';
import ScopeEditor from './scope-editor';
import TaskEditor from './task-editor';
import VersionActions from './version-actions';

interface Props {
  view: CatalogVersionView;
  /** Sơ đồ tổ chức để gán phạm vi áp dụng; rỗng nếu tài khoản không xem được. */
  org: OrgUnit[];
  canManage: boolean;
  canApprove: boolean;
}

const durationText = (i: CatalogItem) =>
  i.durationMode === 'LIMITED' && i.durationValue !== null ? `${i.durationValue} ${i.durationUnit ? UNIT_LABELS[i.durationUnit] : ''}` : DURATION_LABELS[i.durationMode];

export default function VersionView({ view, org, canManage, canApprove }: Props) {
  const { version, groups, tasks, baseline, items, warnings } = view;
  const isDraft = version.status === 'DRAFT';
  const editable = isDraft && canManage;
  const { run, busy } = useAction();
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [editingTask, setEditingTask] = useState<CatalogTask | null>(null);
  const [editingGroup, setEditingGroup] = useState<{ code: string; name: string } | null>(null);
  /** Nhiệm vụ đang thêm công việc vào (mở từ tiêu đề nhiệm vụ). */
  const [addingTo, setAddingTo] = useState<CatalogTask | null>(null);
  /** Gán phạm vi áp dụng: cho một công việc hoặc cho cả nhiệm vụ. */
  const [scopeItem, setScopeItem] = useState<CatalogItem | null>(null);
  const [scopeTask, setScopeTask] = useState<CatalogTask | null>(null);
  const unitName = useMemo(() => new Map(org.map((u) => [u.id, u.name])), [org]);
  const positionTitle = useMemo(() => new Map(org.flatMap((u) => u.positions.map((p) => [p.id, p.title] as const))), [org]);
  const baselineOptions = useMemo(() => items.map((i) => ({ code: i.code, scored: i.points !== null && i.points > 0 })), [items]);
  const noBaseline = baseline === null;

  const columns = [
    { title: 'Mã', dataIndex: 'code', width: 80 },
    {
      title: 'Công việc',
      dataIndex: 'name',
      render: (name: string, i: CatalogItem) =>
        i.status === 'INACTIVE' ? (
          <span style={{ color: '#999' }}>
            {name} <Tag title={i.inactiveReason ?? undefined}>Ngừng sử dụng</Tag>
          </span>
        ) : (
          name
        ),
    },
    { title: 'Sản phẩm', dataIndex: 'productUnits', render: (v: string | null) => v ?? '–' },
    { title: 'Mức', dataIndex: 'complexity', width: 60, align: 'center' as const },
    { title: 'Thời gian', render: (_: unknown, i: CatalogItem) => durationText(i) },
    { title: 'Điểm', dataIndex: 'points', align: 'right' as const, render: (p: number | null) => p ?? <Tag color="red">chưa có</Tag> },
    {
      title: (
        <Tooltip title="Hệ số quy đổi = điểm của công việc / điểm của công việc chuẩn">
          <span>Hệ số</span>
        </Tooltip>
      ),
      dataIndex: 'coefficient',
      align: 'right' as const,
      render: (c: number | null, i: CatalogItem) =>
        c !== null ? num(c) : noBaseline ? <Tag color="orange">chưa có chuẩn</Tag> : i.points === null ? <Tag>chưa có điểm</Tag> : '–',
    },
    {
      title: (
        <Tooltip title="Đơn vị, vị trí được giao công việc này. Chưa gán thì là việc chung, giao được cho mọi cán bộ.">
          <span>Phạm vi</span>
        </Tooltip>
      ),
      width: 190,
      render: (_: unknown, i: CatalogItem) =>
        i.unitIds.length + i.positionIds.length === 0 ? (
          <Tag>Chung</Tag>
        ) : (
          <Space size={[0, 4]} wrap>
            {i.unitIds.map((id) => (
              <Tag key={id} color="blue">
                {unitName.get(id) ?? 'Đơn vị'}
              </Tag>
            ))}
            {i.positionIds.map((id) => (
              <Tag key={id} color="purple">
                {positionTitle.get(id) ?? 'Vị trí'}
              </Tag>
            ))}
          </Space>
        ),
    },
    ...(editable
      ? [
          {
            title: '',
            width: 150,
            render: (_: unknown, i: CatalogItem) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => setEditingItem(i)} aria-label={`Sửa ${i.code}`} />
                {org.length > 0 && <Button size="small" icon={<ApartmentOutlined />} onClick={() => setScopeItem(i)} aria-label={`Phạm vi ${i.code}`} />}
                {i.status === 'INACTIVE' ? (
                  <Button
                    size="small"
                    loading={busy}
                    onClick={() => run(async () => void (await apiCall('POST', `/catalog/items/${i.id}/reactivate`)), { success: 'Đã kích hoạt lại công việc' })}
                  >
                    Kích hoạt lại
                  </Button>
                ) : (
                  <Popconfirm
                    title={`Ngừng sử dụng công việc ${i.code}?`}
                    description="Công việc chuyển sang ngừng sử dụng (không xóa dữ liệu); mã được giữ, không giao mới được."
                    okText="Ngừng sử dụng"
                    okButtonProps={{ danger: true }}
                    cancelText="Hủy"
                    onConfirm={() => run(async () => void (await apiCall('DELETE', `/catalog/items/${i.id}`)), { success: 'Đã ngừng sử dụng công việc' })}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} loading={busy} aria-label={`Ngừng ${i.code}`} />
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]
      : []),
  ];

  /** Các nhiệm vụ của một nhóm, mỗi nhiệm vụ một khung có thể mở ra xem công việc. */
  const groupContent = (groupCode: string) => {
    const groupTasks = tasks.filter((t) => t.groupCode === groupCode);
    if (groupTasks.length === 0) {
      return <Typography.Paragraph type="secondary">Nhóm này chưa có nhiệm vụ nào{editable ? ': bấm "Thêm nhiệm vụ" ở trên.' : '.'}</Typography.Paragraph>;
    }
    return (
      <Collapse
        defaultActiveKey={groupTasks.map((t) => t.id)}
        items={groupTasks.map((t) => ({
          key: t.id,
          label: (
            <span>
              <strong>{t.name}</strong> <Tag>{t.itemCount} công việc</Tag>
              {t.status === 'INACTIVE' && <Tag title={t.inactiveReason ?? undefined}>Ngừng sử dụng</Tag>}
              {t.description && <span style={{ color: '#888' }}> {t.description}</span>}
            </span>
          ),
          extra: editable ? (
            <Space onClick={(e) => e.stopPropagation()}>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setAddingTo(t)}>
                Thêm công việc
              </Button>
              <Button size="small" icon={<EditOutlined />} onClick={() => setEditingTask(t)} aria-label={`Sửa nhiệm vụ ${t.name}`} />
              {org.length > 0 && t.itemCount > 0 && (
                <Button size="small" icon={<ApartmentOutlined />} onClick={() => setScopeTask(t)}>
                  Phạm vi
                </Button>
              )}
              {t.status === 'INACTIVE' ? (
                <Button
                  size="small"
                  loading={busy}
                  onClick={() => run(async () => void (await apiCall('POST', `/catalog/tasks/${t.id}/reactivate`)), { success: 'Đã kích hoạt lại nhiệm vụ' })}
                >
                  Kích hoạt lại
                </Button>
              ) : (
                <Tooltip title={t.itemCount > 0 ? 'Nhiệm vụ còn công việc đang hoạt động nên chưa ngừng được' : ''}>
                  <span>
                    <Popconfirm
                      title={`Ngừng sử dụng nhiệm vụ "${t.name}"?`}
                      description="Nhiệm vụ chuyển sang ngừng sử dụng (không xóa dữ liệu)."
                      okText="Ngừng sử dụng"
                      okButtonProps={{ danger: true }}
                      cancelText="Hủy"
                      disabled={t.itemCount > 0}
                      onConfirm={() => run(async () => void (await apiCall('DELETE', `/catalog/tasks/${t.id}`)), { success: 'Đã ngừng sử dụng nhiệm vụ' })}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} disabled={t.itemCount > 0} loading={busy} aria-label={`Ngừng nhiệm vụ ${t.name}`} />
                    </Popconfirm>
                  </span>
                </Tooltip>
              )}
            </Space>
          ) : null,
          children: <Table rowKey="id" size="small" pagination={false} dataSource={items.filter((i) => i.taskId === t.id)} columns={columns} scroll={{ x: 1000 }} locale={{ emptyText: 'Nhiệm vụ chưa có công việc nào' }} />,
        }))}
      />
    );
  };

  return (
    <>
      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, md: 2 }}
        style={{ marginBottom: 16, background: '#fff' }}
        items={[
          { key: 'l', label: 'Nhãn phiên bản', children: version.label },
          { key: 's', label: 'Trạng thái', children: isDraft ? <Tag color="gold">Bản nháp</Tag> : <Tag color="green">Đã phê duyệt</Tag> },
          { key: 'b', label: 'Công việc chuẩn', children: baseline ? `${baseline.code} (${baseline.points} điểm)` : 'Chưa đặt' },
          { key: 'e', label: 'Hiệu lực từ', children: dateText(version.effectiveFrom) },
          { key: 'n', label: 'Nguồn', children: version.sourceNote ?? '–' },
        ]}
      />

      {noBaseline && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Chưa có hệ số quy đổi vì chưa chọn công việc chuẩn"
          description={
            <>
              Hệ số của một công việc = điểm của công việc đó / điểm của <strong>công việc chuẩn</strong>. Hãy nhập <strong>điểm chấm</strong> cho các công việc, rồi
              {editable ? ' chọn công việc chuẩn ở ô "Chọn công việc chuẩn" phía trên (công việc chuẩn phải có điểm lớn hơn 0).' : ' nhờ người soạn danh mục chọn công việc chuẩn.'}
            </>
          }
        />
      )}

      {warnings.length > 0 && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="Cần rà soát" description={<ul style={{ margin: 0, paddingLeft: 20 }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>} />
      )}

      {isDraft && (
        <VersionActions versionId={version.id} versionName={version.name} canManage={canManage} canApprove={canApprove} baselineOptions={baselineOptions} baselineCode={baseline?.code ?? null} groups={groups} tasks={tasks} />
      )}

      <Tabs
        type="card"
        items={groups.map((g) => {
          const rows = items.filter((i) => i.groupCode === g.code);
          return {
            key: g.code,
            label: `Nhóm ${g.code} (${rows.length})`,
            children: (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span>{g.name}</span>
                  {canManage && (
                    <Space size={4}>
                      <Button size="small" icon={<EditOutlined />} onClick={() => setEditingGroup(g)} aria-label={`Sửa tên nhóm ${g.code}`}>
                        Sửa tên nhóm
                      </Button>
                      <Tooltip title={tasks.some((t) => t.groupCode === g.code) || rows.length > 0 ? 'Nhóm còn nhiệm vụ hoặc công việc nên chưa xóa được' : ''}>
                        <span>
                          <Popconfirm
                            title={`Xóa nhóm ${g.code}?`}
                            description="Chỉ xóa được khi nhóm chưa có nhiệm vụ hay công việc nào ở bất kỳ phiên bản nào."
                            okText="Xóa"
                            okButtonProps={{ danger: true }}
                            cancelText="Hủy"
                            disabled={tasks.some((t) => t.groupCode === g.code) || rows.length > 0}
                            onConfirm={() => run(async () => void (await apiCall('DELETE', `/catalog/groups/${g.code}`)), { success: 'Đã xóa nhóm' })}
                          >
                            <Button size="small" danger icon={<DeleteOutlined />} disabled={tasks.some((t) => t.groupCode === g.code) || rows.length > 0} loading={busy} aria-label={`Xóa nhóm ${g.code}`} />
                          </Popconfirm>
                        </span>
                      </Tooltip>
                    </Space>
                  )}
                </div>
                {groupContent(g.code)}
              </>
            ),
          };
        })}
      />
      {editingItem && <ItemEditor versionId={version.id} tasks={tasks} groups={groups} item={editingItem} onClose={() => setEditingItem(null)} />}
      {addingTo && <ItemEditor versionId={version.id} tasks={tasks} groups={groups} presetTaskId={addingTo.id} onClose={() => setAddingTo(null)} />}
      {editingGroup && <GroupEditor groups={groups} group={editingGroup} onClose={() => setEditingGroup(null)} />}
      {scopeItem && (
        <ScopeEditor
          title={`Phạm vi áp dụng của ${scopeItem.code}: ${scopeItem.name}`}
          endpoint={`/catalog/items/${scopeItem.id}/scope`}
          initial={{ unitIds: scopeItem.unitIds, positionIds: scopeItem.positionIds }}
          org={org}
          onClose={() => setScopeItem(null)}
        />
      )}
      {scopeTask && (
        <ScopeEditor
          title={`Phạm vi áp dụng của nhiệm vụ: ${scopeTask.name}`}
          endpoint={`/catalog/tasks/${scopeTask.id}/scope`}
          initial={{ unitIds: [], positionIds: [] }}
          org={org}
          note={`Phạm vi này sẽ thay phạm vi hiện có của cả ${scopeTask.itemCount} công việc trong nhiệm vụ.`}
          onClose={() => setScopeTask(null)}
        />
      )}
      {editingTask && <TaskEditor versionId={version.id} groups={groups} task={editingTask} onClose={() => setEditingTask(null)} />}
    </>
  );
}
