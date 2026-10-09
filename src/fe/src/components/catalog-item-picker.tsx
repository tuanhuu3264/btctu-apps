'use client';

import { Descriptions, Select, Typography } from 'antd';
import { useMemo } from 'react';
import { DURATION_LABELS, num, UNIT_LABELS } from '@/lib/labels';

export interface PickerItem {
  code: string;
  groupCode: string;
  /** Nhiệm vụ của danh mục chứa công việc (ADR-019). */
  taskId?: string;
  name: string;
  productUnits: string | null;
  complexity: number;
  durationMode: 'LIMITED' | 'ACTUAL' | 'UNSPECIFIED';
  durationValue: number | null;
  durationUnit: 'HOUR' | 'DAY' | null;
  points: number | null;
  coefficient: number | null;
  unitIds?: string[];
  positionIds?: string[];
}

export interface PickerGroup {
  code: string;
  name: string;
}

export interface PickerTask {
  id: string;
  groupCode: string;
  name: string;
}

interface Props {
  /** Form.Item truyền vào để gắn nhãn với ô chọn. */
  id?: string;
  items: PickerItem[];
  groups: PickerGroup[];
  /** Nhiệm vụ của danh mục: có thì danh sách chia theo nhóm rồi theo nhiệm vụ. */
  tasks?: PickerTask[];
  value?: string;
  onChange?: (code: string) => void;
  /** Mã đã dùng, không đưa vào danh sách chọn. */
  exclude?: string[];
  placeholder?: string;
}

/** Bỏ dấu, viết thường để gõ "tham dinh" ra "thẩm định". */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

const durationText = (i: PickerItem) =>
  i.durationMode === 'LIMITED' && i.durationValue !== null ? `tối đa ${i.durationValue} ${i.durationUnit ? UNIT_LABELS[i.durationUnit] : ''}` : DURATION_LABELS[i.durationMode];

/** Dòng tóm tắt thông số của một nhiệm vụ: mức, thời gian, điểm, hệ số. */
const metaText = (i: PickerItem) =>
  `Mức ${i.complexity} · ${durationText(i)} · ${i.points === null ? 'chưa có điểm' : `${i.points} điểm`} · hệ số ${num(i.coefficient)}`;

/**
 * Ô chọn nhiệm vụ trong danh mục: chia theo nhóm A–D, mỗi lựa chọn hiện đầy đủ tên (không cắt) kèm thông số,
 * gõ mã hoặc tên (không cần dấu) để lọc; chọn xong hiện khung chi tiết. Dùng được trong Form.Item.
 */
export default function CatalogItemPicker({ id, items, groups, tasks = [], value, onChange, exclude = [], placeholder }: Props) {
  const available = useMemo(() => items.filter((i) => !exclude.includes(i.code)), [items, exclude]);
  const options = useMemo(() => {
    const leaf = (i: PickerItem) => ({ value: i.code, label: `${i.code} ${i.name}`, item: i });
    // Có nhiệm vụ: mỗi nhiệm vụ một nhóm lựa chọn, ghi rõ thuộc nhóm nào. Công việc chưa gắn nhiệm vụ rơi về nhóm.
    const byTask = tasks
      .filter((t) => groups.some((g) => g.code === t.groupCode))
      .sort((a, b) => a.groupCode.localeCompare(b.groupCode) || a.name.localeCompare(b.name, 'vi'))
      .map((t) => ({ label: `Nhóm ${t.groupCode} › ${t.name}`, options: available.filter((i) => i.taskId === t.id).map(leaf) }));
    const loose = groups.map((g) => ({
      label: `Nhóm ${g.code}: ${g.name}`,
      options: available.filter((i) => i.groupCode === g.code && !tasks.some((t) => t.id === i.taskId)).map(leaf),
    }));
    return [...byTask, ...loose].filter((g) => g.options.length > 0);
  }, [available, groups, tasks]);
  const selected = items.find((i) => i.code === value);

  return (
    <>
      <Select
        id={id}
        showSearch
        value={value}
        onChange={onChange}
        placeholder={placeholder ?? 'Chọn nhiệm vụ trong danh mục (gõ mã hoặc tên để lọc)'}
        style={{ width: '100%' }}
        options={options}
        listHeight={420}
        popupMatchSelectWidth={760}
        filterOption={(input, option) => fold(String(option?.label ?? '')).includes(fold(input))}
        optionRender={(option) => {
          const item = (option.data as { item?: PickerItem }).item;
          if (!item) return option.label;
          return (
            <div style={{ whiteSpace: 'normal', padding: '2px 0' }} title={`${item.code} ${item.name}`}>
              <div style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                <strong>{item.code}</strong> {item.name}
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {metaText(item)}
              </Typography.Text>
            </div>
          );
        }}
        notFoundContent="Không có nhiệm vụ nào khớp (nhiệm vụ đã có trong hồ sơ không hiện lại)"
      />
      {selected && (
        <Descriptions
          bordered
          size="small"
          column={2}
          style={{ marginTop: 12 }}
          items={[
            { key: 'n', label: 'Nhiệm vụ', span: 2, children: <div style={{ maxHeight: 120, overflowY: 'auto' }}><strong>{selected.code}</strong> {selected.name}</div> },
            { key: 'g', label: 'Nhóm', span: 2, children: `${selected.groupCode}: ${groups.find((g) => g.code === selected.groupCode)?.name ?? ''}` },
            ...(selected.taskId && tasks.some((t) => t.id === selected.taskId)
              ? [{ key: 'k', label: 'Nhiệm vụ trong danh mục', span: 2, children: tasks.find((t) => t.id === selected.taskId)!.name }]
              : []),
            { key: 'p', label: 'Sản phẩm', span: 2, children: selected.productUnits ?? '–' },
            { key: 'c', label: 'Mức phức tạp', children: selected.complexity },
            { key: 't', label: 'Thời gian', children: durationText(selected) },
            { key: 'd', label: 'Điểm chấm', children: selected.points ?? 'chưa có' },
            { key: 'h', label: 'Hệ số quy đổi', children: num(selected.coefficient) },
          ]}
        />
      )}
    </>
  );
}
