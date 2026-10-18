'use client';

import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, App, Button, DatePicker, Form, Input, Modal, Select, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import type { Meeting, MeetingConflict, MeetingDetail, MeetingRoom, MeetingRoomConflict, ProjectRow } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { hhmmText, meetingTimeText, vnIso, vnWall } from '@/lib/labels';
import { useAction } from '@/lib/use-action';
import { useRemote } from '@/lib/use-remote';

type Option = { value: string; label: string };

interface Values {
  title: string;
  agenda?: string;
  range: [Dayjs, Dayjs];
  /** Mã phòng trong danh mục, hoặc OTHER để nhập địa điểm tự do. */
  place?: string;
  location?: string;
  onlineLink?: string;
  organizerPersonId?: string;
  attendees?: { personId?: string; role?: 'REQUIRED' | 'OPTIONAL' }[];
  projectId?: string;
}

interface Props {
  /** Có `detail` là sửa cuộc họp; không có là tạo mới. */
  detail?: MeetingDetail;
  /** Cán bộ chọn được (từ sơ đồ tổ chức); trống thì không chọn được chủ trì, thành phần mới. */
  people: Option[];
  myPersonId: string;
  /** Đề án gắn sẵn khi tạo từ trang đề án. */
  defaultProjectId?: string;
  /** Ngày giờ bắt đầu gợi ý (giờ Việt Nam, YYYY-MM-DDTHH:mm:ss) khi tạo từ lịch. */
  defaultStart?: string;
  onClose: () => void;
  /** Gọi sau khi lưu thành công, kèm cuộc họp và các cảnh báo trùng lịch. */
  onSaved?: (meeting: Meeting, conflicts: MeetingConflict[]) => void;
}

/** Dòng cảnh báo trùng lịch: "X bận: <tiêu đề hoặc cuộc họp khác> (giờ)". */
export function conflictText(c: MeetingConflict) {
  return `${c.personName} bận: ${c.title ?? 'cuộc họp khác'} (${hhmmText(c.startAt)}–${hhmmText(c.endAt)} ${meetingTimeText(c.startAt).slice(6)})`;
}

export function ConflictAlert({ conflicts, message = 'Trùng lịch' }: { conflicts: MeetingConflict[]; message?: string }) {
  if (conflicts.length === 0) return null;
  return (
    <Alert
      type="warning"
      showIcon
      message={`${message} (${conflicts.length})`}
      description={
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {conflicts.map((c, i) => (
            <li key={`${c.personId}-${c.meetingId ?? i}-${c.startAt}`}>{conflictText(c)}</li>
          ))}
        </ul>
      }
    />
  );
}

/** Cảnh báo phòng họp đã có cuộc họp khác cùng giờ. */
export function RoomConflictAlert({ conflicts }: { conflicts: MeetingRoomConflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <Alert
      type="warning"
      showIcon
      message={`Phòng họp đã có cuộc họp khác cùng giờ (${conflicts.length})`}
      description={
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {conflicts.map((c, i) => (
            <li key={`${c.meetingId ?? i}-${c.startAt}`}>
              {c.title ?? 'Cuộc họp khác'} ({hhmmText(c.startAt)}–{hhmmText(c.endAt)} {meetingTimeText(c.startAt).slice(6)})
            </li>
          ))}
        </ul>
      }
    />
  );
}

