'use client';

import { LeftOutlined, PlusOutlined, QuestionCircleFilled, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { Alert, Button, Calendar, Modal, Radio, Segmented, Space, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MeetingRow } from '@/lib/api';
import { hhmmText, MEETING_RESPONSE_COLORS, MEETING_RESPONSE_LABELS, MEETING_STATUS_COLORS, MEETING_STATUS_LABELS, meetingRangeText, vnIso, vnWall } from '@/lib/labels';
import { useRemote } from '@/lib/use-remote';
import MeetingFormModal from './meeting-form-modal';
import RoomsModal from './rooms-modal';

type Mode = 'week' | 'month' | 'list';
type Option = { value: string; label: string };

interface Props {
  people: Option[];
  myPersonId: string;
  canReadAll: boolean;
  /** Quản lý danh mục phòng họp (Văn phòng). */
  canManageRooms: boolean;
}

const DAY_FMT = 'YYYY-MM-DD';
const WEEKDAYS = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
const STATUS_BORDER = { SCHEDULED: '#1677ff', HELD: '#52c41a', CANCELLED: '#bfbfbf' } as const;

/** Ngày (giờ Việt Nam) của một thời điểm ISO, dạng YYYY-MM-DD. */
const dayOf = (iso: string) => vnWall(iso).slice(0, 10);
const todayKey = () => dayOf(new Date().toISOString());
const mondayOf = (d: Dayjs) => d.subtract((d.day() + 6) % 7, 'day').startOf('day');
/** Mốc đầu ngày giờ Việt Nam thành chuỗi ISO UTC để gửi làm tham số truy vấn. */
const queryIso = (d: Dayjs) => encodeURIComponent(new Date(vnIso(d.format('YYYY-MM-DDTHH:mm:ss'))).toISOString());

/** Thẻ nhỏ của một cuộc họp trong lịch: giờ, tiêu đề, địa điểm; màu theo trạng thái; dấu hỏi nếu bạn chưa trả lời. */
export function MeetingChip({ row, showPlace = true }: { row: MeetingRow; showPlace?: boolean }) {
  const m = row.meeting;
  const cancelled = m.status === 'CANCELLED';
  return (
    <Link
      href={`/meetings/${m.id}`}
      onClick={(e) => e.stopPropagation()}
      title={`${m.title} (${MEETING_STATUS_LABELS[m.status]})`}
      style={{
        display: 'block',
        borderLeft: `3px solid ${STATUS_BORDER[m.status]}`,
        background: cancelled ? '#fafafa' : '#f7faff',
        borderRadius: 4,
        padding: '2px 6px',
        marginBottom: 4,
        fontSize: 12,
        lineHeight: 1.4,
        color: cancelled ? '#8c8c8c' : 'inherit',
        textDecoration: cancelled ? 'line-through' : undefined,
        overflow: 'hidden',
      }}
    >
      <strong>{hhmmText(m.startAt)}</strong> {row.myResponse === 'PENDING' && m.status === 'SCHEDULED' && <QuestionCircleFilled style={{ color: '#faad14' }} aria-label="Bạn chưa trả lời" />}{' '}
      <span style={{ wordBreak: 'break-word' }}>{m.title}</span>
      {showPlace && m.location && <div style={{ color: '#8c8c8c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.location}</div>}
    </Link>
  );
}

/** Lịch họp (ADR-051): ba cách xem là tuần, tháng và danh sách; tải theo khoảng đang xem. */
export default function MeetingsView({ people, myPersonId, canReadAll, canManageRooms }: Props) {
  const [roomsOpen, setRoomsOpen] = useState(false);
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('week');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [anchor, setAnchor] = useState(todayKey);
  const [version, setVersion] = useState(0);
  const [creatingAt, setCreatingAt] = useState<string | null>(null);
  const [dayOpen, setDayOpen] = useState<string | null>(null);

  const a = dayjs(anchor);
  // Khoảng cần tải: tuần là 7 ngày từ thứ Hai; tháng tải đủ 6 tuần lưới lịch; danh sách là cả tháng.
  let from: Dayjs;
  let to: Dayjs;
  if (mode === 'week') {
    from = mondayOf(a);
    to = from.add(7, 'day');
  } else if (mode === 'month') {
    from = mondayOf(a.startOf('month'));
    to = from.add(42, 'day');
  } else {
    from = a.startOf('month');
    to = from.add(1, 'month');
  }
  const { data, error, loading } = useRemote<MeetingRow[]>(`/meetings?from=${queryIso(from)}&to=${queryIso(to)}&scope=${scope}`, version);
  const rows = data ?? [];
  const byDay = new Map<string, MeetingRow[]>();
  for (const r of rows) {
    const k = dayOf(r.meeting.startAt);
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }

  const step = (dir: -1 | 1) => setAnchor(a.add(dir, mode === 'week' ? 'week' : 'month').format(DAY_FMT));
  const title = mode === 'week' ? `${from.format('DD/MM')} – ${to.subtract(1, 'day').format('DD/MM/YYYY')}` : `Tháng ${a.format('MM/YYYY')}`;
  const today = todayKey();
  const dayRows = dayOpen ? (byDay.get(dayOpen) ?? []) : [];

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
        <Space wrap>
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'week', label: 'Tuần' },
              { value: 'month', label: 'Tháng' },
              { value: 'list', label: 'Danh sách' },
            ]}
          />
          <Button icon={<LeftOutlined />} onClick={() => step(-1)} aria-label="Trước" />
          <Button onClick={() => setAnchor(today)}>Hôm nay</Button>
          <Button icon={<RightOutlined />} onClick={() => step(1)} aria-label="Sau" />
          <Typography.Text strong>{title}</Typography.Text>
        </Space>
        <Space wrap>
          {canReadAll && (
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              options={[
                { value: 'mine', label: 'Của tôi' },
                { value: 'all', label: 'Tất cả' },
              ]}
            />
          )}
          <Button icon={<ReloadOutlined />} onClick={() => setVersion((n) => n + 1)} loading={loading}>
            Tải lại
          </Button>
          {canManageRooms && <Button onClick={() => setRoomsOpen(true)}>Phòng họp</Button>}
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreatingAt('')}>
            Tạo lịch họp
          </Button>
        </Space>
      </Space>

      {error && <Alert type="error" showIcon message={error} />}

      {mode === 'week' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {WEEKDAYS.map((name, i) => {
            const d = from.add(i, 'day');
            const key = d.format(DAY_FMT);
            const list = byDay.get(key) ?? [];
            return (
              <div key={key} style={{ border: `1px solid ${key === today ? '#c8102e' : '#f0f0f0'}`, borderRadius: 6, padding: 8, minHeight: 120, background: '#fff', minWidth: 0 }}>
                <div style={{ marginBottom: 6, fontWeight: 600, color: key === today ? '#c8102e' : undefined }}>
                  {name} <span style={{ fontWeight: 400, color: '#8c8c8c' }}>{d.format('DD/MM')}</span>
                </div>
                {list.length === 0 && <Typography.Text type="secondary" style={{ fontSize: 12 }}>Không có cuộc họp</Typography.Text>}
                {list.map((r) => (
                  <MeetingChip key={r.meeting.id} row={r} />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {mode === 'month' && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 640 }}>
            <Calendar
              value={a}
              headerRender={() => null}
              onSelect={(d, info) => {
                if (info.source === 'date') setDayOpen(d.format(DAY_FMT));
              }}
              cellRender={(current, info) => {
                if (info.type !== 'date') return info.originNode;
                const list = byDay.get(current.format(DAY_FMT)) ?? [];
                return (
                  <div>
                    {list.slice(0, 3).map((r) => (
                      <MeetingChip key={r.meeting.id} row={r} showPlace={false} />
                    ))}
                    {list.length > 3 && <Typography.Text type="secondary" style={{ fontSize: 12 }}>+{list.length - 3} cuộc họp khác</Typography.Text>}
                  </div>
                );
              }}
            />
          </div>
        </div>
      )}

      {mode === 'list' && (
        <Table<MeetingRow>
          rowKey={(r) => r.meeting.id}
          size="middle"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'Không có cuộc họp nào trong tháng này.' }}
          pagination={{ pageSize: 20, hideOnSinglePage: true, showTotal: (t) => `${t} cuộc họp` }}
          columns={[
            { title: 'Giờ', render: (_: unknown, r) => <span style={{ whiteSpace: 'nowrap' }}>{meetingRangeText(r.meeting.startAt, r.meeting.endAt)}</span> },
            {
              title: 'Tiêu đề',
              render: (_: unknown, r) => (
                <Link href={`/meetings/${r.meeting.id}`} style={{ display: 'inline-block', minWidth: 200, maxWidth: 400, whiteSpace: 'normal' }}>
                  {r.meeting.title}
                </Link>
              ),
            },
            { title: 'Chủ trì', dataIndex: 'organizerName' },
            { title: 'Địa điểm', render: (_: unknown, r) => r.meeting.location ?? '–' },
            {
              title: 'Đề án',
              render: (_: unknown, r) =>
                r.project && r.meeting.projectId ? (
                  <Link href={`/projects/${r.meeting.projectId}`}>
                    <Typography.Text code>{r.project.code}</Typography.Text>
                  </Link>
                ) : (
                  '–'
                ),
            },
            { title: 'Trạng thái', render: (_: unknown, r) => <Tag color={MEETING_STATUS_COLORS[r.meeting.status]}>{MEETING_STATUS_LABELS[r.meeting.status]}</Tag> },
            { title: 'Xác nhận', align: 'right', render: (_: unknown, r) => `${r.accepted}/${r.attendeeCount}` },
            {
              title: 'Trả lời của tôi',
              render: (_: unknown, r) =>
                r.myResponse ? <Tag color={MEETING_RESPONSE_COLORS[r.myResponse]}>{r.myRole === 'ORGANIZER' ? 'Chủ trì' : MEETING_RESPONSE_LABELS[r.myResponse]}</Tag> : <Typography.Text type="secondary">Không được mời</Typography.Text>,
            },
          ]}
        />
      )}

      <Modal
        open={dayOpen !== null}
        title={dayOpen ? `Cuộc họp ngày ${dayjs(dayOpen).format('DD/MM/YYYY')}` : ''}
        onCancel={() => setDayOpen(null)}
        destroyOnHidden
        footer={
          <Space>
            <Button
              icon={<PlusOutlined />}
              onClick={() => {
                setCreatingAt(`${dayOpen}T08:00:00`);
                setDayOpen(null);
              }}
            >
              Tạo lịch họp ngày này
            </Button>
            <Button onClick={() => setDayOpen(null)}>Đóng</Button>
          </Space>
        }
      >
        {dayRows.length === 0 ? <Typography.Text type="secondary">Không có cuộc họp nào.</Typography.Text> : dayRows.map((r) => <MeetingChip key={r.meeting.id} row={r} />)}
      </Modal>

      {roomsOpen && <RoomsModal onClose={() => setRoomsOpen(false)} />}
      {creatingAt !== null && (
      <MeetingFormModal people={people} myPersonId={myPersonId} defaultStart={creatingAt || undefined} onClose={() => setCreatingAt(null)} onSaved={(m) => router.push(`/meetings/${m.id}`)} />
      )}
    </Space>
  );
}
