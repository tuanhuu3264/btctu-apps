'use client';

import { Alert, Card, Descriptions, Space, Tag, Typography } from 'antd';
import Link from 'next/link';
import { ConflictAlert, RoomConflictAlert } from '../meeting-form-modal';
import type { MeetingDetail } from '@/lib/api';
import { dateTimeText, MEETING_STATUS_COLORS, MEETING_STATUS_LABELS, meetingRangeText, meetingTimeText } from '@/lib/labels';

/** Thông tin chung của một cuộc họp: thời gian, địa điểm, link họp, chủ trì, đề án liên quan, nội dung. */
export default function MeetingView({ detail }: { detail: MeetingDetail }) {
  const { meeting: m, project } = detail;
  const safeLink = m.onlineLink && /^https?:\/\//i.test(m.onlineLink) ? m.onlineLink : null;

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%', marginBottom: 16 }}>
      {m.status === 'CANCELLED' && <Alert type="error" showIcon message="Cuộc họp đã hủy" description={m.cancelReason ? `Lý do: ${m.cancelReason}` : undefined} />}
      {m.status === 'HELD' && <Alert type="success" showIcon message={`Đã họp${m.concludedAt ? `, kết thúc lúc ${meetingTimeText(m.concludedAt)}` : ''}`} />}
      {m.status === 'SCHEDULED' && detail.myResponse === 'PENDING' && detail.can.respond && <Alert type="warning" showIcon message="Bạn được mời họp và chưa trả lời. Hãy xác nhận tham dự hoặc từ chối." />}
      <ConflictAlert conflicts={detail.conflicts} message="Cảnh báo trùng lịch" />
      <RoomConflictAlert conflicts={detail.roomConflicts ?? []} />

      <Card size="small" title="Thông tin cuộc họp" extra={<Tag color={MEETING_STATUS_COLORS[m.status]}>{MEETING_STATUS_LABELS[m.status]}</Tag>}>
        <Descriptions
          size="small"
          bordered
          column={{ xs: 1, md: 2 }}
          items={[
            { key: 'time', label: 'Thời gian', children: meetingRangeText(m.startAt, m.endAt) },
            { key: 'organizer', label: 'Chủ trì', children: detail.organizerName },
            { key: 'place', label: 'Địa điểm', children: m.location ? (detail.room?.capacity ? `${m.location} (${detail.room.capacity} chỗ)` : m.location) : '–' },
            {
              key: 'link',
              label: 'Họp trực tuyến',
              children: safeLink ? (
                <a href={safeLink} target="_blank" rel="noopener noreferrer" style={{ wordBreak: 'break-all' }}>
                  {safeLink}
                </a>
              ) : (
                (m.onlineLink ?? '–')
              ),
            },
            {
              key: 'project',
              label: 'Đề án, dự án liên quan',
              children:
                project && m.projectId ? (
                  <Link href={`/projects/${m.projectId}`}>
                    <Typography.Text code>{project.code}</Typography.Text> {project.title}
                  </Link>
                ) : (
                  '–'
                ),
            },
            { key: 'created', label: 'Tạo lúc', children: dateTimeText(m.createdAt) },
            { key: 'agenda', label: 'Nội dung họp', span: 'filled', children: <span style={{ whiteSpace: 'pre-wrap' }}>{m.agenda ?? '–'}</span> },
          ]}
        />
      </Card>
    </Space>
  );
}