/** Form tạo hoặc sửa cuộc họp. Chỉ được dựng khi đang mở nên mỗi lần mở là một form mới. */
export default function MeetingFormModal({ detail, people, myPersonId, defaultProjectId, defaultStart, onClose, onSaved }: Props) {
  const { run, busy } = useAction();
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [conflicts, setConflicts] = useState<MeetingConflict[]>([]);
  const [roomConflicts, setRoomConflicts] = useState<MeetingRoomConflict[]>([]);
  const meeting = detail?.meeting;

  // Danh mục phòng họp: chỉ phòng đang dùng; cuộc họp đang sửa vẫn giữ được phòng đã ngừng của nó.
  const rooms = useRemote<MeetingRoom[]>('/meetings/rooms');
  const roomOptions: Option[] = (rooms.data ?? []).map((r) => ({ value: r.id, label: r.capacity ? `${r.name} (${r.capacity} chỗ)` : r.name }));
  if (meeting?.roomId && !roomOptions.some((o) => o.value === meeting.roomId)) roomOptions.push({ value: meeting.roomId, label: `${meeting.location ?? 'Phòng họp'} (đã ngừng sử dụng)` });
  const OTHER = 'OTHER';

  const projects = useRemote<ProjectRow[]>('/projects?scope=mine');
  const projectOptions: Option[] = (projects.data ?? []).map((r) => ({ value: r.project.id, label: `${r.project.code} – ${r.project.title}` }));
  if (meeting?.projectId && detail?.project && !projectOptions.some((o) => o.value === meeting.projectId)) projectOptions.push({ value: meeting.projectId, label: `${detail.project.code} – ${detail.project.title}` });

  // Không đọc được sơ đồ tổ chức thì chỉ chọn trong số người đang có trong cuộc họp.
  const options: Option[] = people.length > 0 ? people : (detail?.attendees ?? []).map((a) => ({ value: a.personId, label: a.fullName }));
  const noDirectory = people.length === 0;

  const range = Form.useWatch('range', form);
  const organizer = Form.useWatch('organizerPersonId', form);
  const attendees = Form.useWatch('attendees', form);
  const place = Form.useWatch('place', form);
  const roomId = place && place !== OTHER ? place : null;
  const organizerId = organizer ?? meeting?.organizerPersonId ?? myPersonId;
  const picked = (attendees ?? []).map((a) => a?.personId).filter((p): p is string => !!p);
  const startIso = range?.[0] ? vnIso(range[0].format('YYYY-MM-DDTHH:mm:ss')) : null;
  const endIso = range?.[1] ? vnIso(range[1].format('YYYY-MM-DDTHH:mm:ss')) : null;
  const personKey = [organizerId, ...picked].join(',');
  const meetingId = meeting?.id;

  // Chọn phòng và thời gian: hỏi máy chủ cuộc họp khác dùng cùng phòng (chỉ cảnh báo).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (!roomId || !startIso || !endIso || new Date(endIso) <= new Date(startIso)) {
        setRoomConflicts([]);
        return;
      }
      apiCall<MeetingRoomConflict[]>('POST', '/meetings/check-room', { roomId, startAt: startIso, endAt: endIso, ...(meetingId ? { excludeMeetingId: meetingId } : {}) })
        .then((r) => {
          if (!cancelled) setRoomConflicts(r ?? []);
        })
        .catch(() => {
          if (!cancelled) setRoomConflicts([]);
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [roomId, startIso, endIso, meetingId]);

  // Đổi thời gian hoặc thành phần: chờ 600 ms rồi hỏi máy chủ các cuộc họp trùng giờ (chỉ cảnh báo, vẫn lưu được).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (!startIso || !endIso || new Date(endIso) <= new Date(startIso)) {
        setConflicts([]);
        return;
      }
      apiCall<MeetingConflict[]>('POST', '/meetings/check-conflicts', {
        startAt: startIso,
        endAt: endIso,
        attendeePersonIds: personKey.split(','),
        ...(meetingId ? { excludeMeetingId: meetingId } : {}),
      })
        .then((r) => {
          if (!cancelled) setConflicts(r ?? []);
        })
        .catch(() => {
          if (!cancelled) setConflicts([]);
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [startIso, endIso, personKey, meetingId]);

  async function submit(v: Values) {
    const body = {
      title: v.title.trim(),
      agenda: v.agenda?.trim() || null,
      startAt: vnIso(v.range[0].format('YYYY-MM-DDTHH:mm:ss')),
      endAt: vnIso(v.range[1].format('YYYY-MM-DDTHH:mm:ss')),
      // Chọn phòng: địa điểm lấy theo tên phòng ở máy chủ. Chọn "Địa điểm khác": gửi chữ tự do và bỏ phòng.
      roomId: v.place && v.place !== OTHER ? v.place : null,
      location: v.place && v.place !== OTHER ? null : v.location?.trim() || null,
      onlineLink: v.onlineLink?.trim() || null,
      ...(v.organizerPersonId ? { organizerPersonId: v.organizerPersonId } : {}),
      attendees: (v.attendees ?? []).filter((a) => a?.personId).map((a) => ({ personId: a.personId as string, role: a.role ?? 'REQUIRED' })),
      projectId: v.projectId ?? null,
    };
    const ok = await run(
      async () => {
        const res = await apiCall<{ meeting: Meeting; conflicts: MeetingConflict[]; roomConflicts?: MeetingRoomConflict[] }>(meeting ? 'PATCH' : 'POST', meeting ? `/meetings/${meeting.id}` : '/meetings', body);
        if (res && res.conflicts.length > 0) message.warning({ content: `Đã lưu, nhưng có ${res.conflicts.length} trường hợp trùng lịch.`, duration: 6 });
        if (res && (res.roomConflicts?.length ?? 0) > 0) message.warning({ content: 'Đã lưu, nhưng phòng họp này đã có cuộc họp khác cùng giờ.', duration: 6 });
        if (res && onSaved) onSaved(res.meeting, res.conflicts);
      },
      { success: meeting ? 'Đã lưu cuộc họp' : 'Đã tạo lịch họp', refresh: Boolean(meeting) },
    );
    if (ok) onClose();
  }

  const initial: Partial<Values> = meeting
    ? {
        title: meeting.title,
        agenda: meeting.agenda ?? undefined,
        range: [dayjs(vnWall(meeting.startAt)), dayjs(vnWall(meeting.endAt))],
        place: meeting.roomId ?? (meeting.location ? OTHER : undefined),
        location: meeting.roomId ? undefined : (meeting.location ?? undefined),
        onlineLink: meeting.onlineLink ?? undefined,
        organizerPersonId: meeting.organizerPersonId,
        attendees: (detail?.attendees ?? []).filter((a) => a.role !== 'ORGANIZER').map((a) => ({ personId: a.personId, role: a.role as 'REQUIRED' | 'OPTIONAL' })),
        projectId: meeting.projectId ?? undefined,
      }
    : {
        organizerPersonId: myPersonId,
        attendees: [],
        projectId: defaultProjectId,
        ...(defaultStart ? { range: [dayjs(defaultStart), dayjs(defaultStart).add(1, 'hour')] as [Dayjs, Dayjs] } : {}),
      };

  return (
    <Modal
      open
      title={meeting ? 'Chỉnh sửa cuộc họp' : 'Tạo lịch họp'}
      okText={meeting ? 'Lưu' : 'Tạo lịch họp'}
      cancelText="Hủy"
      confirmLoading={busy}
      onOk={() => form.submit()}
      onCancel={onClose}
      width={720}
      style={{ maxWidth: 'calc(100vw - 16px)', top: 24 }}
      destroyOnHidden
    >
      <Form<Values> form={form} layout="vertical" onFinish={submit} initialValues={initial}>
        <Form.Item name="title" label="Tiêu đề" rules={[{ required: true, whitespace: true, message: 'Nhập tiêu đề' }, { max: 200, message: 'Tối đa 200 ký tự' }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="agenda" label="Nội dung họp" rules={[{ max: 8000, message: 'Tối đa 8000 ký tự' }]}>
          <Input.TextArea rows={4} maxLength={8000} />
        </Form.Item>
        <Form.Item
          name="range"
          label="Thời gian (giờ Việt Nam)"
          rules={[
            { required: true, message: 'Chọn giờ bắt đầu và kết thúc' },
            {
              validator: (_, v: [Dayjs, Dayjs] | undefined) => {
                if (!v?.[0] || !v?.[1]) return Promise.resolve();
                if (!v[1].isAfter(v[0])) return Promise.reject(new Error('Giờ kết thúc phải sau giờ bắt đầu'));
                if (v[1].diff(v[0], 'hour', true) > 12) return Promise.reject(new Error('Một cuộc họp tối đa 12 giờ'));
                return Promise.resolve();
              },
            },
          ]}
        >
          <DatePicker.RangePicker showTime={{ format: 'HH:mm', minuteStep: 5 }} format="DD/MM/YYYY HH:mm" placeholder={['Bắt đầu', 'Kết thúc']} style={{ width: '100%' }} />
        </Form.Item>
        {conflicts.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <ConflictAlert conflicts={conflicts} message="Cảnh báo trùng lịch" />
          </div>
        )}
        <Form.Item name="place" label="Địa điểm" extra={rooms.error ? `Không tải được danh mục phòng họp: ${rooms.error}` : undefined}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Chọn phòng họp"
            loading={rooms.loading}
            options={[...roomOptions, { value: OTHER, label: 'Địa điểm khác (tự nhập)…' }]}
          />
        </Form.Item>
        {place === OTHER && (
          <Form.Item name="location" label="Địa điểm khác" rules={[{ required: true, whitespace: true, message: 'Nhập địa điểm' }, { max: 300, message: 'Tối đa 300 ký tự' }]}>
            <Input maxLength={300} placeholder="Ví dụ: Hội trường Tỉnh ủy" />
          </Form.Item>
        )}
        {roomConflicts.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <RoomConflictAlert conflicts={roomConflicts} />
          </div>
        )}
        <Form.Item name="onlineLink" label="Link họp trực tuyến" rules={[{ max: 500, message: 'Tối đa 500 ký tự' }, { pattern: /^https:\/\/\S+$/, message: 'Nhập đường dẫn bắt đầu bằng https://' }]}>
          <Input maxLength={500} placeholder="https://" />
        </Form.Item>
        <Form.Item name="organizerPersonId" label="Chủ trì" extra={noDirectory ? 'Không đọc được sơ đồ tổ chức nên chưa đổi được chủ trì và thêm thành phần mới.' : undefined}>
          <Select showSearch optionFilterProp="label" placeholder="Chọn cán bộ chủ trì" options={options} disabled={noDirectory && !meeting} />
        </Form.Item>
        <Form.Item label="Thành phần">
          <Form.List name="attendees">
            {(fields, { add, remove }) => (
              <Space orientation="vertical" style={{ width: '100%' }}>
                {fields.map((f) => (
                  <div key={f.key} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
                    <Form.Item name={[f.name, 'personId']} rules={[{ required: true, message: 'Chọn cán bộ' }]} style={{ flex: '1 1 260px', margin: 0 }}>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="Chọn cán bộ được mời"
                        options={options.filter((o) => o.value !== organizerId && (o.value === attendees?.[f.name]?.personId || !picked.includes(o.value)))}
                      />
                    </Form.Item>
                    <Form.Item name={[f.name, 'role']} style={{ width: 160, margin: 0 }}>
                      <Select
                        options={[
                          { value: 'REQUIRED', label: 'Bắt buộc' },
                          { value: 'OPTIONAL', label: 'Không bắt buộc' },
                        ]}
                      />
                    </Form.Item>
                    <Button type="text" danger icon={<DeleteOutlined />} aria-label="Bỏ khỏi thành phần" onClick={() => remove(f.name)} />
                  </div>
                ))}
                <Button icon={<PlusOutlined />} disabled={noDirectory} onClick={() => add({ role: 'REQUIRED' })}>
                  Thêm người dự họp
                </Button>
                <Typography.Text type="secondary">Chủ trì mặc nhiên tham dự. Người được mời xác nhận hoặc từ chối trên trang cuộc họp.</Typography.Text>
              </Space>
            )}
          </Form.List>
        </Form.Item>
        <Form.Item name="projectId" label="Đề án, dự án liên quan (nếu có)">
          <Select allowClear showSearch optionFilterProp="label" placeholder="Chọn đề án, dự án" options={projectOptions} loading={projects.loading} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
